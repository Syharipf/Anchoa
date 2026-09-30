#!/usr/bin/env bash
# End-to-end smoke test. Runs the app on a private Xvfb display with its own
# data dir and D-Bus, so it never touches the real session, real data, or a
# running Anchoa. Coordinates assume the fixed 1280x800 window at 0,0.
# Usage: scripts/e2e-smoke.sh <path-to-anchoa-binary>
set -euo pipefail

BIN=$(realpath "${1:?usage: e2e-smoke.sh <anchoa binary>}")
WORK=${E2E_DIR:-$HOME/.cache/anchoa-e2e}
APPDATA="$WORK/data/io.github.syharipf.anchoa"
APPCONFIG="$WORK/config/io.github.syharipf.anchoa"
DB="$APPDATA/anchoa.db"
# Private data AND config dirs: the real GitHub token lives in the config dir.
export DISPLAY=${E2E_DISPLAY:-:99} XDG_DATA_HOME="$WORK/data" XDG_CONFIG_HOME="$WORK/config"

rm -rf "$WORK" && mkdir -p "$WORK/data" "$WORK/config"
Xvfb "$DISPLAY" -screen 0 1280x800x24 >/dev/null 2>&1 &
XVFB=$!
{ read -r DBUS_SESSION_BUS_ADDRESS; read -r DBUS_PID; } < <(dbus-daemon --session --fork --print-address=1 --print-pid=1)
export DBUS_SESSION_BUS_ADDRESS
APP=
trap 'kill $APP $DBUS_PID $XVFB 2>/dev/null || true' EXIT
sleep 1

fail() { echo "FAIL: $*"; exit 1; }
shot() { import -window root "$WORK/$1.png"; }
sql() { sqlite3 "$DB" "$1"; }
click() { xdotool mousemove "$1" "$2" click 1; sleep 0.7; }

start_app() {
  "$BIN" >>"$WORK/app.log" 2>&1 &
  APP=$!
  xdotool search --sync --name '^Anchoa$' >/dev/null
  # WebKit needs a few seconds to paint under software GL: wait for a non-blank screen.
  for _ in $(seq 1 30); do
    sd=$(import -window root png:- | magick - -format '%[fx:standard_deviation]' info:)
    awk -v sd="$sd" 'BEGIN { exit !(sd > 0.01) }' && return
    sleep 1
  done
  fail "window never painted"
}

stop_app() { kill "$APP"; wait "$APP" 2>/dev/null || true; APP=; }

# Every check starts from an empty data dir: WAL files left by a killed run
# would otherwise leak into the next check.
fresh() { rm -rf "$APPDATA" "$APPCONFIG"; }

check_shell() {
  fresh
  start_app
  shot 1-shell
  stop_app
  [[ "$(sql 'PRAGMA user_version')" = 3 ]] || fail "database not created or not migrated"
}

check_corrupt_db() {
  fresh
  mkdir -p "$APPDATA"
  head -c 4096 /dev/urandom >"$DB"
  before=$(sha256sum "$DB")
  start_app
  shot 2-corrupt-db
  stop_app
  [[ "$(sha256sum "$DB")" = "$before" ]] || fail "corrupt database was modified"
}

check_nav() {
  fresh
  start_app
  for y in 202 256 310 364 418 472 706; do
    click 36 "$y"
    shot "3-nav-$y"     # expect: placeholder page (Email … Unduhan, then Profil)
  done
  click 36 148          # Inbox: the mini assistant replaces the side panel
  shot 3-mini-closed    # expect: round 60px button bottom right, lime mic badge
  click 1226 746        # open the mini assistant
  shot 3-mini-open      # expect: 304px popup, "Siap", keyboard and mic buttons
  xdotool search --name '^Anchoa$' >/dev/null || fail "app window disappeared"
  stop_app
}

check_items() {
  fresh
  start_app
  xdotool key ctrl+n
  sleep 0.3
  xdotool type --delay 20 'catatan dari e2e'
  xdotool key Return
  sleep 1
  [[ "$(sql "SELECT title FROM items")" = "catatan dari e2e" ]] || fail "capture not saved"

  click 36 148          # nav: Inbox
  shot 4-inbox
  click 300 181         # first inbox row
  click 600 460         # body textarea
  xdotool type --delay 20 'isi dari e2e'
  sleep 1.5             # autosave fires after 500 ms
  shot 4-item
  [[ "$(sql "SELECT body FROM items")" = "isi dari e2e" ]] || fail "autosave did not store the body"

  click 848 94          # Hapus
  shot 4-confirm
  click 781 98          # Ya, hapus
  [[ -n "$(sql "SELECT deleted_at FROM items")" ]] || fail "delete did not set deleted_at"
  stop_app
}

