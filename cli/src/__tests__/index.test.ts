import { describe, it, expect } from 'vitest';
import { VERSION } from '@passus/core';

describe('cli', () => {
  it('should have access to core version', () => {
    expect(VERSION).toBeDefined();
  });
});
