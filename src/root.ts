import path from 'node:path';

// Distribution root. Bun's bundler inlines __dirname per source module as the
// original source location (<repo>/src/), so the dev fallback resolves to the
// repo root. The launcher in a packed distribution sets GLIMPSE_TTY_ROOT to
// the relocated distribution root.
export const ROOT_DIR: string =
  process.env.GLIMPSE_TTY_ROOT || path.resolve(__dirname, '..');
