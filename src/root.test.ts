import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import path from 'node:path';

describe('ROOT_DIR', () => {
  const originalEnv = process.env.GLIMPSE_TTY_ROOT;

  beforeEach(() => {
    delete require.cache[require.resolve('./root')];
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.GLIMPSE_TTY_ROOT;
    } else {
      process.env.GLIMPSE_TTY_ROOT = originalEnv;
    }
    delete require.cache[require.resolve('./root')];
  });

  test('falls back to repo root (parent of src/) when GLIMPSE_TTY_ROOT is unset', () => {
    delete process.env.GLIMPSE_TTY_ROOT;
    const { ROOT_DIR } = require('./root');
    expect(ROOT_DIR).toBe(path.resolve(__dirname, '..'));
  });

  test('uses GLIMPSE_TTY_ROOT when set', () => {
    process.env.GLIMPSE_TTY_ROOT = '/tmp/some/dist';
    const { ROOT_DIR } = require('./root');
    expect(ROOT_DIR).toBe('/tmp/some/dist');
  });

  test('empty GLIMPSE_TTY_ROOT falls back to repo root', () => {
    process.env.GLIMPSE_TTY_ROOT = '';
    const { ROOT_DIR } = require('./root');
    expect(ROOT_DIR).toBe(path.resolve(__dirname, '..'));
  });
});
