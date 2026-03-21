export const VERSION = '0.0.1';

export { createDb } from './db/index.js';
export type { Db } from './db/index.js';
export { users, threads, goals, plans, checkpoints, scheduledCheckIns, telegramMessages } from './db/schema.js';
export type { PlanStep } from './db/schema.js';
export { createUserRepository } from './db/users.js';
export { createThreadRepository } from './db/threads.js';
export { createGoalRepository } from './db/goals.js';
export { createCheckInRepository } from './db/checkins.js';
export { createTelegramMessageRepository } from './db/telegram-messages.js';
export { createAgent } from './agent/index.js';
export type { Agent, CreateAgentOptions } from './agent/index.js';
export { createScheduler } from './scheduler.js';
export type { SchedulerOptions } from './scheduler.js';
export type { Transport } from './transport.js';
