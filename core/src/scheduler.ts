import { HumanMessage } from '@langchain/core/messages';
import type { Db } from './db/index.js';
import { createGoalRepository } from './db/goals.js';
import { createThreadRepository } from './db/threads.js';
import type { Agent } from './agent/index.js';
import type { Transport } from './transport.js';
import type { PlanStep } from './db/schema.js';

export interface SchedulerOptions {
  db: Db;
  agent: Agent;
  transport: Transport;
  intervalMs?: number;
  onCheckInStarted?: (userId: string, threadId: string) => void;
}

export interface DueCheckIn {
  userId: string;
  goalId: string;
  goalTitle: string;
  step: PlanStep;
}

export function createScheduler({
  db,
  agent,
  transport,
  intervalMs = 60_000,
  onCheckInStarted,
}: SchedulerOptions) {
  const goalRepo = createGoalRepository(db);
  const threadRepo = createThreadRepository(db);
  let timer: ReturnType<typeof setInterval> | null = null;

  async function findDueCheckIns(): Promise<DueCheckIn[]> {
    const today = new Date().toISOString().split('T')[0]!;
    const allGoals = await db.query.goals.findMany();
    const due: DueCheckIn[] = [];

    for (const goal of allGoals) {
      if (!goal.active || goal.status === 'completed' || goal.status === 'missed') continue;

      const livePlan = await goalRepo.getLivePlan(goal.id);
      if (!livePlan || !livePlan.steps.length) continue;

      const existingCheckpoints = await goalRepo.getCheckpointsByGoal(goal.id);
      const checkedPeriods = new Set(
        existingCheckpoints.map((cp) => `${cp.periodStart}_${cp.periodEnd}`),
      );

      for (const step of livePlan.steps) {
        if (!step.endDate || step.endDate > today) continue;
        const key = `${step.startDate}_${step.endDate}`;
        if (checkedPeriods.has(key)) continue;

        due.push({
          userId: goal.userId,
          goalId: goal.id,
          goalTitle: goal.title,
          step,
        });
        break; // One check-in per goal at a time
      }
    }

    return due;
  }

  async function triggerCheckIn(checkIn: DueCheckIn): Promise<string> {
    const thread = await threadRepo.create(checkIn.userId);

    const prompt =
      `[CHECK-IN] Time to check in on goal "${checkIn.goalTitle}". ` +
      `The period "${checkIn.step.title}" (${checkIn.step.startDate} to ${checkIn.step.endDate}) has ended. ` +
      `Target was: ${checkIn.step.target}. ` +
      `Ask the user how they did during this period and log the checkpoint based on their response.`;

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
      await transport.sendMessage(checkIn.userId, text);
    }

    onCheckInStarted?.(checkIn.userId, thread.id);

    return thread.id;
  }

  async function tick() {
    try {
      const dueCheckIns = await findDueCheckIns();
      for (const checkIn of dueCheckIns) {
        await triggerCheckIn(checkIn);
      }
    } catch (err) {
      console.error('[scheduler] Error:', err instanceof Error ? err.message : err);
    }
  }

  return {
    start() {
      console.log(`[scheduler] Started (checking every ${intervalMs / 1000}s)`);
      tick();
      timer = setInterval(tick, intervalMs);
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
        console.log('[scheduler] Stopped');
      }
    },

    findDueCheckIns,
    triggerCheckIn,
  };
}
