import { pgTable, uuid, text, timestamp, date, boolean } from 'drizzle-orm/pg-core';

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

export const visions = pgTable('visions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const milestones = pgTable('milestones', {
  id: uuid('id').defaultRandom().primaryKey(),
  visionId: uuid('vision_id')
    .notNull()
    .references(() => visions.id),
  title: text('title').notNull(),
  targetDate: date('target_date'),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const weeklyStrategies = pgTable('weekly_strategies', {
  id: uuid('id').defaultRandom().primaryKey(),
  milestoneId: uuid('milestone_id')
    .notNull()
    .references(() => milestones.id),
  title: text('title').notNull(),
  weekStart: date('week_start'),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const dailyTasks = pgTable('daily_tasks', {
  id: uuid('id').defaultRandom().primaryKey(),
  strategyId: uuid('strategy_id')
    .notNull()
    .references(() => weeklyStrategies.id),
  title: text('title').notNull(),
  scheduledDate: date('scheduled_date'),
  completed: boolean('completed').notNull().default(false),
  reflection: text('reflection'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
