#!/usr/bin/env node

import * as readline from 'node:readline';
import { VERSION, createAgent, createDb, createUserRepository, createThreadRepository } from '@passus/core';
import { HumanMessage, type AIMessageChunk } from '@langchain/core/messages';

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://localhost:5432/passus';
const CLI_USER_NAME = 'cli-user';

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
        const config = { configurable: { thread_id: thread.id } };
        const stream = agent.streamEvents(
          { messages: [new HumanMessage(trimmed)] },
          { ...config, version: 'v2', recursionLimit: 50 },
        );

        let isStreaming = false;
        for await (const event of stream) {
          if (event.event === 'on_chat_model_stream') {
            const chunk: AIMessageChunk = event.data.chunk;
            if (typeof chunk.content === 'string' && chunk.content) {
              if (!isStreaming) {
                process.stdout.write('\npassus: ');
                isStreaming = true;
              }
              process.stdout.write(chunk.content);
            }
          } else if (event.event === 'on_tool_start') {
            if (isStreaming) {
              process.stdout.write('\n');
              isStreaming = false;
            }
            console.log(`  [tool] ${event.name}(${JSON.stringify(event.data.input).slice(0, 200)})`);
          } else if (event.event === 'on_tool_end') {
            const output = event.data.output;
            const text = typeof output === 'string' ? output : JSON.stringify(output);
            console.log(`  [tool] ${event.name} → ${text.slice(0, 200)}`);
          }
        }
        if (isStreaming) {
          process.stdout.write('\n');
        }
        console.log();
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
      }

      prompt();
    });

  prompt();
}

main().catch(console.error);
