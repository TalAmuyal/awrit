import { createServer } from 'vite';
import viteConfig from './vite.config';

console.log = (...args: any[]) => {
  console.error(...args);
};

export const server = await createServer(viteConfig);
