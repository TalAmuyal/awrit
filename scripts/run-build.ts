// Standalone entry that the pack script invokes via `bun run`. Calls the same
// build helpers the runner uses, with no Electron launch. Lives next to
// build.ts so the relative imports stay simple.

import { resolve } from 'node:path';
import { buildIndex, buildMarkdownExtension } from './build';

const root = resolve(__dirname, '..');

await buildIndex(root);
await buildMarkdownExtension(root);
