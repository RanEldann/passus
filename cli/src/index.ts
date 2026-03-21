#!/usr/bin/env node

import * as readline from 'node:readline';
import {
  VERSION,
  createAgent,
  createDb,
  createUserRepository,
  createThreadRepository,
  createGoalRepository,
  createScheduler,
} from '@passus/core';
import type { Transport } from '@passus/core';
import { HumanMessage } from '@langchain/core/messages';

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://localhost:5432/passus';
const CLI_USER_NAME = 'cli-user';
const DEBUG = process.env.DEBUG === '1';

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (content as { type: string; text?: string }[])
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text)
      .join('');
  }
  return '';
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function sendMessage(
  agent: Awaited<ReturnType<typeof createAgent>>['agent'],
  threadId: string,
  text: string,
) {
  const config = { configurable: { thread_id: threadId }, recursionLimit: 50 };
  const stream = await agent.stream({ messages: [new HumanMessage(text)] }, config);

  for await (const chunk of stream) {
    if (DEBUG) {
      console.log('[debug] chunk:', JSON.stringify(chunk, null, 2).slice(0, 500));
    }

    for (const [nodeName, update] of Object.entries(chunk)) {
      const messages = (update as { messages?: unknown[] }).messages;
      if (!messages) continue;

      for (const msg of messages) {
        const m = msg as {
          content?: unknown;
          tool_calls?: { name: string; args: unknown }[];
          name?: string;
        };

        if (nodeName === 'agent') {
          if (m.tool_calls?.length) {
            for (const tc of m.tool_calls) {
              console.log(`  [tool] ${tc.name}(${JSON.stringify(tc.args).slice(0, 200)})`);
            }
          }
          const extracted = extractText(m.content);
          if (extracted) {
            console.log(`\npassus: ${extracted}\n`);
          }
        }

        if (nodeName === 'tools') {
          const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
          console.log(`  [tool] ${m.name} → ${content.slice(0, 200)}`);
        }
      }
    }
  }
}

async function main() {
  console.log(`passus v${VERSION}\n`);

  const { db, close: closeDb } = createDb(DB_URL);
  const userRepo = createUserRepository(db);
  const threadRepo = createThreadRepository(db);
  const goalRepo = createGoalRepository(db);
  const user = await userRepo.findOrCreate(CLI_USER_NAME);
  const { agent, checkpointer } = await createAgent({ dbUrl: DB_URL, db, userId: user.id });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const cleanup = async () => {
    scheduler.stop();
    await checkpointer.end();
    await closeDb();
    rl.close();
  };

  let thread = await threadRepo.create(user.id);

  const consoleTransport: Transport = {
    async sendMessage(_userId: string, text: string) {
      console.log(`\npassus: ${text}\n`);
    },
    onMessage() {},
  };

  const scheduler = createScheduler({
    db,
    agent,
    transport: consoleTransport,
    onCheckInStarted(_userId: string, threadId: string) {
      thread = { id: threadId, userId: user.id, createdAt: new Date() };
      console.log(`  [check-in] Switched to thread: ${threadId}`);
    },
  });

  await scheduler.start();

  async function showGoalMenu(): Promise<void> {
    const userGoals = await goalRepo.getGoalsByUser(user.id);
    const activeGoals = userGoals.filter((g) => g.active);

    console.log('─'.repeat(50));
    console.log('  Your Goals:\n');

    if (activeGoals.length === 0) {
      console.log('  No goals yet.\n');
    } else {
      for (let i = 0; i < activeGoals.length; i++) {
        const g = activeGoals[i]!;
        const status = g.status.replace(/_/g, ' ');
        console.log(`  ${i + 1}. ${g.title} [${status}]`);
        if (g.targetDate) console.log(`     Target: ${g.targetDate}`);
      }
      console.log();
    }

    console.log(`  ${activeGoals.length + 1}. + New goal`);
    console.log(`  q. Quit`);
    console.log('─'.repeat(50));

    const choice = (await ask(rl, '\nChoose: ')).trim();

    if (choice === 'q' || choice === '/quit') {
      console.log('Goodbye!');
      await cleanup();
      return;
    }

    const num = parseInt(choice, 10);

    if (num >= 1 && num <= activeGoals.length) {
      const goal = activeGoals[num - 1]!;
      thread = await threadRepo.create(user.id);

      const fullGoal = await goalRepo.getFullGoal(goal.id);
      const livePlan = fullGoal?.plans.find((p) => p.status === 'live');
      const recentCheckpoints = fullGoal?.checkpoints.slice(-3) ?? [];

      let context = `[CONTEXT] The user selected their goal: "${goal.title}".\n`;
      context += `Goal ID: ${goal.id}\n`;
      context += `Status: ${goal.status}\n`;
      if (goal.startDate) context += `Start: ${goal.startDate}\n`;
      if (goal.targetDate) context += `Target: ${goal.targetDate}\n`;
      if (goal.description) context += `Description: ${goal.description}\n`;
      if (livePlan) {
        context += `\nPlan (v${livePlan.version}): ${livePlan.description}\n`;
        context += `Steps: ${JSON.stringify(livePlan.steps)}\n`;
      }
      if (recentCheckpoints.length > 0) {
        context += `\nRecent checkpoints: ${JSON.stringify(recentCheckpoints)}\n`;
      }
      context += `\nGreet the user briefly and ask how they'd like to work on this goal today.`;

      console.log(`\nGoal: ${goal.title}`);
      console.log(`Thread: ${thread.id}\n`);

      await sendMessage(agent, thread.id, context);
    } else {
      thread = await threadRepo.create(user.id);
      console.log(`\nThread: ${thread.id}\n`);
      await sendMessage(agent, thread.id, 'I want to create a new goal.');
    }

    await chatLoop();
  }

  async function chatLoop(): Promise<void> {
    while (true) {
      const input = await ask(rl, 'you: ');
      const trimmed = input.trim();

      if (!trimmed || trimmed === '/quit') {
        console.log('Goodbye!');
        await cleanup();
        return;
      }

      if (trimmed === '/goals') {
        await showGoalMenu();
        return;
      }

      try {
        await sendMessage(agent, thread.id, trimmed);
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
      }
    }
  }

  await showGoalMenu();
}

main().catch(console.error);
