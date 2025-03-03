import { EscapeType, KeyEvent, MouseEvent, MouseButton, type InputEvent } from 'awrit-native';
import type { BrowserWindow, WebContents, WebContentsView } from 'electron';
import { focusedView, TOOLBAR_HEIGHT } from './windows';
import { placeCursor } from './tty/output';
import { DPI_SCALE } from './dpi';

function handleModifiers(modifiers: number): Array<'shift' | 'alt' | 'ctrl'> {
  const result: Array<'shift' | 'alt' | 'ctrl'> = [];
  if (modifiers & (1 << 2)) result.push('shift');
  if (modifiers & (1 << 3)) result.push('alt');
  if (modifiers & (1 << 4)) result.push('ctrl');
  return result;
}

function handleMouseButton(buttons: number) {
  if (buttons & MouseButton.Left) return 'left';
  if (buttons & MouseButton.Right) return 'right';
  if (buttons & MouseButton.Middle) return 'middle';
  return;
}

const WHEEL_DELTA = 100;

const SHIFT_MAP = {
  '0': ')',
  '1': '!',
  '2': '@',
  '3': '#',
  '4': '$',
  '5': '%',
  '6': '^',
  '7': '&',
  '8': '*',
  '9': '(',
  '-': '_',
  '=': '+',
  '[': '{',
  ']': '}',
  '\\': '|',
  ';': ':',
  "'": '"',
  ',': '<',
  '.': '>',
  '/': '?',
  '`': '~',
};

async function guessIMEPositionInWindow(view: BrowserWindow) {
  let bounds = { x: 0, y: 0 };
  try {
    bounds = await view.webContents.executeJavaScript(
      `(() => {
        const rect = document.activeElement?.getBoundingClientRect();
        return rect && { x: rect.left, y: rect.top }
      })()`,
    );
  } catch (e) {
    return bounds;
  }
  if (!bounds) {
    return bounds;
  }

  const { width, height } = view.getBounds();
  const [ttyWidth, ttyHeight] = process.stdout.getWindowSize();

  // Calculate position relative to window content size
  const x = Math.ceil((bounds.x / width) * ttyWidth);
  const y = Math.ceil((bounds.y / height) * ttyHeight);

  return { x, y };
}

export function handleInput(evt: InputEvent) {
  if (evt.type !== EscapeType.Key && evt.type !== EscapeType.Mouse) return;

  const view = focusedView.current;
  if (!view) {
    return;
  }

  guessIMEPositionInWindow(view.content).then((position) => {
    if (position) {
      placeCursor(position);
    }
  });

  switch (evt.type) {
    case EscapeType.Key: {
      const webContents = view.focusedContent;

      if (evt.event === KeyEvent.Unicode) {
        webContents.insertText(evt.code);
      } else if (evt.event === KeyEvent.Down && evt.code.length === 1) {
        const keyCode = evt.modifiers.includes('shift')
          ? (SHIFT_MAP[evt.code as keyof typeof SHIFT_MAP] ?? evt.code.toUpperCase())
          : evt.code;
        webContents.sendInputEvent({
          type: 'rawKeyDown',
          keyCode,
          modifiers: evt.modifiers,
        });
        webContents.sendInputEvent({
          type: 'char',
          keyCode,
          modifiers: evt.modifiers,
        });
      } else {
        webContents.sendInputEvent({
          type: evt.event === KeyEvent.Up ? 'keyUp' : 'keyDown',
          keyCode: evt.code,
          modifiers: evt.modifiers,
        });
      }
      break;
    }

    case EscapeType.Mouse: {
      const isWheelUp = evt.buttons & MouseButton.WheelUp;
      evt.x ??= 0;
      evt.y ??= 0;

      let { x, y } = evt;

      let focusedContent: WebContents;
      if (y > TOOLBAR_HEIGHT) {
        y -= TOOLBAR_HEIGHT;
        focusedContent = view.content.webContents;
      } else {
        focusedContent = view.toolbar.webContents;
      }

      x = Math.floor(x / DPI_SCALE);
      y = Math.floor(y / DPI_SCALE);

      if (isWheelUp || evt.buttons & MouseButton.WheelDown) {
        view.content.webContents.sendInputEvent({
          type: 'mouseWheel',
          wheelTicksY: isWheelUp ? 1 : -1,
          wheelTicksX: 0,
          deltaX: 0,
          deltaY: isWheelUp ? WHEEL_DELTA : -WHEEL_DELTA,
          modifiers: handleModifiers(evt.modfiers),
          x,
          y,
          accelerationRatioY: 0.5,
          hasPreciseScrollingDeltas: false,
          canScroll: true,
        });
        break;
      }

      const eventTypeMap = {
        [MouseEvent.Down]: 'mouseDown',
        [MouseEvent.Up]: 'mouseUp',
        [MouseEvent.Move]: 'mouseMove',
      }[evt.event];

      if (!eventTypeMap) break;
      const button = handleMouseButton(evt.buttons);
      if (!button && evt.event !== MouseEvent.Move) {
        break;
      }

      focusedContent.sendInputEvent({
        type: eventTypeMap as 'mouseDown' | 'mouseUp' | 'mouseMove',
        x,
        y,
        button,
        modifiers: handleModifiers(evt.modfiers),
        clickCount: evt.event === MouseEvent.Down ? 1 : 0,
      });

      if (evt.event === MouseEvent.Down && button === 'left') {
        if (focusedContent !== view.focusedContent) {
          if (focusedContent === view.content.webContents) {
            view.content.blurWebView();
          } else {
            view.toolbar.blurWebView();
          }
          view.focusedContent = focusedContent;
        }
      }
      break;
    }
  }
}
