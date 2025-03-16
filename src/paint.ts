import type { BrowserWindow } from 'electron';
import { getWindowSize, ShmGraphicBuffer } from 'awrit-native-rs';
import {
  type InitialFrame,
  type AnimationFrame,
  type PaintedImage,
  paintImage,
} from './tty/kittyGraphics';
import { console_ } from './console';
import { options } from './args';
import type { LayoutNode } from './layout';
import { features } from './features';
import { abort } from './abort';

type PaintedContent = {
  frame?: AnimationFrame;
  buffer?: ShmGraphicBuffer;
  size?: number;
  expectedWinSize?: {
    width: number;
    height: number;
  };
};

const weakPaintedContents_ = new WeakMap<BrowserWindow, PaintedContent>();

// assumes animation is supported
export function registerPaintedContent(
  containerFrame: InitialFrame,
  w: BrowserWindow,
  layoutNode: LayoutNode,
): PaintedContent {
  const contents = w.webContents;
  const result: PaintedContent = {};
  const frameNumber = 2 + containerFrame.paintedContent++;

  w.on('resize', () => {
    // result.frame?.delete();
    // result.frame = containerFrame.loadFrame(2, compositeName, bounds);
    // console_.error('bounds-changed', id, bounds);
  });

  if (!features.current) {
    console_.error('No features available');
    abort();
  }

  contents.on('paint', async function paint(_: any, _dirty, image) {
    const imageSize = image.getSize();

    const imageBufferSize = imageSize.width * imageSize.height * 4;
    if (result.buffer == null) {
      result.buffer = new ShmGraphicBuffer(imageBufferSize);
    }
    if (options['debug-paint']) {
      console_.error('paint', result.buffer.nameBase64, image.getSize());
    }
    if (options['no-paint']) {
      return;
    }

    if (result.size != null && imageBufferSize > result.size) {
      if (options['debug-paint']) {
        console_.error('replace buffer', result.buffer.nameBase64, result.size, imageBufferSize);
      }
      result.buffer = new ShmGraphicBuffer(imageBufferSize);
      result.size = imageBufferSize;
    }

    const buffer = image.getBitmap();
    result.buffer.write(buffer, imageSize.width);
    containerFrame
      .loadFrame(frameNumber, result.buffer, imageSize)
      .composite(layoutNode.deviceLayout);
  });

  weakPaintedContents_.set(w, result);
  return result;
}

function coordsFromPx(cellToPx: number, px: number) {
  return {
    cell: Math.ceil(px / cellToPx),
    px: Math.ceil(px % cellToPx),
  };
}

export function registerPaintedContentFallback(
  w: BrowserWindow,
  layoutNode: LayoutNode,
): PaintedContent {
  const contents = w.webContents;
  const result: PaintedContent = {};
  const termSize = getWindowSize();
  const cellToPxX = termSize.width / termSize.cols;
  const cellToPxY = termSize.height / termSize.rows;
  let paintedImage: PaintedImage | undefined;

  // only have basic image support
  contents.on('paint', async function paint(_: any, _dirty, image) {
    const imageSize = image.getSize();
    const imageBufferSize = imageSize.width * imageSize.height * 4;

    const position = {
      x: coordsFromPx(cellToPxX, layoutNode.deviceLayout.x),
      y: coordsFromPx(cellToPxY, layoutNode.deviceLayout.y),
    };

    let replace = true;
    if (result.buffer == null || (result.size != null && imageBufferSize > result.size)) {
      replace = false;
      const buffer = new ShmGraphicBuffer(imageBufferSize);
      paintedImage?.free();
      buffer.write(image.getBitmap(), imageSize.width);
      paintedImage = paintImage(buffer, imageSize, position);

      result.buffer = buffer;
      result.size = imageBufferSize;
    }
    if (options['debug-paint']) {
      console_.error('paint', result.buffer.nameBase64, image.getSize());
    }
    if (options['no-paint']) {
      return;
    }

    if (replace && paintedImage) {
      paintedImage.replace(image.getBitmap());
    }
  });

  weakPaintedContents_.set(w, result);
  return result;
}
