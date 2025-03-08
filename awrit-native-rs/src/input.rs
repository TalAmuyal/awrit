use crossterm::event::{
  poll, read, Event, KeyCode, KeyModifiers, MediaKeyCode, ModifierKeyCode, MouseButton,
  MouseEventKind, Sequence,
};
use napi::{
  bindgen_prelude::*,
  threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
  Env, JsFunction,
};
use std::{
  sync::atomic::{AtomicBool, Ordering},
  time::Duration,
};

static QUIT: AtomicBool = AtomicBool::new(false);

#[napi(object)]
pub struct TermEvent {
  #[napi(ts_type = "'key' | 'mouse' | 'focus' | 'resize' | 'paste' | 'escape' | 'graphics'")]
  pub event_type: String,
  pub key_event: Option<KeyEvent>,
  pub mouse_event: Option<MouseEvent>,
  pub focus_gained: Option<bool>,
  pub focus_lost: Option<bool>,
  pub resize: Option<TermResize>,
  pub paste: Option<String>,
  pub escape: Option<TermEscape>,
  pub graphics: Option<KittyGraphics>,
}

#[napi(object)]
pub struct KeyEvent {
  /// Key code in Electron accelerator format (lowercase)
  pub code: String,
  /// Array of modifier strings in Electron accelerator format
  #[napi(
    ts_type = "('ctrl' | 'alt' | 'shift' | 'meta' | 'capslock' | 'numlock' | 'left' | 'right' | 'isautorepeat')[]"
  )]
  pub modifiers: Vec<String>,
  /// True for keydown and repeat events, false for keyup
  pub down: bool,
  /// True for keys that should have a keydown event
  pub with_keydown: bool,
}

#[napi(object)]
pub struct MouseEvent {
  #[napi(
    ts_type = "'mousedown' | 'mouseup' | 'mousemove' | 'scrollup' | 'scrolldown' | 'scrollleft' | 'scrollright'"
  )]
  pub kind: String,
  #[napi(ts_type = "'left' | 'middle' | 'right' | 'fourth' | 'fifth' | null")]
  pub button: Option<String>,
  pub x: u16,
  pub y: u16,
  /// Array of modifier strings in Electron accelerator format
  #[napi(ts_type = "('ctrl' | 'alt' | 'shift')[]")]
  pub modifiers: Vec<String>,
}

#[napi(object)]
#[derive(Debug)]
pub struct TermResize {
  pub columns: u16,
  pub rows: u16,
}

#[napi(object)]
#[derive(Debug)]
pub struct TermEscape {
  #[napi(ts_type = "'osc' | 'apc' | 'dcs' | 'pm'")]
  pub kind: String,
  pub text: String,
}

#[napi(object)]
#[derive(Debug)]
pub struct KittyGraphics {
  pub id: String,
  pub status: String,
}

