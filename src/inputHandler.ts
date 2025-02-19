import { EscapeType, KeyEvent, MouseEvent, MouseButton, type InputEvent } from 'awrit-native';
import type { BrowserWindow } from 'electron';
import { focusedWindow } from './windows';
import { placeCursor } from './tty/output';

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

async function guessIMEPositionInWindow(win: BrowserWindow) {
  let bounds = { x: 0, y: 0 };
  try {
    bounds = await win.webContents.executeJavaScript(
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

  const [contentWidth, contentHeight] = win.getContentSize();
  const [ttyWidth, ttyHeight] = process.stdout.getWindowSize();

  // Calculate position relative to window content size
  const x = Math.ceil((bounds.x / contentWidth) * ttyWidth);
  const y = Math.ceil((bounds.y / contentHeight) * ttyHeight);

  return { x, y };
}

export function handleInput(evt: InputEvent) {
  if (evt.type !== EscapeType.Key && evt.type !== EscapeType.Mouse) return;

  const win = focusedWindow.current;
  if (!win) {
    return;
  }

  guessIMEPositionInWindow(win).then((position) => {
    if (position) {
      placeCursor(position);
    }
  });

  switch (evt.type) {
    case EscapeType.Key: {
      if (evt.event === KeyEvent.Unicode) {
        win.webContents.insertText(evt.code);
      } else if (evt.event === KeyEvent.Down && evt.code.length === 1) {
        const keyCode = evt.modifiers.includes('shift')
          ? SHIFT_MAP[evt.code as keyof typeof SHIFT_MAP] ?? evt.code.toUpperCase()
          : evt.code;
        win.webContents.sendInputEvent({
          type: 'rawKeyDown',
          keyCode,
          modifiers: evt.modifiers,
        });
        win.webContents.sendInputEvent({
          type: 'char',
          keyCode,
          modifiers: evt.modifiers,
        });
      } else {
        win.webContents.sendInputEvent({
          type: evt.event === KeyEvent.Up ? 'keyUp' : 'keyDown',
          keyCode: evt.code,
          modifiers: evt.modifiers,
        });
      }
      break;
    }

    case EscapeType.Mouse: {
      const isWheelUp = evt.buttons & MouseButton.WheelUp;
      if (isWheelUp || evt.buttons & MouseButton.WheelDown) {
        win.webContents.sendInputEvent({
          type: 'mouseWheel',
          wheelTicksY: isWheelUp ? 1 : -1,
          wheelTicksX: 0,
          deltaX: 0,
          deltaY: isWheelUp ? WHEEL_DELTA : -WHEEL_DELTA,
          modifiers: handleModifiers(evt.modfiers),
          x: evt.x || 0,
          y: evt.y || 0,
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

      win.webContents.sendInputEvent({
        type: eventTypeMap as 'mouseDown' | 'mouseUp' | 'mouseMove',
        x: evt.x || 0,
        y: evt.y || 0,
        button,
        modifiers: handleModifiers(evt.modfiers),
        clickCount: evt.event === MouseEvent.Down ? 1 : 0,
      });
      break;
    }
  }
}
