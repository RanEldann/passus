import { eq } from 'drizzle-orm';
import type { Db } from './index.js';
import { threads } from './schema.js';

export function createThreadRepository(db: Db) {
  return {
    async create(userId: string) {
      const [thread] = await db.insert(threads).values({ userId }).returning();
      return thread;
    },

    async findById(id: string) {
      return db.query.threads.findFirst({ where: eq(threads.id, id) });
    },

    async findByUserId(userId: string) {
      return db.query.threads.findMany({ where: eq(threads.userId, userId) });
    },
  };
}
