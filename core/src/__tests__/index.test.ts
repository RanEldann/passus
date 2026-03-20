import { describe, it, expect } from 'vitest';
import { VERSION } from '../index.js';

describe('core', () => {
  it('should export a version', () => {
    expect(VERSION).toBe('0.0.1');
  });
});
