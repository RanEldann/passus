#!/usr/bin/env node

import * as readline from 'node:readline';
import { VERSION, createAgent } from '@passus/core';
import { HumanMessage } from '@langchain/core/messages';

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://localhost:5432/passus';
const THREAD_ID = process.env.THREAD_ID ?? 'default';

async function main() {
  console.log(`passus v${VERSION}\n`);

  const { agent, checkpointer } = await createAgent(DB_URL);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const config = { configurable: { thread_id: THREAD_ID } };

  const prompt = () => rl.question('you: ', async (input) => {
    const trimmed = input.trim();
    if (!trimmed || trimmed === '/quit') {
      console.log('Goodbye!');
      await checkpointer.end();
      rl.close();
      return;
    }

    try {
      const result = await agent.invoke(
        { messages: [new HumanMessage(trimmed)] },
        config,
      );

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