impl From<Event> for TermEvent {
  fn from(event: Event) -> Self {
    match event {
      Event::Key(key) => {
        let (code, with_keydown, left_right) = translate_key_code(&key.code);
        let mut mod_vec = Vec::new();
        let mods = key.modifiers;

        // Convert modifier bits to strings
        if mods.contains(KeyModifiers::CONTROL) {
          mod_vec.push("ctrl".to_string());
        }
        if mods.contains(KeyModifiers::ALT) {
          mod_vec.push("alt".to_string());
        }
        if mods.contains(KeyModifiers::SHIFT) {
          mod_vec.push("shift".to_string());
        }
        if mods.contains(KeyModifiers::META) {
          mod_vec.push("meta".to_string());
        }
        if mods.contains(KeyModifiers::CAPS_LOCK) {
          mod_vec.push("capslock".to_string());
        }
        if mods.contains(KeyModifiers::NUM_LOCK) {
          mod_vec.push("numlock".to_string());
        }

        // Add left/right modifiers if present
        if let Some(side) = left_right {
          mod_vec.push(side.to_string());
        }

        // Add isautorepeat for repeat events
        let down = match key.kind {
          crossterm::event::KeyEventKind::Press | crossterm::event::KeyEventKind::Repeat => true,
          crossterm::event::KeyEventKind::Release => false,
        };
        if matches!(key.kind, crossterm::event::KeyEventKind::Repeat) {
          mod_vec.push("isautorepeat".to_string());
        }

        TermEvent {
          event_type: "key".to_string(),
          key_event: Some(KeyEvent {
            code,
            modifiers: mod_vec,
            down,
            with_keydown,
          }),
          mouse_event: None,
          focus_gained: None,
          focus_lost: None,
          resize: None,
          paste: None,
          escape: None,
          graphics: None,
        }
      }
      Event::Mouse(mouse) => {
        if mouse.x == u16::MAX || mouse.y == u16::MAX {
          return TermEvent {
            event_type: "mouse".to_string(),
            key_event: None,
            mouse_event: Some(MouseEvent {
              kind: "mouseleave".to_string(),
              button: None,
              modifiers: Vec::new(),
              x: 0,
              y: 0,
            }),
            focus_gained: None,
            focus_lost: None,
            resize: None,
            paste: None,
            escape: None,
            graphics: None,
          };
        }

        let mut mod_vec = Vec::new();
        let mods = mouse.modifiers;

        // Convert modifier bits to strings
        if mods.contains(KeyModifiers::CONTROL) {
          mod_vec.push("ctrl".to_string());
        }
        if mods.contains(KeyModifiers::ALT) {
          mod_vec.push("alt".to_string());
        }
        if mods.contains(KeyModifiers::SHIFT) {
          mod_vec.push("shift".to_string());
        }

        // Convert MouseEventKind to string and extract button
        let (kind, button) = match mouse.kind {
          MouseEventKind::Down(btn) => (
            "mousedown",
            Some(match btn {
              MouseButton::Left => "left",
              MouseButton::Middle => "middle",
              MouseButton::Right => "right",
              MouseButton::Fourth => "fourth",
              MouseButton::Fifth => "fifth",
            }),
          ),
          MouseEventKind::Up(btn) => (
            "mouseup",
            Some(match btn {
              MouseButton::Left => "left",
              MouseButton::Middle => "middle",
              MouseButton::Right => "right",
              MouseButton::Fourth => "fourth",
              MouseButton::Fifth => "fifth",
            }),
          ),
          MouseEventKind::Drag(btn) => (
            "mousemove",
            Some(match btn {
              MouseButton::Left => "left",
              MouseButton::Middle => "middle",
              MouseButton::Right => "right",
              MouseButton::Fourth => "fourth",
              MouseButton::Fifth => "fifth",
            }),
          ),
          MouseEventKind::Moved => ("mousemove", None),
          MouseEventKind::ScrollUp => ("scrollup", None),
          MouseEventKind::ScrollDown => ("scrolldown", None),
          MouseEventKind::ScrollLeft => ("scrollleft", None),
          MouseEventKind::ScrollRight => ("scrollright", None),
        };

        TermEvent {
          event_type: "mouse".to_string(),
          key_event: None,
          mouse_event: Some(MouseEvent {
            kind: kind.to_string(),
            button: button.map(|s| s.to_string()),
            x: mouse.x,
            y: mouse.y,
            modifiers: mod_vec,
          }),
          focus_gained: None,
          focus_lost: None,
          resize: None,
          paste: None,
          escape: None,
          graphics: None,
        }
      }
      Event::FocusGained => TermEvent {
        event_type: "focus".to_string(),
        key_event: None,
        mouse_event: None,
        focus_gained: Some(true),
        focus_lost: None,
        resize: None,
        paste: None,
        escape: None,
        graphics: None,
      },
      Event::FocusLost => TermEvent {
        event_type: "focus".to_string(),
        key_event: None,
        mouse_event: None,
        focus_gained: None,
        focus_lost: Some(true),
        resize: None,
        paste: None,
        escape: None,
        graphics: None,
      },
      Event::Resize(columns, rows) => TermEvent {
        event_type: "resize".to_string(),
        key_event: None,
        mouse_event: None,
        focus_gained: None,
        focus_lost: None,
        resize: Some(TermResize { columns, rows }),
        paste: None,
        escape: None,
        graphics: None,
      },
      Event::Paste(text) => TermEvent {
        event_type: "paste".to_string(),
        key_event: None,
        mouse_event: None,
        focus_gained: None,
        focus_lost: None,
        resize: None,
        paste: Some(text),
        escape: None,
        graphics: None,
      },
      Event::Escape(sequence) => {
        let (kind, text) = match sequence {
          Sequence::Osc(text) => ("osc", text),
          Sequence::Apc(text) => ("apc", text),
          Sequence::Dcs(text) => ("dcs", text),
          Sequence::Pm(text) => ("pm", text),
        };
        TermEvent {
          event_type: "escape".to_string(),
          key_event: None,
          mouse_event: None,
          focus_gained: None,
          focus_lost: None,
          resize: None,
          paste: None,
          escape: Some(TermEscape {
            kind: kind.to_string(),
            text,
          }),
          graphics: None,
        }
      }
      Event::KittyGraphics(data, status) => TermEvent {
        event_type: "graphics".to_string(),
        key_event: None,
        mouse_event: None,
        focus_gained: None,
        focus_lost: None,
        resize: None,
        paste: None,
        escape: None,
        graphics: Some(KittyGraphics {
          id: data,
          status: format!("{:?}", status),
        }),
      },
    }
  }
}

