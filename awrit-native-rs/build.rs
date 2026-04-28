extern crate napi_build;

fn main() {
  napi_build::setup();

  // Target Haswell as minimum for x64 machines
  #[cfg(target_arch = "x86_64")]
  {
    println!("cargo:rustc-env=RUSTFLAGS=-Ctarget-cpu=haswell");
  }

  // IOSurface framework linkage for shared-texture path on macOS.
  #[cfg(target_os = "macos")]
  {
    println!("cargo:rustc-link-lib=framework=IOSurface");
    println!("cargo:rustc-link-lib=framework=CoreFoundation");
  }
}
