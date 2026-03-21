#!/usr/bin/env node

import * as readline from 'node:readline';
import { VERSION, createAgent, createDb, createUserRepository, createThreadRepository } from '@passus/core';
import { HumanMessage } from '@langchain/core/messages';

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://localhost:5432/passus';
const CLI_USER_NAME = 'cli-user';
const DEBUG = process.env.DEBUG === '1';

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

  const prompt = () =>
    rl.question('you: ', async (input) => {
      const trimmed = input.trim();
      if (!trimmed || trimmed === '/quit') {
        console.log('Goodbye!');
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
              const m = msg as { content?: unknown; tool_calls?: { name: string; args: unknown }[]; name?: string };

              if (nodeName === 'agent') {
                if (m.tool_calls?.length) {
                  for (const tc of m.tool_calls) {
                    console.log(`  [tool] ${tc.name}(${JSON.stringify(tc.args).slice(0, 200)})`);
                  }
                }
                let text = '';
                if (typeof m.content === 'string') {
                  text = m.content;
                } else if (Array.isArray(m.content)) {
                  text = (m.content as { type: string; text?: string }[])
                    .filter((b) => b.type === 'text' && b.text)
                    .map((b) => b.text)
                    .join('');
                }
                if (text) {
                  console.log(`\npassus: ${text}\n`);
                }
              }

              if (nodeName === 'tools') {
                const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
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
