import { eq } from 'drizzle-orm';
import type { Db } from './index.js';
import { visions, milestones, weeklyStrategies, dailyTasks } from './schema.js';

export function createGoalRepository(db: Db) {
  return {
    async createVision(userId: string, title: string, description?: string) {
      const [vision] = await db.insert(visions).values({ userId, title, description }).returning();
      return vision;
    },

    async createMilestone(visionId: string, title: string, targetDate?: string) {
      const [milestone] = await db
        .insert(milestones)
        .values({ visionId, title, targetDate })
        .returning();
      return milestone;
    },

    async createWeeklyStrategy(milestoneId: string, title: string, weekStart?: string) {
      const [strategy] = await db
        .insert(weeklyStrategies)
        .values({ milestoneId, title, weekStart })
        .returning();
      return strategy;
    },

    async createDailyTask(strategyId: string, title: string, scheduledDate?: string) {
      const [task] = await db
        .insert(dailyTasks)
        .values({ strategyId, title, scheduledDate })
        .returning();
      return task;
    },

    async getVisionsByUser(userId: string) {
      return db.query.visions.findMany({ where: eq(visions.userId, userId) });
    },

    async getFullPlan(userId: string) {
      const userVisions = await db.query.visions.findMany({
        where: eq(visions.userId, userId),
      });

      const plan = [];
      for (const vision of userVisions) {
        const ms = await db.query.milestones.findMany({
          where: eq(milestones.visionId, vision.id),
        });

        const milestonesWithDetails = [];
        for (const m of ms) {
          const strategies = await db.query.weeklyStrategies.findMany({
            where: eq(weeklyStrategies.milestoneId, m.id),
          });

          const strategiesWithTasks = [];
          for (const s of strategies) {
            const tasks = await db.query.dailyTasks.findMany({
              where: eq(dailyTasks.strategyId, s.id),
            });
            strategiesWithTasks.push({ ...s, tasks });
          }
          milestonesWithDetails.push({ ...m, strategies: strategiesWithTasks });
        }
        plan.push({ ...vision, milestones: milestonesWithDetails });
      }

      return plan;
    },
  };
}
