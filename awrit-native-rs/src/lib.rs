#![deny(clippy::all)]

#[macro_use]
extern crate napi_derive;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use napi::bindgen_prelude::*;
use nix::errno::Errno;
use nix::fcntl::OFlag;
use nix::sys::mman::{mmap, munmap, shm_open, shm_unlink, MapFlags, ProtFlags};
use nix::sys::stat::Mode;
use nix::unistd::ftruncate;
use std::num::NonZeroUsize;
use std::os::fd::{AsFd, OwnedFd};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

mod term;
pub use term::*;
mod input;
pub use input::*;

#[cfg(target_os = "macos")]
mod iosurface_ffi {
  use std::ffi::c_void;

  pub type IOSurfaceRef = *mut c_void;

  // From IOSurfaceTypes.h.
  pub const READ_ONLY: u32 = 0x00000001;

  #[link(name = "IOSurface", kind = "framework")]
  extern "C" {
    pub fn IOSurfaceLock(surface: IOSurfaceRef, options: u32, seed: *mut u32) -> i32;
    pub fn IOSurfaceUnlock(surface: IOSurfaceRef, options: u32, seed: *mut u32) -> i32;
    pub fn IOSurfaceGetBaseAddress(surface: IOSurfaceRef) -> *mut c_void;
    pub fn IOSurfaceGetBytesPerRow(surface: IOSurfaceRef) -> usize;
    pub fn IOSurfaceGetWidth(surface: IOSurfaceRef) -> usize;
    pub fn IOSurfaceGetHeight(surface: IOSurfaceRef) -> usize;
  }
}

#[napi(object)]
pub struct DirtyRect {
  pub x: u32,
  pub y: u32,
  pub width: u32,
  pub height: u32,
}

/// Shared memory transport for graphics protocol.
///
/// Kitty's graphics protocol unlinks the shm after reading. If we reuse the
/// same name across paints, fast scrolling races: paint N+1 opens the still-
/// existing name, overwrites N's data, then N+1's `loadFrame` fails because
/// Kitty unlinked between our open and its read. To avoid the race we rotate
/// to a fresh name on every `write` / `write_iosurface` call.
///
/// `write_empty` (used by the one-shot container frame) keeps the initial
/// name; the container is only transmitted once.
#[napi(custom_finalize)]
pub struct ShmGraphicBuffer {
  // Stable per-instance prefix; combined with `counter` to make unique names.
  name_prefix: String,
  // Increments per write, encoded into the rotated name.
  counter: AtomicU64,
  // The most recently used shm name. JS reads this via `name_base64()` to tell
  // Kitty which shm to open.
  current_name: Mutex<String>,
  size: u32,
}

impl ObjectFinalize for ShmGraphicBuffer {
  fn finalize(self, mut _env: Env) -> Result<()> {
    if let Ok(name) = self.current_name.lock() {
      let _ = shm_unlink(name.as_str());
    }
    Ok(())
  }
}

#[napi]
impl ShmGraphicBuffer {
  /// Creates a new shared memory buffer with a unique name with the provided size
  #[napi(constructor)]
  pub fn new(size: u32) -> Self {
    let timestamp = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .unwrap()
      .as_nanos();

    // 10 hex chars of nanosecond timestamp gives ~17 min between potential
    // prefix collisions; combined with the per-write counter, names are unique
    // for the lifetime of any reasonable session.
    let hex = format!("{:x}", timestamp);
    let suffix = if hex.len() > 10 {
      &hex[hex.len() - 10..]
    } else {
      &hex
    };
    let name_prefix = format!("/aw_{}", suffix);
    let initial_name = format!("{}_0", name_prefix);

    Self {
      name_prefix,
      counter: AtomicU64::new(1),
      current_name: Mutex::new(initial_name),
      size,
    }
  }

  /// Returns the most recently rotated shm name as base64 (for the Kitty
  /// graphics protocol's `t=s` payload).
  #[napi(getter)]
  pub fn name_base64(&self) -> String {
    let name = self
      .current_name
      .lock()
      .map(|g| g.clone())
      .unwrap_or_default();
    BASE64.encode(name.as_bytes())
  }

