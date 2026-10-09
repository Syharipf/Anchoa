#!/usr/bin/env bash
# Install check for the Arch package, meant for a fresh archlinux container:
# installs the package with pacman (so missing `depends` show up), checks the
# binary resolves every shared library, then starts the installed app on a
# private Xvfb display and D-Bus as an unprivileged user and checks it stays up,
# opens its window, creates its database, and draws something.
# Usage (as root): packaging/arch/smoke.sh <anchoa-*.pkg.tar.zst> [screenshot.png]
set -euo pipefail

PKG=$(realpath "${1:?usage: smoke.sh <package> [screenshot]}")
SHOT=$(realpath -m "${2:-anchoa-arch-smoke.png}")

fail() { echo "FAIL: $*"; exit 1; }

pacman -Syu --noconfirm --needed
pacman -U --noconfirm "$PKG"

missing=$(ldd /usr/bin/anchoa | grep 'not found' || true)
[[ -z "$missing" ]] || fail "unresolved libraries: $missing"
[[ -f /usr/share/applications/Anchoa.desktop ]] || fail "desktop entry missing"
[[ -d /usr/lib/Anchoa ]] || fail "resource dir /usr/lib/Anchoa missing"
echo "OK: installed, libraries resolve"

# Test-only tools, installed after the package so they cannot hide a missing dependency.
pacman -S --noconfirm --needed xorg-server-xvfb xdotool imagemagick sqlite

id smoke >/dev/null 2>&1 || useradd -m smoke
WORK=$(runuser -u smoke -- mktemp -d)
runuser -u smoke -- env WORK="$WORK" bash -s <<'EOS'
set -euo pipefail
fail() { echo "FAIL: $*"; exit 1; }
export DISPLAY=:99 XDG_DATA_HOME="$WORK/data" XDG_CONFIG_HOME="$WORK/config" XDG_RUNTIME_DIR="$WORK/run"
mkdir -p "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 &
XVFB=$!
{ read -r DBUS_SESSION_BUS_ADDRESS; read -r DBUS_PID; } < <(dbus-daemon --session --fork --print-address=1 --print-pid=1)
export DBUS_SESSION_BUS_ADDRESS
/usr/bin/anchoa >"$WORK/app.log" 2>&1 &
APP=$!
trap 'kill $APP $DBUS_PID $XVFB 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  xdotool search --name '^Anchoa$' >/dev/null 2>&1 && break
  kill -0 "$APP" 2>/dev/null || { cat "$WORK/app.log"; fail "app exited during start-up"; }
  sleep 1
done
xdotool search --name '^Anchoa$' >/dev/null 2>&1 || { cat "$WORK/app.log"; fail "no Anchoa window after 60 s"; }
DB="$XDG_DATA_HOME/io.github.syharipf.anchoa/anchoa.db"
for _ in $(seq 1 30); do
  [[ -s "$DB" ]] && break
  sleep 1
done
[[ -s "$DB" ]] || fail "database not created at $DB"
[[ -n "$(sqlite3 "$DB" "SELECT 1 FROM sqlite_master WHERE name = 'items'")" ]] || fail "items table missing"

# Give the webview time to load fonts and paint, then make sure it drew a real page.
sleep 8
kill -0 "$APP" 2>/dev/null || { cat "$WORK/app.log"; fail "app crashed after start-up"; }
import -window root "$WORK/shot.png"
colors=$(magick "$WORK/shot.png" -format '%k' info:)
echo "screenshot unique colours: $colors"
[[ "$colors" -gt 50 ]] || { cat "$WORK/app.log"; fail "window looks blank ($colors colours)"; }
echo "--- app log ---"
cat "$WORK/app.log"
EOS
cp "$WORK/shot.png" "$SHOT"
echo "OK: app ran from the installed package; screenshot at $SHOT"
