import { $ } from 'bun';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// In dev, no VERSION file exists and we read the short hash from git. The
// distribution pack script writes a VERSION file at the dist root so the
// version remains resolvable without a `.git` directory.
export async function resolveVersion(root: string): Promise<string> {
  const versionFile = join(root, 'VERSION');
  if (existsSync(versionFile)) {
    return readFileSync(versionFile, 'utf-8').trim();
  }
  return (await $`git rev-parse --short HEAD`.quiet()).text().trim();
}
