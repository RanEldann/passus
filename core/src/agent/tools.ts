import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { createGoalRepository } from '../db/goals.js';

const planStepSchema = z.object({
  order: z.number().describe('Step order (1, 2, 3...)'),
  title: z.string().describe('Period label (e.g. "Week 1", "Month 1", "Day 1")'),
  target: z.string().describe('What to achieve in this period'),
});

export function createAgentTools(db: Db, userId: string) {
  const goalRepo = createGoalRepository(db);

  const createGoal = tool(
    async ({ title, description, startDate, targetDate }) => {
      const goal = await goalRepo.createGoal(userId, title, {
        description,
        startDate,
        targetDate,
      });
      return JSON.stringify(goal);
    },
    {
      name: 'create_goal',
      description:
        'Create a specific, measurable goal for the user. Use after helping them refine a vague vision into something concrete with a target date.',
      schema: z.object({
        title: z.string().describe('Specific goal title (e.g. "Run a marathon in under 4 hours")'),
        description: z.string().optional().describe('Additional context about the goal'),
        startDate: z.string().optional().describe('Start date in YYYY-MM-DD format'),
        targetDate: z.string().optional().describe('Target date in YYYY-MM-DD format'),
      }),
    },
  );

  const createPlan = tool(
    async ({ goalId, description, steps }) => {
      const plan = await goalRepo.createPlan(goalId, description, steps);
      return JSON.stringify(plan);
    },
    {
      name: 'create_plan',
      description:
        'Create a plan for a goal. The plan has steps with a cadence appropriate to the goal (weekly, monthly, etc).',
      schema: z.object({
        goalId: z.string().describe('ID of the goal this plan is for'),
        description: z.string().describe('Overview of the plan approach'),
        steps: z.array(planStepSchema).describe('Ordered list of plan steps'),
      }),
    },
  );

  const adjustPlan = tool(
    async ({ planId, steps }) => {
      const plan = await goalRepo.adjustPlan(planId, steps);
      return JSON.stringify(plan);
    },
    {
      name: 'adjust_plan',
      description: 'Adjust an existing plan by creating a new version with updated steps. The old version is preserved for history. Use after a retro or when circumstances change.',
      schema: z.object({
        planId: z.string().describe('ID of the current live plan to adjust'),
        steps: z.array(planStepSchema).describe('Updated list of plan steps'),
      }),
    },
  );

  const updateGoalStatus = tool(
    async ({ goalId, status }) => {
      const goal = await goalRepo.updateGoalStatus(goalId, status);
      return JSON.stringify(goal);
    },
    {
      name: 'update_goal_status',
      description: 'Update the status of a goal.',
      schema: z.object({
        goalId: z.string().describe('ID of the goal'),
        status: z
          .enum(['not_started', 'on_track', 'at_risk', 'completed', 'missed', 'profited'])
          .describe('New status'),
      }),
    },
  );

  const getGoals = tool(
    async () => {
      const userGoals = await goalRepo.getGoalsByUser(userId);
      if (userGoals.length === 0) return 'No goals yet.';
      const fullGoals = await Promise.all(
        userGoals.map((g) => goalRepo.getFullGoal(g.id)),
      );
      return JSON.stringify(fullGoals, null, 2);
    },
    {
      name: 'get_goals',
      description: "Get all of the user's goals with their plans and checkpoints.",
      schema: z.object({}),
    },
  );

  const logCheckpoint = tool(
    async ({ goalId, periodStart, periodEnd, status, data }) => {
      const checkpoint = await goalRepo.createCheckpoint(
        goalId,
        periodStart,
        periodEnd,
        status,
        data,
      );
      return JSON.stringify(checkpoint);
    },
    {
      name: 'log_checkpoint',
      description:
        'Log a checkpoint for a goal. Records what the user achieved in a specific period.',
      schema: z.object({
        goalId: z.string().describe('ID of the goal'),
        periodStart: z.string().describe('Period start date in YYYY-MM-DD format'),
        periodEnd: z.string().describe('Period end date in YYYY-MM-DD format'),
        status: z
          .enum(['completed', 'not_completed', 'completed_partially'])
          .describe('How the user did in this period'),
        data: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Progress data (e.g. { "distance_km": 10, "runs": 3 })'),
      }),
    },
  );

  return [createGoal, createPlan, adjustPlan, updateGoalStatus, getGoals, logCheckpoint];
}
