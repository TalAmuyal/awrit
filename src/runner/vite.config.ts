import type { UserConfig } from 'vite';
import solid from 'vite-plugin-solid';
import tailwind from '@tailwindcss/vite';
import * as path from 'node:path';
import { TOOLBAR_PORT } from './ports';

export default {
  plugins: [solid(), tailwind()],
  base: '',
  root: path.resolve(__dirname, '../toolbar'),
  server: {
    port: TOOLBAR_PORT,
  },
  build: {
    outDir: '../../dist/toolbar',
    emptyOutDir: true,
    sourcemap: true,
  },
  clearScreen: false,
} satisfies UserConfig;
