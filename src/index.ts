import { app, dialog } from 'electron';
import { EscapeType, cleanupInput, listenForInput, setupInput } from 'awrit-native';
import type { InputEvent } from 'awrit-native';
import * as out from './tty/output';
import { handleInput } from './inputHandler';
import { focusedView, windowSize, createWindowWithToolbar } from './windows';
import { DPI_SCALE } from './dpi';
import { console_ } from './console';
import { options, showHelp } from './args';
import { execSync } from 'node:child_process';

if (options.help) {
  showHelp();
  process.exit(0);
}

if (options.version) {
  const version = execSync('git rev-parse --short HEAD').toString().trim();
  console_.log('awrit', version);
  process.exit(0);
}

// Don't show a dialog box on uncaught errors
dialog.showErrorBox = (title, content) => {
  console_.error(title, content);
};

const INITIAL_URL = options.url || 'https://github.com/chase/awrit';

let exiting = false;
let quitListening = () => {};

const cleanup = (signum = 1) => {
  exiting = true;
  quitListening();
  cleanupInput();
  out.cleanup();
  process.exit(signum);
};

function resizeHandler(size: { width: number; height: number }) {
  if (windowSize.width === size.width && windowSize.height === size.height) return;

  Object.assign(windowSize, size);
  const view = focusedView.current;
  if (!view) {
    return;
  }

  /* This doesn't work for some reason
  win.setContentSize(windowSize.width, windowSize.height, false);
  win.setSize(windowSize.width, windowSize.height, false);
  win.webContents.send('resize', windowSize);
  // win.webContents.invalidate();
  */
}

function inputHandler(evt: InputEvent) {
  if (evt.type === EscapeType.Key && evt.code === 'c' && evt.modifiers.includes('ctrl')) {
    quitListening();
    cleanup(0);
  }

  if (evt.type === EscapeType.CSI && evt.data.startsWith('4') && evt.data.endsWith('t')) {
    const [height, width] = evt.data.slice(2, -1).split(';');
    resizeHandler({ width: Number.parseInt(width), height: Number.parseInt(height) });
  }

  if (evt.type === EscapeType.APC && evt.data.startsWith('Gi=')) {
    console_.error('Graphics protocol: ', evt.data);
    // const status = ParseGFXStatus(evt.data);
    // if (status?.error) {
    //   console_.error('Graphics protocol error: ', status.error);
    // } else if (status?.ok) {
    //   console_.error('Graphics protocol: OK');
    //   setKittyGraphicsSupported(true);
    // }
  }
  handleInput(evt);
}

function setup() {
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('SIGABRT', cleanup);
  process.on('SIGWINCH', () => {
    out.requestWindowSize();
  });

  out.setup();
  setupInput();
  quitListening = listenForInput(inputHandler);

  out.clearScreen();
  out.placeCursor({ x: 0, y: 0 });
  out.requestWindowSize();
}

setup();

// Prevents high DPI scaling based on host display
app.commandLine.appendSwitch('force-device-scale-factor', DPI_SCALE.toString());
app.commandLine.appendSwitch('high-dpi-support', 'true');

// Disable Electron's stdout logging
app.commandLine.appendSwitch('log-level', '0');
app.commandLine.appendSwitch('disable-logging');
// Disable Chrome DevTools logging
app.commandLine.appendSwitch('silent-debugger-extension-api');

app.whenReady().then(() => {
  // Use our new function to create a window with toolbar
  createWindowWithToolbar(windowSize, INITIAL_URL);
});
