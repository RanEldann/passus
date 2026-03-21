#!/usr/bin/env node

import * as readline from 'node:readline';
import {
  VERSION,
  createAgent,
  createDb,
  createUserRepository,
  createThreadRepository,
  createScheduler,
} from '@passus/core';
import type { Transport } from '@passus/core';
import { HumanMessage } from '@langchain/core/messages';

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://localhost:5432/passus';
const CLI_USER_NAME = 'cli-user';
const DEBUG = process.env.DEBUG === '1';
const CHECK_INTERVAL_MS = Number(process.env.CHECK_INTERVAL_MS) || 60_000;

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

async function main() {
  console.log(`passus v${VERSION}\n`);

  const { db, close: closeDb } = createDb(DB_URL);
  const userRepo = createUserRepository(db);
  const threadRepo = createThreadRepository(db);
  const user = await userRepo.findOrCreate(CLI_USER_NAME);
  const { agent, checkpointer } = await createAgent({ dbUrl: DB_URL, db, userId: user.id });

  console.log(`User: ${user.name} (${user.id})`);

  let thread = await threadRepo.create(user.id);
  console.log(`Thread: ${thread.id}\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const consoleTransport: Transport = {
    async sendMessage(_userId: string, text: string) {
      console.log(`\npassus: ${text}\n`);
    },
    onMessage() {
      // User input is handled by the readline loop below
    },
  };

  const scheduler = createScheduler({
    db,
    agent,
    transport: consoleTransport,
    intervalMs: CHECK_INTERVAL_MS,
    onCheckInStarted(_userId: string, threadId: string) {
      thread = { id: threadId, userId: user.id, createdAt: new Date() };
      console.log(`  [check-in] Switched to thread: ${threadId}`);
    },
  });

  scheduler.start();

  const prompt = () =>
    rl.question('you: ', async (input) => {
      const trimmed = input.trim();
      if (!trimmed || trimmed === '/quit') {
        console.log('Goodbye!');
        scheduler.stop();
        await checkpointer.end();
        await closeDb();
        rl.close();
        return;
      }

      if (trimmed === '/new') {
        thread = await threadRepo.create(user.id);
        console.log(`\nNew thread: ${thread.id}\n`);
        prompt();
        return;
      }

      try {
        const config = { configurable: { thread_id: thread.id }, recursionLimit: 50 };
        const stream = await agent.stream(
          { messages: [new HumanMessage(trimmed)] },
          config,
        );

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
                    console.log(
                      `  [tool] ${tc.name}(${JSON.stringify(tc.args).slice(0, 200)})`,
                    );
                  }
                }
                const text = extractText(m.content);
                if (text) {
                  console.log(`\npassus: ${text}\n`);
                }
              }

              if (nodeName === 'tools') {
                const content =
                  typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
                console.log(`  [tool] ${m.name} → ${content.slice(0, 200)}`);
              }
            }
          }
        }
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
      }

      prompt();
    });

  prompt();
}

main().catch(console.error);
