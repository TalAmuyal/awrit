import { getWindowSize, ShmGraphicBuffer } from 'awrit-native-rs';
import type {
  BrowserWindow,
  Event as ElectronEvent,
  NativeImage,
  Rectangle,
  WebContentsPaintEventParams,
} from 'electron';
import { abort } from './abort';
import { options } from './args';
import { console_ } from './console';
import { features } from './features';
import type { LayoutNode } from './layout';
import {
  type AnimationFrame,
  type InitialFrame,
  type PaintedImage,
  paintImage,
} from './tty/kittyGraphics';

type PaintedContent = {
  frame?: AnimationFrame;
  buffer?: ShmGraphicBuffer;
  size?: number;
  expectedWinSize?: {
    width: number;
    height: number;
  };
  destroy(): void;
};

type PaintEvent = ElectronEvent<WebContentsPaintEventParams>;

const weakPaintedContents_ = new WeakMap<BrowserWindow, PaintedContent>();

// assumes animation is supported
export function registerPaintedContent(
  containerFrame: InitialFrame,
  w: BrowserWindow,
  layoutNode: LayoutNode,
): PaintedContent {
  const contents = w.webContents;
  const frameNumber = 2 + containerFrame.paintedContent++;
  const tag = layoutNode.tag ?? '?';
  let lastPaintTime = 0;

  w.on('resize', () => {
    // result.frame?.delete();
    // result.frame = containerFrame.loadFrame(2, compositeName, bounds);
    // console_.error('bounds-changed', id, bounds);
  });

  if (!features.current) {
    console_.error('No features available');
    abort();
  }

  const result: PaintedContent = {
    destroy() {
      contents.off('paint', paint);
      this.buffer = undefined;
      this.frame?.delete();
      this.frame = undefined;
    },
  };

  async function paint(event: PaintEvent, _dirty: Rectangle, image: NativeImage) {
    const t0 = performance.now();
    const dt = lastPaintTime ? t0 - lastPaintTime : 0;
    lastPaintTime = t0;

    // With useSharedTexture, image.getSize() can be 0x0; codedSize is authoritative.
    const codedSize = event.texture?.textureInfo.codedSize;
    const imageSize =
      codedSize && codedSize.width > 0 && codedSize.height > 0 ? codedSize : image.getSize();

    if (imageSize.width === 0 || imageSize.height === 0) {
      event.texture?.release();
      if (options['debug-paint']) {
        console_.error(`paint:${tag} dt=${dt.toFixed(1)} (skipped: 0x0 frame)`);
      }
      return;
    }

    const imageBufferSize = imageSize.width * imageSize.height * 4;
    if (result.buffer == null || result.size == null || imageBufferSize > result.size) {
      if (options['debug-paint'] && result.buffer != null) {
        console_.error('replace buffer', result.buffer.nameBase64, result.size, imageBufferSize);
      }
      result.buffer = new ShmGraphicBuffer(imageBufferSize);
      result.size = imageBufferSize;
    }
    if (options['no-paint']) {
      event.texture?.release();
      if (options['debug-paint']) {
        console_.error(
          `paint:${tag} dt=${dt.toFixed(1)} (no-paint) sz=${imageSize.width}x${imageSize.height}`,
        );
      }
      return;
    }

    // Electron 39+ delivers macOS IOSurfaceRef under handle.ioSurface.
    const ioSurface = event.texture?.textureInfo.handle.ioSurface;
    let pathTaken: 'tex' | 'bmp' | 'fail' = 'bmp';

    const tb0 = performance.now();
    let texturePathOk = false;
    if (ioSurface) {
      try {
        result.buffer.writeIosurface(ioSurface);
        pathTaken = 'tex';
        texturePathOk = true;
      } catch (err) {
        if (options['debug-paint']) {
          console_.error('writeIosurface failed; falling back to toBitmap:', err);
        }
      }
    }
    if (!texturePathOk) {
      try {
        const buffer = image.toBitmap();
        if (buffer.length === 0) {
          throw new Error('image.toBitmap() returned empty buffer (length 0)');
        }
        result.buffer.write(buffer, imageSize.width);
      } catch (err) {
        pathTaken = 'fail';
        if (options['debug-paint']) {
          console_.error('toBitmap fallback failed:', err);
        }
      }
    }
    event.texture?.release();
    const tb1 = performance.now();

    const sw0 = performance.now();
    if (pathTaken !== 'fail') {
      containerFrame
        .loadFrame(frameNumber, result.buffer, imageSize)
        .composite(layoutNode.deviceLayout);
    }
    const sw1 = performance.now();

    if (options['debug-paint']) {
      const niSize = image.getSize();
      const cs = event.texture?.textureInfo.codedSize;
      const fmt = event.texture?.textureInfo.pixelFormat ?? 'n/a';
      const dl = layoutNode.deviceLayout;
      console_.error(
        `paint:${tag} src=${pathTaken} fmt=${fmt} dt=${dt.toFixed(1)} tb=${(tb1 - tb0).toFixed(1)} sw=${(sw1 - sw0).toFixed(1)} ` +
          `sz=${imageSize.width}x${imageSize.height} ni=${niSize.width}x${niSize.height} cs=${cs?.width ?? 0}x${cs?.height ?? 0} ` +
          `dl=${dl.width}x${dl.height}@${dl.x},${dl.y}`,
      );
    }
  }

  contents.on('paint', paint);

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
  const termSize = getWindowSize();
  const cellToPxX = termSize.width / termSize.cols;
  const cellToPxY = termSize.height / termSize.rows;
  const tag = layoutNode.tag ?? '?';
  let lastPaintTime = 0;
  let paintedImage: PaintedImage | undefined;

  const result: PaintedContent = {
    destroy() {
      contents.off('paint', paint);
      this.buffer = undefined;
      paintedImage?.free();
      paintedImage = undefined;
    },
  };

  async function paint(_: any, _dirty: Rectangle, image: NativeImage) {
    const t0 = performance.now();
    const dt = lastPaintTime ? t0 - lastPaintTime : 0;
    lastPaintTime = t0;

    const imageSize = image.getSize();
    const imageBufferSize = imageSize.width * imageSize.height * 4;

    const position = {
      x: coordsFromPx(cellToPxX, layoutNode.deviceLayout.x),
      y: coordsFromPx(cellToPxY, layoutNode.deviceLayout.y),
    };

    if (options['no-paint']) {
      return;
    }

    let tbMs = 0;
    let swMs = 0;

    let replace = true;
    if (result.buffer == null || (result.size != null && imageBufferSize > result.size)) {
      replace = false;
      const buffer = new ShmGraphicBuffer(imageBufferSize);
      paintedImage?.free();
      const tb0 = performance.now();
      buffer.write(image.toBitmap(), imageSize.width);
      tbMs = performance.now() - tb0;
      const sw0 = performance.now();
      paintedImage = paintImage(buffer, imageSize, position);
      swMs = performance.now() - sw0;

      result.buffer = buffer;
      result.size = imageBufferSize;
    }

    if (replace && paintedImage) {
      const tb0 = performance.now();
      const bitmap = image.toBitmap();
      tbMs = performance.now() - tb0;
      const sw0 = performance.now();
      paintedImage.replace(bitmap);
      swMs = performance.now() - sw0;
    }

    if (options['debug-paint']) {
      console_.error(
        `paint:${tag}(fallback) dt=${dt.toFixed(1)} tb=${tbMs.toFixed(1)} sw=${swMs.toFixed(1)} sz=${imageSize.width}x${imageSize.height}`,
      );
    }
  }
  contents.on('paint', paint);

  weakPaintedContents_.set(w, result);
  return result;
}
