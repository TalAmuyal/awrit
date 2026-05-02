#!/usr/bin/env bash
#
# Build a relocatable, self-contained glimpse-tty distribution archive.
#
# Output: build/glimpse-tty-<version>-<platform>-<arch>.tar.gz
#
# The archive contains a launcher that invokes the bundled Electron directly
# with no Bun dependency at runtime. See plan section 1.3 for layout details.

set -euo pipefail

REPO_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE:-$0}")/.." &>/dev/null && pwd)
BUILD_DIR=$REPO_ROOT/build
STAGE_DIR=$BUILD_DIR/glimpse-tty
PRODINSTALL_DIR=$BUILD_DIR/prodinstall

Color_Off=''
Red=''
Green=''
Dim=''
if [[ -t 1 ]]; then
  Color_Off='\033[0m'
  Red='\033[0;31m'
  Green='\033[0;32m'
  Dim='\033[0;2m'
fi

error() {
  echo -e "${Red}error${Color_Off}: $*" >&2
  exit 1
}

info() {
  echo -e "${Dim}$*${Color_Off}"
}

step() {
  echo -e "${Green}==>${Color_Off} $*"
}

# Detect platform/arch for archive naming.
case "$(uname -s)" in
  Darwin) PLATFORM=darwin ;;
  Linux)  PLATFORM=linux ;;
  *) error "Unsupported platform: $(uname -s)" ;;
esac

case "$(uname -m)" in
  arm64|aarch64) ARCH=arm64 ;;
  x86_64) ARCH=x64 ;;
  *) error "Unsupported architecture: $(uname -m)" ;;
esac

# Resolve version: GLIMPSE_TTY_VERSION wins, then `git describe`, then package.json.
if [[ -n "${GLIMPSE_TTY_VERSION:-}" ]]; then
  VERSION=$GLIMPSE_TTY_VERSION
elif git_tag=$(git -C "$REPO_ROOT" describe --tags --exact-match 2>/dev/null); then
  VERSION=${git_tag#v}
else
  VERSION=$(node -p "require('$REPO_ROOT/package.json').version")
fi

ARCHIVE_NAME=glimpse-tty-$VERSION-$PLATFORM-$ARCH.tar.gz
ARCHIVE_PATH=$BUILD_DIR/$ARCHIVE_NAME

step "Packing glimpse-tty $VERSION for $PLATFORM-$ARCH"
info "  repo:     $REPO_ROOT"
info "  staging:  $STAGE_DIR"
info "  archive:  $ARCHIVE_PATH"

command -v bun >/dev/null || error "bun is not on PATH (run via mise: 'mise pack')"
command -v node >/dev/null || error "node is not on PATH (run via mise: 'mise pack')"

# 1. Clean staging area.
step "Cleaning $BUILD_DIR"
rm -rf "$STAGE_DIR" "$PRODINSTALL_DIR" "$ARCHIVE_PATH"
mkdir -p "$STAGE_DIR"

# 2. Build dist/ (compile TS + bundle markdown extension) using the shared build module.
step "Building dist/index.js and bundled extensions"
(cd "$REPO_ROOT" && bun run scripts/run-build.ts)

# 3. Copy the build outputs and runtime assets into staging.
step "Staging build outputs"
cp -R "$REPO_ROOT/dist" "$STAGE_DIR/dist"
cp "$REPO_ROOT/config.example.js" "$STAGE_DIR/"
cp "$REPO_ROOT/LICENSE.txt" "$STAGE_DIR/"

# 4. Install production-only deps in a clean staging dir.
# The repo's node_modules contains both dev and prod deps. Doing a fresh install
# with a stripped package.json (no workspaces, no devDependencies) gives us a
# minimal node_modules with just runtime deps.
step "Installing production dependencies"
mkdir -p "$PRODINSTALL_DIR"
node -e "
  const pkg = require('$REPO_ROOT/package.json');
  delete pkg.workspaces;
  delete pkg.devDependencies;
  delete pkg.scripts;
  require('fs').writeFileSync('$PRODINSTALL_DIR/package.json', JSON.stringify(pkg, null, 2));
"
cp -R "$REPO_ROOT/glimpse-tty-native-rs" "$PRODINSTALL_DIR/glimpse-tty-native-rs"
if [[ -d "$REPO_ROOT/patches" ]]; then
  cp -R "$REPO_ROOT/patches" "$PRODINSTALL_DIR/patches"
fi
(cd "$PRODINSTALL_DIR" && bun install --production --no-save)

# 5. Move production node_modules into staging.
step "Copying production node_modules"
cp -R "$PRODINSTALL_DIR/node_modules" "$STAGE_DIR/node_modules"

# 6. Replace the placeholder native-rs payload with a slim copy that ships only
# the runtime files. The bun install above produces a full source-tree copy of
# the native-rs workspace (Rust crates, scripts, etc.) which we don't need.
step "Slimming glimpse-tty-native-rs to runtime files only"
NATIVE_DIR_IN_STAGE=$STAGE_DIR/node_modules/glimpse-tty-native-rs
SOURCE_NATIVE_DIR=$REPO_ROOT/glimpse-tty-native-rs
NATIVE_BINARY=glimpse-tty-native-rs.$PLATFORM-$ARCH.node
case "$PLATFORM-$ARCH" in
  linux-x64) NATIVE_BINARY=glimpse-tty-native-rs.linux-x64-gnu.node ;;
  linux-arm64) NATIVE_BINARY=glimpse-tty-native-rs.linux-arm64-gnu.node ;;