  /// Creates and truncates the shared memory segment to the specified size, filling it with zeros.
  ///
  /// Used for the one-shot container frame that Kitty receives once at startup.
  /// Does NOT rotate the name; the caller is expected to transmit this single
  /// shm and never reuse this buffer for animation frames.
  #[napi]
  pub fn write_empty(&self) -> napi::Result<()> {
    let name = self.current_name_clone();
    let fd = shm_open(
      name.as_str(),
      OFlag::O_CREAT | OFlag::O_RDWR,
      Mode::S_IRUSR | Mode::S_IWUSR,
    )
    .map_err(|e| napi::Error::from_reason(format!("Failed to open shared memory: {}", e)))?;
    truncate_tolerant(&fd, self.size as i64)?;
    Ok(())
  }

  /// Writes an image buffer to the shared memory at the specified dirty rectangle.
  /// Rotates to a fresh shm name first to avoid races with Kitty's post-read unlink.
  #[napi]
  pub fn write(
    &self,
    buffer: Buffer,
    image_width: u32,
    dirty_rect: Option<DirtyRect>,
  ) -> napi::Result<()> {
    let (fd, ptr, len) = self.rotate_and_map()?;
    let src_slice = buffer.as_ref();
    let dst_slice = unsafe { std::slice::from_raw_parts_mut(ptr.as_ptr() as *mut u8, len) };

    let conversion_ok = match dirty_rect {
      Some(rect) => {
        let bgra_rect = bgra_to_rgba::Rect {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
        bgra_to_rgba::bgra_to_rgba_rect(src_slice, dst_slice, image_width, bgra_rect)
      }
      None => bgra_to_rgba::bgra_to_rgba(src_slice, dst_slice),
    };

    let unmap_result = unsafe { munmap(ptr, len) };
    drop(fd);

    if !conversion_ok {
      return Err(napi::Error::from_reason("Failed to convert BGRA to RGBA"));
    }
    unmap_result
      .map_err(|e| napi::Error::from_reason(format!("Failed to munmap shared memory: {}", e)))?;
    Ok(())
  }

  /// Reads pixels directly from an IOSurface (delivered by Electron's
  /// `useSharedTexture` paint event on macOS) into shared memory, skipping
  /// the GPU→CPU readback that `image.toBitmap()` would perform.
  ///
  /// `surface_handle` is a Buffer wrapping an `IOSurfaceRef` pointer
  /// (`event.texture.textureInfo.handle.ioSurface`).
  #[cfg(target_os = "macos")]
  #[napi]
  pub fn write_iosurface(
    &self,
    surface_handle: Buffer,
    dirty_rect: Option<DirtyRect>,
  ) -> napi::Result<()> {
    use iosurface_ffi::*;

    let bytes = surface_handle.as_ref();
    let expected = std::mem::size_of::<IOSurfaceRef>();
    if bytes.len() != expected {
      return Err(napi::Error::from_reason(format!(
        "IOSurface handle has wrong size: got {} bytes, expected {}",
        bytes.len(),
        expected
      )));
    }
    let surface: IOSurfaceRef =
      unsafe { std::ptr::read_unaligned(bytes.as_ptr() as *const IOSurfaceRef) };
    if surface.is_null() {
      return Err(napi::Error::from_reason("IOSurface handle is null"));
    }

    let lock_options = READ_ONLY;
    let lock_result = unsafe { IOSurfaceLock(surface, lock_options, std::ptr::null_mut()) };
    if lock_result != 0 {
      return Err(napi::Error::from_reason(format!(
        "IOSurfaceLock failed: kern_return_t = {}",
        lock_result
      )));
    }

    let copy_result = self.copy_iosurface_locked(surface, dirty_rect);

    let unlock_result = unsafe { IOSurfaceUnlock(surface, lock_options, std::ptr::null_mut()) };
    if unlock_result != 0 && copy_result.is_ok() {
      return Err(napi::Error::from_reason(format!(
        "IOSurfaceUnlock failed: kern_return_t = {}",
        unlock_result
      )));
    }
    copy_result
  }
}

impl ShmGraphicBuffer {
  fn current_name_clone(&self) -> String {
    self
      .current_name
      .lock()
      .map(|g| g.clone())
      .unwrap_or_default()
  }

