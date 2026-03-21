export const VERSION = '0.0.1';

export { createDb } from './db/index.js';
export type { Db } from './db/index.js';
export { users, threads, visions, milestones, weeklyStrategies, dailyTasks } from './db/schema.js';
export { createUserRepository } from './db/users.js';
export { createThreadRepository } from './db/threads.js';
export { createGoalRepository } from './db/goals.js';
export { createAgent } from './agent/index.js';
export type { Agent, CreateAgentOptions } from './agent/index.js';
