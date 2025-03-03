import type { BrowserWindow } from 'electron';
import { randomBytes } from 'node:crypto';
import { ShmGraphicBuffer } from 'awrit-native';
import type { InitialFrame, AnimationFrame } from './tty/kittyGraphics';
import { console_ } from './console';
import { options } from './args';

type PaintedContent = {
  id: string;
  frame?: AnimationFrame;
  compositeBuffer: ShmGraphicBuffer;
};

const weakPaintedContents_ = new WeakMap<BrowserWindow, PaintedContent>();

export function registerPaintedContent(
  containerFrame: InitialFrame,
  w: BrowserWindow,
  position: { x: number; y: number },
): PaintedContent {
  const id = randomBytes(16).toString('hex');
  const compositeName = `awrit-${id}`;
  const compositeBuffer = new ShmGraphicBuffer(compositeName);
  console_.error('registerPaintedContent', id, compositeName);

  const contents = w.webContents;
  const result: PaintedContent = {
    id,
    compositeBuffer,
  };
  const frameNumber = 2 + containerFrame.paintedContent++;

  function cleanup() {
    weakPaintedContents_.delete(w);
    console_.error('cleanup', id);
  }

  w.on('resize', () => {
    // result.frame?.delete();
    // result.frame = containerFrame.loadFrame(2, compositeName, bounds);
    // console_.error('bounds-changed', id, bounds);
  });

  contents.on('paint', async (_event, _dirty, image) => {
    if (options['no-paint']) {
      return;
    }

    const imageSize = image.getSize();

    const buffer = image.getBitmap();
    compositeBuffer.write(buffer, imageSize);
    containerFrame.loadFrame(frameNumber, compositeName, imageSize).composite({
      ...imageSize,
      ...position,
    });
  });
  contents.on('render-process-gone', cleanup);
  contents.on('destroyed', cleanup);

  weakPaintedContents_.set(w, result);
  return result;
}