check_palette() {
  fresh
  start_app
  xdotool key ctrl+k
  sleep 0.3
  shot 4-palette        # expect: Buka halaman (10 pages), no Terbaru yet
  xdotool type --delay 20 'keu'
  xdotool key Return
  sleep 0.7
  shot 4-palette-keuangan   # expect: Keuangan placeholder page, "Hadir di Fase 2"
  xdotool key ctrl+k
  sleep 0.3
  xdotool key Escape
  sleep 0.3
  shot 4-palette-closed     # expect: palette gone, Keuangan still open
  [[ "$(sql "SELECT COUNT(*) FROM items")" = 0 ]] || fail "opening a page must not save a note"
  click 36 148          # Inbox
  xdotool key ctrl+n
  sleep 0.3
  xdotool type --delay 20 'catatan dari palette'
  xdotool key Return
  sleep 1
  shot 4-palette-inbox  # expect: the new note listed in the Inbox
  [[ "$(sql "SELECT COUNT(*) FROM items")" = 1 ]] || fail "palette capture must save exactly one note"
  stop_app
}

check_dashboard() {
  fresh
  start_app
  xdotool key ctrl+n
  sleep 0.3
  xdotool type --delay 20 'tugas hari ini'
  xdotool key Return
  sleep 1
  xdotool key ctrl+n
  sleep 0.3
  xdotool type --delay 20 'tugas terlambat'
  xdotool key Return
  sleep 1
  sql "UPDATE items SET due_at = CAST(strftime('%s', 'now', 'localtime', 'start of day', 'utc') AS INTEGER) * 1000 WHERE title = 'tugas hari ini'"
  sql "UPDATE items SET due_at = CAST(strftime('%s', 'now', 'localtime', 'start of day', '-1 day', 'utc') AS INTEGER) * 1000 WHERE title = 'tugas terlambat'"
  click 36 148          # Inbox, then back to Dashboard so it reloads
  click 36 94           # nav: Dashboard
  shot 5-dashboard      # expect: KPI "2 tersisa · 1 terlambat", late row first
  click 137 374         # checkbox of the first task ("tugas terlambat")
  sleep 1
  [[ -n "$(sql "SELECT completed_at FROM items WHERE title = 'tugas terlambat'")" ]] || fail "ticking a task did not set completed_at"
  shot 5-dashboard-done # expect: row struck through, KPI "1 tersisa", 1 dari 2 selesai
  stop_app
}

check_backup() {
  fresh
  start_app
  ls "$APPDATA"/backups/anchoa-*.db >/dev/null 2>&1 || fail "no daily backup at startup"
  click 36 760          # nav: Pengaturan
  click 186 247         # Backup sekarang
  shot 6-settings
  [[ "$(ls "$APPDATA"/backups/anchoa-*.db | wc -l)" -eq 2 ]] || fail "manual backup was not created"
  stop_app
}

check_assistant() {
  fresh
  start_app
  click 1091 750        # mic: idle -> listening
  shot 8-assistant-listening   # expect: chip "Mendengarkan…" coral, pulse ring, "Mikrofon aktif"
  click 1011 750        # keyboard: reveals the text field
  shot 8-assistant-typing      # expect: text field above the controls, send disabled
  click 1091 750        # mic again: back to idle
  shot 8-assistant-idle        # expect: chip "Siap", school dimmed
  xdotool search --name '^Anchoa$' >/dev/null || fail "app window disappeared"
  stop_app
}

check_github() {
  fresh
  start_app
  shot 9-github-disconnected   # expect: "Sambungkan GitHub di Pengaturan" in the side panel
  stop_app
  # Seed a connected account with today's cache so no request goes to GitHub.
  mkdir -p "$APPCONFIG"
  (umask 077 && printf 'ghp_e2e_placeholder' >"$APPCONFIG/github-token")
  sql "INSERT INTO github_sync (id, login, fetched_on) VALUES (1, 'e2e-user', date('now', 'localtime'))"
  for back in 0 1 2 4 9 30; do
    sql "INSERT INTO contributions (date, count) VALUES (date('now', 'localtime', '-$back day'), $((back * 3 + 1)))"
  done
  start_app
  shot 9-github-heatmap        # expect: heatmap, total, "streak 3 hari"
  click 1154 34                # previous month
  shot 9-github-previous
  click 36 760                 # nav: Pengaturan
  shot 9-github-settings       # expect: "Tersambung sebagai @e2e-user"
  grep -q 'Gagal menghubungi GitHub' "$WORK/app.log" && fail "the test reached the network"
  stop_app
}

if [[ -n "${E2E_ONLY:-}" ]]; then
  "$E2E_ONLY"
  echo "PASS ($E2E_ONLY). Screenshots in $WORK"
  exit 0
fi

check_shell
check_corrupt_db
check_nav
check_items
check_palette
check_dashboard
check_backup
check_assistant
check_github
echo "PASS. Screenshots in $WORK"
