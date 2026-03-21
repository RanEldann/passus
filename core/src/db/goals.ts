import { eq } from 'drizzle-orm';
import type { Db } from './index.js';
import { goals, plans, checkpoints } from './schema.js';
import type { PlanStep } from './schema.js';

export function createGoalRepository(db: Db) {
  return {
    async createGoal(
      userId: string,
      title: string,
      opts?: { description?: string; startDate?: string; targetDate?: string },
    ) {
      const [goal] = await db
        .insert(goals)
        .values({ userId, title, ...opts })
        .returning();
      return goal;
    },

    async updateGoalStatus(goalId: string, status: string) {
      const [goal] = await db
        .update(goals)
        .set({ status })
        .where(eq(goals.id, goalId))
        .returning();
      return goal;
    },

    async getGoalsByUser(userId: string) {
      return db.query.goals.findMany({ where: eq(goals.userId, userId) });
    },

    async getGoalById(goalId: string) {
      return db.query.goals.findFirst({ where: eq(goals.id, goalId) });
    },

    async createPlan(goalId: string, description: string, steps: PlanStep[]) {
      const [plan] = await db
        .insert(plans)
        .values({ goalId, description, steps })
        .returning();
      return plan;
    },

    async updatePlanSteps(planId: string, steps: PlanStep[]) {
      const [plan] = await db
        .update(plans)
        .set({ steps })
        .where(eq(plans.id, planId))
        .returning();
      return plan;
    },

    async getPlansByGoal(goalId: string) {
      return db.query.plans.findMany({ where: eq(plans.goalId, goalId) });
    },

    async createCheckpoint(
      goalId: string,
      periodStart: string,
      periodEnd: string,
      status: string,
      data?: Record<string, unknown>,
    ) {
      const [checkpoint] = await db
        .insert(checkpoints)
        .values({ goalId, periodStart, periodEnd, status, data })
        .returning();
      return checkpoint;
    },

    async getCheckpointsByGoal(goalId: string) {
      return db.query.checkpoints.findMany({ where: eq(checkpoints.goalId, goalId) });
    },

    async getFullGoal(goalId: string) {
      const goal = await db.query.goals.findFirst({ where: eq(goals.id, goalId) });
      if (!goal) return null;
      const goalPlans = await db.query.plans.findMany({ where: eq(plans.goalId, goalId) });
      const goalCheckpoints = await db.query.checkpoints.findMany({
        where: eq(checkpoints.goalId, goalId),
      });
      return { ...goal, plans: goalPlans, checkpoints: goalCheckpoints };
    },
  };
}
