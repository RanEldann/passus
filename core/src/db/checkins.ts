import { eq, and } from 'drizzle-orm';
import type { Db } from './index.js';
import { scheduledCheckIns } from './schema.js';

export function createCheckInRepository(db: Db) {
  return {
    async create(goalId: string, schedule: string, purpose: string, hint: string) {
      const [checkIn] = await db
        .insert(scheduledCheckIns)
        .values({ goalId, schedule, purpose, hint })
        .returning();
      return checkIn;
    },

    async getByGoal(goalId: string) {
      return db.query.scheduledCheckIns.findMany({
        where: eq(scheduledCheckIns.goalId, goalId),
      });
    },

    async getActiveByGoal(goalId: string) {
      return db.query.scheduledCheckIns.findMany({
        where: and(
          eq(scheduledCheckIns.goalId, goalId),
          eq(scheduledCheckIns.active, true),
        ),
      });
    },

    async getAllActive() {
      return db.query.scheduledCheckIns.findMany({
        where: eq(scheduledCheckIns.active, true),
      });
    },

    async update(id: string, fields: { schedule?: string; purpose?: string; hint?: string; active?: boolean }) {
      const [updated] = await db
        .update(scheduledCheckIns)
        .set(fields)
        .where(eq(scheduledCheckIns.id, id))
        .returning();
      return updated;
    },

    async remove(id: string) {
      const [deleted] = await db
        .delete(scheduledCheckIns)
        .where(eq(scheduledCheckIns.id, id))
        .returning();
      return deleted;
    },
  };
}
