import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { createGoalRepository } from '../db/goals.js';

export function createAgentTools(db: Db, userId: string) {
  const goalRepo = createGoalRepository(db);

  const createVision = tool(
    async ({ title, description }) => {
      const vision = await goalRepo.createVision(userId, title, description);
      return JSON.stringify(vision);
    },
    {
      name: 'create_vision',
      description:
        'Create a new high-level vision/goal for the user. Use this after understanding what the user wants to achieve.',
      schema: z.object({
        title: z.string().describe('Short title for the vision'),
        description: z.string().optional().describe('Detailed description of the vision'),
      }),
    },
  );

  const createMilestone = tool(
    async ({ visionId, title, targetDate }) => {
      const milestone = await goalRepo.createMilestone(visionId, title, targetDate);
      return JSON.stringify(milestone);
    },
    {
      name: 'create_milestone',
      description:
        'Create a milestone under a vision. Milestones are major checkpoints on the way to achieving the vision.',
      schema: z.object({
        visionId: z.string().describe('ID of the parent vision'),
        title: z.string().describe('Short title for the milestone'),
        targetDate: z.string().optional().describe('Target date in YYYY-MM-DD format'),
      }),
    },
  );

  const createWeeklyStrategy = tool(
    async ({ milestoneId, title, weekStart }) => {
      const strategy = await goalRepo.createWeeklyStrategy(milestoneId, title, weekStart);
      return JSON.stringify(strategy);
    },
    {
      name: 'create_weekly_strategy',
      description:
        'Create a weekly strategy under a milestone. These are specific weekly focuses that drive milestone progress.',
      schema: z.object({
        milestoneId: z.string().describe('ID of the parent milestone'),
        title: z.string().describe('What to focus on this week'),
        weekStart: z.string().optional().describe('Week start date in YYYY-MM-DD format'),
      }),
    },
  );

  const createDailyTask = tool(
    async ({ strategyId, title, scheduledDate }) => {
      const task = await goalRepo.createDailyTask(strategyId, title, scheduledDate);
      return JSON.stringify(task);
    },
    {
      name: 'create_daily_task',
      description:
        'Create a daily task under a weekly strategy. These are concrete actions the user should do on a specific day.',
      schema: z.object({
        strategyId: z.string().describe('ID of the parent weekly strategy'),
        title: z.string().describe('What to do'),
        scheduledDate: z.string().optional().describe('Scheduled date in YYYY-MM-DD format'),
      }),
    },
  );

  const getGoals = tool(
    async () => {
      const plan = await goalRepo.getFullPlan(userId);
      if (plan.length === 0) return 'No goals yet.';
      return JSON.stringify(plan, null, 2);
    },
    {
      name: 'get_goals',
      description: "Get the user's current goals and full fractal plan.",
      schema: z.object({}),
    },
  );

  return [createVision, createMilestone, createWeeklyStrategy, createDailyTask, getGoals];
}
