import type { BrowserWindow } from 'electron';

export const windowSize: {
  width: number;
  height: number;
} = {
  width: 0,
  height: 0,
};

export const focusedWindow: {
  current: BrowserWindow | null;
  previous: BrowserWindow | null;
} = {
  current: null,
  previous: null,
};

export const managedWindows: BrowserWindow[] = [];