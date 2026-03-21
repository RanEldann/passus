#!/usr/bin/env node

import * as crypto from 'node:crypto';
import * as readline from 'node:readline';
import { VERSION, createAgent } from '@passus/core';
import { HumanMessage } from '@langchain/core/messages';

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://localhost:5432/passus';

async function main() {
  console.log(`passus v${VERSION}\n`);

  const { agent, checkpointer } = await createAgent(DB_URL);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let threadId = crypto.randomUUID();
  console.log(`Thread: ${threadId}\n`);

  const prompt = () =>
    rl.question('you: ', async (input) => {
      const trimmed = input.trim();
      if (!trimmed || trimmed === '/quit') {
        console.log('Goodbye!');
        await checkpointer.end();
        rl.close();
        return;
      }

      if (trimmed === '/new') {
        threadId = crypto.randomUUID();
        console.log(`\nNew thread: ${threadId}\n`);
        prompt();
        return;
      }

      try {
        const config = { configurable: { thread_id: threadId } };
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
