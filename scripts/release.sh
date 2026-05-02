#!/usr/bin/env bash
#
# Release a new glimpse-tty distribution.
#
# Usage:
#   ./scripts/release.sh           # uses version from package.json
#   ./scripts/release.sh 2.1.0     # explicit version (no leading 'v')
#
# Steps:
#   1. Validate clean working tree.
#   2. Resolve version (argument > package.json).
#   3. Verify the tag does not already exist locally or on origin.
#   4. Build the distribution archive via `mise pack`.
#   5. Create and push the annotated tag (which triggers .github/workflows/release.yml).
#   6. Print the archive's sha256 (consumed by Devora's 3rd-party-deps.json).

set -euo pipefail

REPO_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE:-$0}")/.." &>/dev/null && pwd)
cd "$REPO_ROOT"

Color_Off=''
Red=''
Green=''
Yellow=''
Dim=''
if [[ -t 1 ]]; then
  Color_Off='\033[0m'
  Red='\033[0;31m'
  Green='\033[0;32m'
  Yellow='\033[0;33m'
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

# 1. Validate clean working tree.
step "Validating clean working tree"
if [[ -n "$(git status --porcelain)" ]]; then
  git status --short
  error "working tree is not clean; commit or stash before releasing"
fi

# 2. Resolve version.
if [[ $# -ge 1 ]]; then
  VERSION=$1
else
  VERSION=$(node -p "require('./package.json').version")
fi
TAG=v$VERSION

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]]; then
  error "version '$VERSION' is not a valid semver (e.g. 2.1.0 or 2.1.0-beta.1)"
fi

step "Releasing $TAG"
info "  version: $VERSION"
info "  repo:    $REPO_ROOT"

# 3. Verify the tag does not already exist locally or on origin.
step "Checking that $TAG does not already exist"
if git rev-parse --quiet --verify "refs/tags/$TAG" >/dev/null; then
  error "tag $TAG already exists locally; delete it (git tag -d $TAG) or pick a different version"
fi
if git ls-remote --tags --exit-code origin "$TAG" >/dev/null 2>&1; then
  error "tag $TAG already exists on origin; pick a different version"
fi

# 4. Build the distribution archive.
step "Building distribution archive"
GLIMPSE_TTY_VERSION=$VERSION mise pack

# Detect platform/arch the same way pack.sh does so we can locate the archive.
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

ARCHIVE_PATH=$REPO_ROOT/build/glimpse-tty-$VERSION-$PLATFORM-$ARCH.tar.gz
if [[ ! -f "$ARCHIVE_PATH" ]]; then
  error "expected archive at $ARCHIVE_PATH but it was not produced by mise pack"
fi

# 5. Create and push the annotated tag.
step "Creating tag $TAG"
git tag -a "$TAG" -m "$TAG"

step "Pushing tag $TAG to origin"
git push origin "$TAG"

# 6. Print archive metadata.
SIZE=$(du -h "$ARCHIVE_PATH" | awk '{print $1}')
SHA256=$(shasum -a 256 "$ARCHIVE_PATH" | awk '{print $1}')

step "Release $TAG complete"
echo "  archive: $ARCHIVE_PATH"
echo "  size:    $SIZE"
echo "  sha256:  $SHA256"
echo
echo -e "${Yellow}Note${Color_Off}: the local archive is the host-built copy. The release workflow"
echo "      (.github/workflows/release.yml) will build the official artifact and"
echo "      attach it to the GitHub Release for tag $TAG."
