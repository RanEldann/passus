import { eq } from 'drizzle-orm';
import type { Db } from './index.js';
import { users } from './schema.js';

export function createUserRepository(db: Db) {
  return {
    async create(name: string) {
      const [user] = await db.insert(users).values({ name }).returning();
      return user;
    },

    async findById(id: string) {
      return db.query.users.findFirst({ where: eq(users.id, id) });
    },

    async findAll() {
      return db.query.users.findMany();
    },
  };
}
