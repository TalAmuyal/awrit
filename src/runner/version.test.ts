import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveVersion } from './version';

describe('resolveVersion', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'glimpse-tty-version-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('reads VERSION file when present', async () => {
    writeFileSync(join(tmpRoot, 'VERSION'), '1.2.3\n');
    expect(await resolveVersion(tmpRoot)).toBe('1.2.3');
  });

  test('trims whitespace from VERSION file', async () => {
    writeFileSync(join(tmpRoot, 'VERSION'), '  abcdef0  \n\n');
    expect(await resolveVersion(tmpRoot)).toBe('abcdef0');
  });

  test('VERSION file takes precedence over git', async () => {
    // tmpRoot has no .git, so the git fallback would fail. The presence
    // of VERSION must be sufficient — proving the file path wins before
    // any git invocation occurs.
    writeFileSync(join(tmpRoot, 'VERSION'), 'from-file\n');
    expect(await resolveVersion(tmpRoot)).toBe('from-file');
  });
});
