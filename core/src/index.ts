export const VERSION = '0.0.1';

export { createDb } from './db/index.js';
export type { Db } from './db/index.js';
export { users, threads } from './db/schema.js';
export { createUserRepository } from './db/users.js';
export { createThreadRepository } from './db/threads.js';
export { createAgent } from './agent/index.js';
export type { Agent } from './agent/index.js';