esac

if [[ ! -f "$SOURCE_NATIVE_DIR/$NATIVE_BINARY" ]]; then
  error "Native addon binary not found: $SOURCE_NATIVE_DIR/$NATIVE_BINARY (run 'mise build:native' or ensure scripts/download-binary.js succeeded)"
fi

rm -rf "$NATIVE_DIR_IN_STAGE"
mkdir -p "$NATIVE_DIR_IN_STAGE"
cp "$SOURCE_NATIVE_DIR/index.js" "$NATIVE_DIR_IN_STAGE/"
cp "$SOURCE_NATIVE_DIR/index.d.ts" "$NATIVE_DIR_IN_STAGE/"
cp "$SOURCE_NATIVE_DIR/package.json" "$NATIVE_DIR_IN_STAGE/"
cp "$SOURCE_NATIVE_DIR/$NATIVE_BINARY" "$NATIVE_DIR_IN_STAGE/"

# 7. macOS: patch Electron's plist to set LSUIElement=true so glimpse-tty does
# not show a Dock icon. PlistBuddy targets the top-level dict, unlike a sed
# pattern on </dict> which could match a nested dict (e.g. CFBundleDocumentTypes).
if [[ "$PLATFORM" = "darwin" ]]; then
  step "Patching Electron plist (LSUIElement)"
  PLIST=$STAGE_DIR/node_modules/electron/dist/Electron.app/Contents/Info.plist
  if [[ ! -f "$PLIST" ]]; then
    error "Electron plist not found at $PLIST"
  fi
  if /usr/libexec/PlistBuddy -c "Print :LSUIElement" "$PLIST" >/dev/null 2>&1; then
    info "  plist already has LSUIElement; skipping"
  else
    /usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$PLIST"
  fi
fi

# 8. Write VERSION file for the runtime version-display path.
step "Writing VERSION file"
echo "$VERSION" > "$STAGE_DIR/VERSION"

# 9. Write the distribution launcher.
step "Writing distribution launcher"
cat > "$STAGE_DIR/glimpse-tty" <<'LAUNCHER'
#!/usr/bin/env bash
set -euo pipefail
DIST_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE:-$0}")" &>/dev/null && pwd)
export GLIMPSE_TTY_ROOT="$DIST_DIR"
ELECTRON="$DIST_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
exec "$ELECTRON" "$DIST_DIR/dist/index.js" --high-dpi-support=1 "$@"
LAUNCHER
chmod 755 "$STAGE_DIR/glimpse-tty"

# 10. Create the tar.gz archive.
step "Creating archive: $ARCHIVE_NAME"
tar -czf "$ARCHIVE_PATH" -C "$BUILD_DIR" glimpse-tty/

# Print summary with size and sha256 (consumed by Devora's download-deps).
SIZE=$(du -h "$ARCHIVE_PATH" | awk '{print $1}')
SHA256=$(shasum -a 256 "$ARCHIVE_PATH" | awk '{print $1}')

step "Done"
echo "  archive: $ARCHIVE_PATH"
echo "  size:    $SIZE"
echo "  sha256:  $SHA256"
