import { pgTable, uuid, text, timestamp, date, boolean, jsonb, integer } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const threads = pgTable('threads', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const goals = pgTable('goals', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  title: text('title').notNull(),
  description: text('description'),
  startDate: date('start_date'),
  targetDate: date('target_date'),
  active: boolean('active').notNull().default(true),
  status: text('status').notNull().default('not_started'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const plans = pgTable('plans', {
  id: uuid('id').defaultRandom().primaryKey(),
  goalId: uuid('goal_id')
    .notNull()
    .references(() => goals.id),
  version: integer('version').notNull().default(1),
  description: text('description'),
  steps: jsonb('steps').$type<PlanStep[]>().notNull().default([]),
  status: text('status').notNull().default('live'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export interface PlanStep {
  order: number;
  title: string;
  target: string;
  startDate: string;
  endDate: string;
}

export const checkpoints = pgTable('goal_checkpoints', {
  id: uuid('id').defaultRandom().primaryKey(),
  goalId: uuid('goal_id')
    .notNull()
    .references(() => goals.id),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  status: text('status').notNull().default('not_completed'),
  data: jsonb('data').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
