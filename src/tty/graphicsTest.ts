import {
  ShmGraphicBuffer,
  setupInput,
  cleanupInput,
  listenForInput,
  EscapeType,
} from 'awrit-native';
import { clearPlacements, paintInitialFrame } from './kittyGraphics';
import * as out from './output';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { platform } from 'node:os';
import { ParseGFXStatus } from './escapeCodes';

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let quitListening = () => {};

const cleanup = (signum = 1) => {
  quitListening();
  cleanupInput();
  out.cleanup();
  return process.exit(signum);
};

const id = randomBytes(4).toString('hex');
const GFX_TEST_WHITE = '/gfx-test-white-' + id;
const GFX_TEST_RED = '/gfx-test-red-' + id;
const GFX_TEST_FINCH = '/gfx-test-finch-' + id;
const finchBgra = readFileSync(join(__dirname, 'finch-bgra.raw'));
let white: ShmGraphicBuffer | undefined = new ShmGraphicBuffer(GFX_TEST_WHITE);
let red: ShmGraphicBuffer | undefined = new ShmGraphicBuffer(GFX_TEST_RED);
let finch: ShmGraphicBuffer | undefined = new ShmGraphicBuffer(GFX_TEST_FINCH);
const { promise: kittyGraphicsSupported, resolve: setKittyGraphicsSupported } =
  Promise.withResolvers<boolean>();

async function main() {
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('SIGABRT', cleanup);

  white?.write(Buffer.alloc(256 * 256 * 4, 255), { width: 256, height: 256 });
  red?.write(Buffer.alloc(8 * 8 * 4, new Uint8Array([0, 0, 255, 255])), { width: 8, height: 8 });
  finch?.write(finchBgra, { width: 100, height: 75 });
  if (platform() === 'linux') {
    // Check if the shared memory files exist under /dev/shm
    const shmFiles = [
      `/dev/shm${GFX_TEST_WHITE}`,
      `/dev/shm${GFX_TEST_RED}`,
      `/dev/shm${GFX_TEST_FINCH}`,
    ];
    for (const file of shmFiles) {
      const exists = existsSync(file);
      console.log(`${file} exists: ${exists}`);
    }
  }

  out.setup();
  setupInput();
  out.placeCursor({ x: 0, y: 0 });
  quitListening = listenForInput((evt) => {
    if (evt.type === EscapeType.Key && evt.code === 'c' && evt.modifiers.includes('ctrl')) {
      cleanup(0);
    }
    if (evt.type === EscapeType.APC && evt.data.startsWith('Gi=')) {
      const status = ParseGFXStatus(evt.data);
      if (status?.error) {
        out.clearScreen();
        console.error('Graphics protocol error: ', status.error);
      } else if (status?.ok) {
        setKittyGraphicsSupported(true);
      }
    }
  });

  const { loadFrame, free } = paintInitialFrame(GFX_TEST_WHITE, { width: 256, height: 256 });
  const supported = await Promise.race([
    kittyGraphicsSupported,
    new Promise((resolve) => setTimeout(() => resolve(false), 10)),
  ]);
  if (!supported) {
    process.stderr.write('Graphics protocol is not supported\r\n');
    await pause(1000);
    throw cleanup();
  }

  let isRed = false;
  for (let i = 0; i < 256; i += 8) {
    isRed = !isRed;
    red?.write(
      Buffer.alloc(8 * 8 * 4, new Uint8Array([isRed ? 0 : 255, 0, isRed ? 255 : 0, 255])),
      {
        width: 8,
        height: 8,
      },
    );
    const redFrame = loadFrame(2, GFX_TEST_RED, { width: 8, height: 8 });
    redFrame.composite({ x: i, y: i, width: 8, height: 8 });
    await pause(20);
  }
  if (!finch) {
    console.error('finch is undefined');
    throw cleanup();
  }
  let finchFrame = loadFrame(3, GFX_TEST_FINCH, { width: 100, height: 75 });
  finchFrame.composite({ x: 128, y: 128, width: 100, height: 75 });

  await pause(20);
  const finchBgraFlipped = Buffer.alloc(finchBgra.length);
  for (let i = 0; i < finchBgra.length; i += 4) {
    finchBgra.copy(finchBgraFlipped, finchBgra.length - i - 4, i, i + 4);
  }
  const dirtyRect = finch.write(
    finchBgraFlipped,
    { width: 100, height: 75 },
    { x: 0, y: 0, width: 55, height: 75 },
  );
  if (dirtyRect.width % 4 !== 0) {
    console.error('first dirtyRect.width % 4 !== 0');
    throw cleanup();
  }
  finchFrame.delete();
  await pause(20);
  finchFrame = loadFrame(3, GFX_TEST_FINCH, { width: 100, height: 75 });
  finchFrame.composite({
    x: dirtyRect.x,
    y: dirtyRect.y,
    width: dirtyRect.width,
    height: dirtyRect.height,
  });

  finch.write(
    finchBgraFlipped,
    { width: 100, height: 75 },
    { x: dirtyRect.width, y: 0, width: 100 - dirtyRect.width, height: 75 },
  );

  finchFrame = loadFrame(3, GFX_TEST_FINCH, { width: 100, height: 75 });
  finchFrame.composite({
    x: 0,
    y: 0,
    width: 100,
    height: 75,
  });

  await pause(1000);
  white?.write(Buffer.alloc(256 * 256 * 4, new Uint8Array([255, 0, 255, 255])), {
    width: 256,
    height: 256,
  });
  loadFrame(1, GFX_TEST_WHITE, { width: 256, height: 256 });
  await pause(1000);

  clearPlacements();
  free();
  cleanup(0);
  white = undefined;
  red = undefined;
  finch = undefined;
}

main();
