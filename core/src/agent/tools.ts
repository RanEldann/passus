import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { createGoalRepository } from '../db/goals.js';
import { createCheckInRepository } from '../db/checkins.js';

const planStepSchema = z.object({
  order: z.number().describe('Step order (1, 2, 3...)'),
  title: z.string().describe('Period label (e.g. "Week 1", "Month 1", "Day 1")'),
  target: z.string().describe('What to achieve in this period'),
  startDate: z.string().describe('Step period start date in YYYY-MM-DD format'),
  endDate: z.string().describe('Step period end date in YYYY-MM-DD format'),
});

export function createAgentTools(db: Db, userId: string) {
  const goalRepo = createGoalRepository(db);
  const checkInRepo = createCheckInRepository(db);

  const createGoal = tool(
    async ({ title, description, startDate, targetDate }) => {
      console.log(`[tool] create_goal(${JSON.stringify({ title, description, startDate, targetDate })})`);
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
      console.log(`[tool] create_plan(${JSON.stringify({ goalId, description, steps })})`);
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
      console.log(`[tool] adjust_plan(${JSON.stringify({ planId, steps })})`);
      const plan = await goalRepo.adjustPlan(planId, steps);
      return JSON.stringify(plan);
    },
    {
      name: 'adjust_plan',
      description:
        'Adjust an existing plan by creating a new version with updated steps. The old version is preserved for history. Use after a retro or when circumstances change.',
      schema: z.object({
        planId: z.string().describe('ID of the current live plan to adjust'),
        steps: z.array(planStepSchema).describe('Updated list of plan steps'),
      }),
    },
  );

  const updateGoalStatus = tool(
    async ({ goalId, status }) => {
      console.log(`[tool] update_goal_status(${JSON.stringify({ goalId, status })})`);
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
      console.log(`[tool] get_goals(${JSON.stringify({})})`);
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
      console.log(`[tool] log_checkpoint(${JSON.stringify({ goalId, periodStart, periodEnd, status, data })})`);
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

  const createCheckIn = tool(
    async ({ goalId, schedule, purpose, hint }) => {
      console.log(`[tool] create_check_in(${JSON.stringify({ goalId, schedule, purpose, hint })})`);
      const checkIn = await checkInRepo.create(goalId, schedule, purpose, hint);
      return JSON.stringify(checkIn);
    },
    {
      name: 'create_check_in',
      description:
        'Schedule a recurring check-in for a goal. The check-in will fire on the cron schedule and prompt the user. ' +
        'Use this after creating a plan to set up the right check-in cadence. ' +
        'You can create multiple check-ins per goal with different cadences and purposes (e.g., daily logging + weekly retro).',
      schema: z.object({
        goalId: z.string().describe('ID of the goal'),
        schedule: z
          .string()
          .describe(
            'Cron expression for when to check in. Examples: "0 18 * * 1-5" (weekdays 6pm), "0 9 * * 0" (Sundays 9am), "0 9 8-14 * 1" (2nd Monday of month)',
          ),
        purpose: z.string().describe('Short label (e.g. "Daily hours log", "Weekly retro")'),
        hint: z
          .string()
          .describe(
            'Instructions for yourself on what to do during this check-in. Be specific about what to ask and what data to log.',
          ),
      }),
    },
  );

  const listCheckIns = tool(
    async ({ goalId }) => {
      console.log(`[tool] list_check_ins(${JSON.stringify({ goalId })})`);
      const checkIns = await checkInRepo.getByGoal(goalId);
      if (checkIns.length === 0) return 'No check-ins scheduled for this goal.';
      return JSON.stringify(checkIns, null, 2);
    },
    {
      name: 'list_check_ins',
      description: 'List all scheduled check-ins for a goal.',
      schema: z.object({
        goalId: z.string().describe('ID of the goal'),
      }),
    },
  );

  const updateCheckIn = tool(
    async ({ checkInId, schedule, purpose, hint, active }) => {
      console.log(`[tool] update_check_in(${JSON.stringify({ checkInId, schedule, purpose, hint, active })})`);
      const updated = await checkInRepo.update(checkInId, { schedule, purpose, hint, active });
      return JSON.stringify(updated);
    },
    {
      name: 'update_check_in',
      description: 'Update a scheduled check-in. Can change the schedule, purpose, hint, or pause/resume it.',
      schema: z.object({
        checkInId: z.string().describe('ID of the check-in to update'),
        schedule: z.string().optional().describe('New cron expression'),
        purpose: z.string().optional().describe('New purpose label'),
        hint: z.string().optional().describe('New hint/instructions'),
        active: z.boolean().optional().describe('Set to false to pause, true to resume'),
      }),
    },
  );

  const deleteCheckIn = tool(
    async ({ checkInId }) => {
      console.log(`[tool] delete_check_in(${JSON.stringify({ checkInId })})`);
      const deleted = await checkInRepo.remove(checkInId);
      return deleted ? 'Deleted.' : 'Not found.';
    },
    {
      name: 'delete_check_in',
      description: 'Delete a scheduled check-in.',
      schema: z.object({
        checkInId: z.string().describe('ID of the check-in to delete'),
      }),
    },
  );

  return [
    createGoal,
    createPlan,
    adjustPlan,
    updateGoalStatus,
    getGoals,
    logCheckpoint,
    createCheckIn,
    listCheckIns,
    updateCheckIn,
    deleteCheckIn,
  ];
}
