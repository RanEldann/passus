#!/usr/bin/env node

import * as readline from 'node:readline';
import { VERSION, createAgent, createDb, createUserRepository, createThreadRepository } from '@passus/core';
import { HumanMessage } from '@langchain/core/messages';

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://localhost:5432/passus';
const CLI_USER_NAME = 'cli-user';

async function main() {
  console.log(`passus v${VERSION}\n`);

  const { db, close: closeDb } = createDb(DB_URL);
  const userRepo = createUserRepository(db);
  const threadRepo = createThreadRepository(db);
  const { agent, checkpointer } = await createAgent(DB_URL);

  const user = await userRepo.findOrCreate(CLI_USER_NAME);
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
        const result = await agent.invoke({ messages: [new HumanMessage(trimmed)] }, config);

        const lastMessage = result.messages[result.messages.length - 1];
        console.log(`\npassus: ${lastMessage.content}\n`);
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
      }

      prompt();
    });

  prompt();
}

main().catch(console.error);