fn translate_key_code(code: &KeyCode) -> (String, bool, Option<&str>) {
  let (code, with_keydown, left_right) = match code {
    KeyCode::Backspace => ("backspace", true, None),
    KeyCode::Enter => ("return", true, None),
    KeyCode::Left => ("left", true, None),
    KeyCode::Right => ("right", true, None),
    KeyCode::Up => ("up", true, None),
    KeyCode::Down => ("down", true, None),
    KeyCode::Home => ("home", true, None),
    KeyCode::End => ("end", true, None),
    KeyCode::PageUp => ("pageup", true, None),
    KeyCode::PageDown => ("pagedown", true, None),
    KeyCode::Tab => ("tab", true, None),
    KeyCode::BackTab => ("tab", true, None),
    KeyCode::Delete => ("delete", true, None),
    KeyCode::Insert => ("insert", true, None),
    KeyCode::F(n) => return (format!("f{n}"), true, None),
    KeyCode::Char(c) => {
      if *c == ' ' {
        return ("space".to_string(), true, None);
      }
      let c_lower = c.to_ascii_lowercase();
      let is_special = c_lower.is_ascii_alphabetic() || c_lower.is_ascii_digit();
      return (c_lower.to_string(), is_special, None);
    }
    KeyCode::Esc => ("escape", true, None),
    KeyCode::CapsLock => ("capslock", true, None),
    KeyCode::ScrollLock => ("scrolllock", true, None),
    KeyCode::NumLock => ("numlock", true, None),
    KeyCode::PrintScreen => ("printscreen", true, None),
    KeyCode::Pause => ("pause", true, None),
    KeyCode::Menu => ("menu", true, None),
    KeyCode::KeypadBegin => ("clear", true, None),
    KeyCode::Null => ("", false, None),
    KeyCode::Media(media) => match media {
      MediaKeyCode::Play => ("mediaplay", true, None),
      MediaKeyCode::Pause => ("mediapause", true, None),
      MediaKeyCode::PlayPause => ("mediaplaypause", true, None),
      MediaKeyCode::Reverse => ("mediareverse", true, None),
      MediaKeyCode::Stop => ("mediastop", true, None),
      MediaKeyCode::FastForward => ("mediafastforward", true, None),
      MediaKeyCode::Rewind => ("mediarewind", true, None),
      MediaKeyCode::TrackNext => ("medianexttrack", true, None),
      MediaKeyCode::TrackPrevious => ("mediaprevioustrack", true, None),
      MediaKeyCode::Record => ("mediarecord", true, None),
      MediaKeyCode::LowerVolume => ("volumedown", true, None),
      MediaKeyCode::RaiseVolume => ("volumeup", true, None),
      MediaKeyCode::MuteVolume => ("volumemute", true, None),
    },
    KeyCode::Modifier(modifier) => match modifier {
      ModifierKeyCode::LeftShift => ("shift", true, Some("left")),
      ModifierKeyCode::RightShift => ("shift", true, Some("right")),
      ModifierKeyCode::LeftControl => ("control", true, Some("left")),
      ModifierKeyCode::RightControl => ("control", true, Some("right")),
      ModifierKeyCode::LeftAlt => ("alt", true, Some("left")),
      ModifierKeyCode::RightAlt => ("alt", true, Some("right")),
      ModifierKeyCode::LeftSuper => ("super", true, Some("left")),
      ModifierKeyCode::RightSuper => ("super", true, Some("right")),
      ModifierKeyCode::LeftMeta => ("meta", true, Some("left")),
      ModifierKeyCode::RightMeta => ("meta", true, Some("right")),
      _ => ("", false, None),
    },
  };
  (code.to_string(), with_keydown, left_right)
}

#[napi(ts_return_type = "() => void")]
pub fn listen_for_input(
  env: Env,
  #[napi(ts_arg_type = "(error: null | Error, event: TermEvent) => void")] callback: JsFunction,
  wait_ms: Option<i32>,
) -> napi::Result<JsFunction> {
  // Convert the JavaScript callback into a threadsafe function
  let tsfn: ThreadsafeFunction<TermEvent> = callback
    .create_threadsafe_function(0, |ctx| Ok(vec![ctx.value]))
    .map_err(|e| {
      napi::Error::from_reason(format!("Failed to create threadsafe function: {}", e))
    })?;

  // Reset the quit flag
  QUIT.store(false, Ordering::SeqCst);

  // Get wait duration (default 10ms)
  let wait = wait_ms.unwrap_or(10);

  // Spawn the input polling thread
  std::thread::spawn({
    let tsfn = tsfn.clone();
    move || {
      while !QUIT.load(Ordering::SeqCst) {
        match poll(Duration::from_millis(wait as u64)) {
          Ok(true) => {
            if let Ok(event) = read() {
              let js_event = TermEvent::from(event);
              let status = tsfn.call(Ok(js_event), ThreadsafeFunctionCallMode::NonBlocking);
              if status != Status::Ok {
                break;
              }
            }
          }
          Ok(_) => continue,
          Err(_) => break,
        }
      }
    }
  });

  // Return cleanup function
  env.create_function_from_closure("cleanup", |_| {
    QUIT.store(true, Ordering::SeqCst);
    Ok(())
  })
}
