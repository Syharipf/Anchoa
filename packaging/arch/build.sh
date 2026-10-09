#!/usr/bin/env bash
# Builds the Arch Linux package inputs from the current checkout: a tarball of
# the Tauri deb bundle's file tree (binary, .desktop, icons, /usr/lib/Anchoa)
# and a PKGBUILD whose pkgver and checksum match it. The deb bundler is pure
# Rust, so this runs on Arch without dpkg. Run on Arch so the binary links
# against Arch's libraries.
# Usage: packaging/arch/build.sh <out-dir> [--debug]
set -euo pipefail

OUT=$(realpath -m "${1:?usage: build.sh <out-dir> [--debug]}")
PROFILE=release
FLAGS=()
if [[ "${2:-}" == "--debug" ]]; then
  PROFILE=debug
  FLAGS=(--debug)
fi

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"
VERSION=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' src-tauri/tauri.conf.json)
[[ -n "$VERSION" ]] || { echo "version not found in src-tauri/tauri.conf.json"; exit 1; }

bun tauri build "${FLAGS[@]}" --bundles deb

DATA=$(find "src-tauri/target/$PROFILE/bundle/deb" -maxdepth 2 -type d -name data -path "*_${VERSION}_*" | head -n 1)
[[ -d "$DATA/usr/bin" ]] || { echo "deb bundle tree for $VERSION not found"; exit 1; }

mkdir -p "$OUT"
TARBALL="anchoa-$VERSION-x86_64.tar.gz"
tar --owner=0 --group=0 --numeric-owner -C "$DATA" -czf "$OUT/$TARBALL" usr
SUM=$(sha256sum "$OUT/$TARBALL" | cut -d' ' -f1)

sed -e "s/^pkgver=.*/pkgver=$VERSION/" \
    -e "s/^sha256sums=.*/sha256sums=('$SUM')/" \
    packaging/arch/PKGBUILD > "$OUT/PKGBUILD"
echo "$OUT/$TARBALL"
