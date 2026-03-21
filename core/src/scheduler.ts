import cron from 'node-cron';
import { HumanMessage } from '@langchain/core/messages';
import type { Db } from './db/index.js';
import { createCheckInRepository } from './db/checkins.js';
import { createThreadRepository } from './db/threads.js';
import { goals } from './db/schema.js';
import { eq } from 'drizzle-orm';
import type { Agent } from './agent/index.js';
import type { Transport } from './transport.js';

export interface SchedulerOptions {
  db: Db;
  resolveAgent: (userId: string) => Promise<Agent>;
  transport: Transport;
  onCheckInStarted?: (userId: string, threadId: string) => void;
}

export function createScheduler({ db, resolveAgent, transport, onCheckInStarted }: SchedulerOptions) {
  const checkInRepo = createCheckInRepository(db);
  const threadRepo = createThreadRepository(db);
  const jobs = new Map<string, cron.ScheduledTask>();

  async function triggerCheckIn(checkInId: string, goalId: string, purpose: string, hint: string) {
    const goal = await db.query.goals.findFirst({ where: eq(goals.id, goalId) });
    if (!goal) return;

    const thread = await threadRepo.create(goal.userId);
    const agent = await resolveAgent(goal.userId);

    const prompt =
      `[CHECK-IN: ${purpose}] ` +
      `Goal: "${goal.title}" (${goal.id}). ` +
      `${hint}`;

    const config = { configurable: { thread_id: thread.id }, recursionLimit: 50 };
    const result = await agent.invoke({ messages: [new HumanMessage(prompt)] }, config);

    const lastMessage = result.messages[result.messages.length - 1];
    let text = '';
    if (typeof lastMessage.content === 'string') {
      text = lastMessage.content;
    } else if (Array.isArray(lastMessage.content)) {
      text = (lastMessage.content as { type: string; text?: string }[])
        .filter((b) => b.type === 'text' && b.text)
        .map((b) => b.text)
        .join('');
    }

    if (text) {
      await transport.sendMessage(goal.userId, text);
    }

    onCheckInStarted?.(goal.userId, thread.id);
  }

  function registerJob(checkIn: { id: string; goalId: string; schedule: string; purpose: string; hint: string }) {
    if (jobs.has(checkIn.id)) {
      jobs.get(checkIn.id)!.stop();
    }

    if (!cron.validate(checkIn.schedule)) {
      console.error(`[scheduler] Invalid cron expression for check-in ${checkIn.id}: "${checkIn.schedule}"`);
      return;
    }

    const task = cron.schedule(checkIn.schedule, () => {
      triggerCheckIn(checkIn.id, checkIn.goalId, checkIn.purpose, checkIn.hint).catch((err) => {
        console.error(`[scheduler] Error triggering check-in ${checkIn.id}:`, err instanceof Error ? err.message : err);
      });
    });

    jobs.set(checkIn.id, task);
    console.log(`[scheduler] Registered: "${checkIn.purpose}" (${checkIn.schedule})`);
  }

  function unregisterJob(checkInId: string) {
    const task = jobs.get(checkInId);
    if (task) {
      task.stop();
      jobs.delete(checkInId);
      console.log(`[scheduler] Unregistered check-in: ${checkInId}`);
    }
  }

  return {
    async start() {
      const activeCheckIns = await checkInRepo.getAllActive();
      for (const checkIn of activeCheckIns) {
        registerJob(checkIn);
      }
      console.log(`[scheduler] Started with ${activeCheckIns.length} active check-in(s)`);
    },

    stop() {
      for (const [id, task] of jobs) {
        task.stop();
        jobs.delete(id);
      }
      console.log('[scheduler] Stopped');
    },

    async sync() {
      const activeCheckIns = await checkInRepo.getAllActive();
      for (const checkIn of activeCheckIns) {
        if (!jobs.has(checkIn.id)) {
          registerJob(checkIn);
        }
      }
      for (const id of jobs.keys()) {
        if (!activeCheckIns.find((c) => c.id === id)) {
          unregisterJob(id);
        }
      }
    },

    registerJob,
    unregisterJob,
  };
}
