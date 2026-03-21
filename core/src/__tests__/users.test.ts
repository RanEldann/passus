import { describe, it, expect, afterAll } from 'vitest';
import { createDb } from '../db/index.js';
import { createUserRepository } from '../db/users.js';
import postgres from 'postgres';

const TEST_DB_URL = process.env.DATABASE_URL ?? 'postgresql://localhost:5432/passus';

describe('userRepository', () => {
  const { db, close: closeDb } = createDb(TEST_DB_URL);
  const repo = createUserRepository(db);
  const createdIds: string[] = [];

  afterAll(async () => {
    if (createdIds.length > 0) {
      const client = postgres(TEST_DB_URL);
      await client`DELETE FROM users WHERE id = ANY(${createdIds}::uuid[])`;
      await client.end();
    }
    await closeDb();
  });

  it('should create a user', async () => {
    const user = await repo.create('Test User');
    createdIds.push(user.id);

    expect(user.name).toBe('Test User');
    expect(user.id).toBeDefined();
    expect(user.createdAt).toBeInstanceOf(Date);
  });

  it('should find a user by id', async () => {
    const created = await repo.create('Find Me');
    createdIds.push(created.id);

    const found = await repo.findById(created.id);

    expect(found?.name).toBe('Find Me');
  });

  it('should return undefined for non-existent id', async () => {
    const found = await repo.findById('00000000-0000-0000-0000-000000000000');

    expect(found).toBeUndefined();
  });

  it('should list all users', async () => {
    const all = await repo.findAll();

    expect(all.length).toBeGreaterThanOrEqual(1);
  });
});