  /// Generates the next rotated name, opens fresh shm, truncates, and mmaps.
  /// Returns the (fd, mmap pointer, mmap length).
  fn rotate_and_map(
    &self,
  ) -> napi::Result<(
    OwnedFd,
    std::ptr::NonNull<std::ffi::c_void>,
    usize,
  )> {
    let n = self.counter.fetch_add(1, Ordering::Relaxed);
    let new_name = format!("{}_{}", self.name_prefix, n);

    let fd = shm_open(
      new_name.as_str(),
      OFlag::O_CREAT | OFlag::O_RDWR,
      Mode::S_IRUSR | Mode::S_IWUSR,
    )
    .map_err(|e| napi::Error::from_reason(format!("Failed to open shared memory: {}", e)))?;

    truncate_tolerant(&fd, self.size as i64)?;

    let len = NonZeroUsize::new(self.size as usize)
      .ok_or_else(|| napi::Error::from_reason("Size must be non-zero"))?;

    let ptr = unsafe {
      mmap(
        None,
        len,
        ProtFlags::PROT_READ | ProtFlags::PROT_WRITE,
        MapFlags::MAP_SHARED,
        &fd,
        0,
      )
      .map_err(|e| napi::Error::from_reason(format!("Failed to mmap shared memory: {}", e)))?
    };

    // Publish the new name only after a successful map; if anything above failed
    // we don't want JS to ask Kitty to read a name we never set up.
    if let Ok(mut guard) = self.current_name.lock() {
      *guard = new_name;
    }

    Ok((fd, ptr, len.get()))
  }
}

/// Idempotent ftruncate. Tolerates EINVAL — on macOS POSIX shm, ftruncate to
/// an already-sized region returns EINVAL. We treat that as "shm already at
/// this size, proceed". A genuinely wrong size will surface as an mmap failure.
fn truncate_tolerant<Fd: AsFd>(fd: Fd, size: i64) -> napi::Result<()> {
  match ftruncate(fd, size) {
    Ok(()) | Err(Errno::EINVAL) => Ok(()),
    Err(e) => Err(napi::Error::from_reason(format!(
      "Failed to truncate shared memory: {}",
      e
    ))),
  }
}

#[cfg(target_os = "macos")]
impl ShmGraphicBuffer {
  fn copy_iosurface_locked(
    &self,
    surface: iosurface_ffi::IOSurfaceRef,
    dirty_rect: Option<DirtyRect>,
  ) -> napi::Result<()> {
    use iosurface_ffi::*;

    let base = unsafe { IOSurfaceGetBaseAddress(surface) } as *const u8;
    if base.is_null() {
      return Err(napi::Error::from_reason("IOSurface base address is null"));
    }
    let bytes_per_row = unsafe { IOSurfaceGetBytesPerRow(surface) };
    let height = unsafe { IOSurfaceGetHeight(surface) };
    let width = unsafe { IOSurfaceGetWidth(surface) };

    if bytes_per_row == 0 || width == 0 || height == 0 {
      return Err(napi::Error::from_reason("IOSurface has zero dimension"));
    }
    if bytes_per_row % 4 != 0 {
      return Err(napi::Error::from_reason(
        "IOSurface bytes_per_row not a multiple of 4 (non-32bpp surface?)",
      ));
    }

    let stride_pixels = (bytes_per_row / 4) as u32;
    let src_len = bytes_per_row * height;
    let src_slice = unsafe { std::slice::from_raw_parts(base, src_len) };

    let (fd, ptr, len) = self.rotate_and_map()?;
    let dst_slice = unsafe { std::slice::from_raw_parts_mut(ptr.as_ptr() as *mut u8, len) };

    let rect = match dirty_rect {
      Some(r) => bgra_to_rgba::Rect {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
      },
      None => bgra_to_rgba::Rect {
        x: 0,
        y: 0,
        width: width as u32,
        height: height as u32,
      },
    };

    let conversion_ok = bgra_to_rgba::bgra_to_rgba_rect(src_slice, dst_slice, stride_pixels, rect);

    let unmap_result = unsafe { munmap(ptr, len) };
    drop(fd);

    if !conversion_ok {
      return Err(napi::Error::from_reason(
        "Failed to convert BGRA to RGBA from IOSurface",
      ));
    }
    unmap_result
      .map_err(|e| napi::Error::from_reason(format!("Failed to munmap shared memory: {}", e)))?;
    Ok(())
  }
}
