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
make_task() {
  local title="$1"
  sql "UPDATE items SET type = 'task' WHERE title = '$title'"
  sql "INSERT INTO tasks (item_id, status) SELECT id, 'plan' FROM items WHERE title = '$title'"
}

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
  [[ "$(sql 'PRAGMA user_version')" = 7 ]] || fail "database not created or not migrated"
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
  for y in 202 256 310 364 418 472 526 706; do
    click 36 "$y"
    shot "3-nav-$y"     # expect: placeholder page (Email, Jadwal, Unduhan … Profil); y=310 is Habit; y=364 is Keuangan; y=418 is Proyek; y=472 is Berkas
  done
  click 36 148          # Jurnal: the mini assistant replaces the side panel
  shot 3-mini-closed    # expect: round 60px button bottom right, lime mic badge
  click 1226 746        # open the mini assistant
  shot 3-mini-open      # expect: 304px popup, "Siap", keyboard and mic buttons
  xdotool key Escape
  sleep 0.3
  shot 3-mini-collapsed # expect: round button again
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

  click 36 148          # nav: Jurnal
  shot 4-inbox
  click 600 460         # body textarea di editor tengah
  xdotool type --delay 20 'isi dari e2e'
  sleep 1.5             # autosave fires after 500 ms
  shot 4-item
  [[ "$(sql "SELECT body FROM items")" = "isi dari e2e" ]] || fail "autosave did not store the body"
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
  shot 4-palette-keuangan   # expect: Keuangan page with "Belum ada akun"
  xdotool key ctrl+k
  sleep 0.3
  xdotool key Escape
  sleep 0.3
  shot 4-palette-closed     # expect: palette gone, Keuangan still open
  [[ "$(sql "SELECT COUNT(*) FROM items")" = 0 ]] || fail "opening a page must not save a note"
  click 36 148          # Jurnal
  xdotool key ctrl+n
  sleep 0.3
  xdotool type --delay 20 'catatan dari palette'
  xdotool key Return
  sleep 1
  shot 4-palette-inbox  # expect: the new note listed in the Jurnal
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
  xdotool key ctrl+n
  sleep 0.3
  xdotool type --delay 20 'tugas besok'
  xdotool key Return
  sleep 1
  make_task 'tugas hari ini'
  make_task 'tugas terlambat'
  make_task 'tugas besok'
  sql "UPDATE items SET due_at = CAST(strftime('%s', 'now', 'localtime', 'start of day', 'utc') AS INTEGER) * 1000 WHERE title = 'tugas hari ini'"
  sql "UPDATE items SET due_at = CAST(strftime('%s', 'now', 'localtime', 'start of day', '-1 day', 'utc') AS INTEGER) * 1000 WHERE title = 'tugas terlambat'"
  sql "UPDATE items SET due_at = CAST(strftime('%s', 'now', 'localtime', 'start of day', '+1 day', 'utc') AS INTEGER) * 1000 WHERE title = 'tugas besok'"
  click 36 148          # Jurnal, then back to Dashboard so it reloads
  click 36 94           # nav: Dashboard
  shot 5-dashboard      # expect: bento, "2 tugas hari ini · 1 terlambat", "tugas besok" in the first upcoming column
  click 137 257         # checkbox of the first task ("tugas terlambat")
  sleep 1
  [[ -n "$(sql "SELECT completed_at FROM items WHERE title = 'tugas terlambat'")" ]] || fail "ticking a task did not set completed_at"
  shot 5-dashboard-done # expect: row struck through, "1/2 selesai"
  stop_app
}

check_notifications() {
  fresh
  start_app
  click 36 652          # bell with no reminders
  shot 7-notif-empty    # expect: "Tidak ada pengingat."
  xdotool key Escape
  xdotool key ctrl+n
  sleep 0.3
  xdotool type --delay 20 'tugas terlambat'
  xdotool key Return
  sleep 1
  make_task 'tugas terlambat'
  sql "UPDATE items SET due_at = CAST(strftime('%s', 'now', 'localtime', 'start of day', '-2 day', 'utc') AS INTEGER) * 1000"
  click 36 148          # Jurnal reloads the dashboard data behind the bell
  shot 7-notif-dot      # expect: coral dot on the bell
  click 36 652
  shot 7-notif-late     # expect: group "Terlambat" with "tugas terlambat"
  xdotool key Escape
  sleep 0.3
  shot 7-notif-closed
  xdotool search --name '^Anchoa$' >/dev/null || fail "app window disappeared"
  stop_app
}

# Opens the palette action "Catat transaksi" (the first option for "catat").
palette_new_transaction() {
  xdotool key ctrl+k
  sleep 0.3
  xdotool type --delay 20 'catat'
  xdotool key Return
  sleep 1
}

# With no account yet, the palette action opens the account form ("Buat akun dulu").
# Creates BCA (bank) with an opening balance of 1.000.000. Optional $1: screenshot of the form.
add_account() {
  palette_new_transaction
  if [[ -n "${1:-}" ]]; then shot "$1"; fi
  xdotool type --delay 20 'BCA'
  xdotool key Tab Tab   # Nama -> Jenis -> Saldo awal
  xdotool type --delay 20 '1000000'
  xdotool key Return
  sleep 1
  [[ "$(sql "SELECT i.title || ':' || a.kind || ':' || a.opening_balance FROM accounts a JOIN items i ON i.id = a.item_id")" = "BCA:bank:1000000" ]] \
    || fail "account not saved"
}

check_finance() {
  fresh
  start_app
  click 36 364                 # nav: Keuangan
  shot 10-finance-empty        # expect: four cards at Rp 0, six empty bars, "Belum ada akun"
  add_account 10-account-form  # expect: "Akun baru" with "Buat akun dulu", focus in Nama

  palette_new_transaction
  shot 10-transaction-form     # expect: Pengeluaran pressed, account BCA, today's date
  xdotool type --delay 20 '25.000'
  xdotool key Tab Tab          # Jumlah -> Akun -> Kategori
  xdotool type --delay 20 'Makan & minum'
  xdotool key Tab              # Keterangan
  xdotool type --delay 20 'Makan siang'
  xdotool key Return
  sleep 1
  [[ "$(sql "SELECT t.amount || ':' || t.category || ':' || i.title FROM transactions t JOIN items i ON i.id = t.item_id")" = "-25000:Makan & minum:Makan siang" ]] \
    || fail "expense not saved"

  click 820 200                # the Pengeluaran card opens the limit form
  xdotool type --delay 20 '200000'
  xdotool key Return
  sleep 1
  [[ "$(sql "SELECT b.amount FROM budgets b JOIN items i ON i.id = b.item_id WHERE i.deleted_at IS NULL")" = 200000 ]] \
    || fail "limit not saved"
  shot 10-finance              # expect: saldo Rp 975.000, Pengeluaran Rp 25.000 dari Rp 200.000, one row, BCA 100% saldo
  [[ "$(sql "SELECT COUNT(*) FROM items WHERE type = 'note'")" = 0 ]] || fail "finance forms must not create notes"

  click 36 94                  # nav: Dashboard
  shot 10-dashboard            # expect: Keuangan card Rp 975.000, "Keluar bulan ini Rp 25.000 dari Rp 200.000", "Tagihan aman"
  stop_app
}

check_bills() {
  fresh
  start_app
  click 36 364                 # nav: Keuangan
  add_account
  shot 11-finance-account      # measure "+ Tambah" of Tagihan and the first bill row from here
  click 1207 461               # Tagihan: + Tambah (no limit set, so the cards are 12px shorter than in check_finance)
  shot 11-bill-form            # expect: "Tagihan baru", Bulanan pressed, due today
  xdotool type --delay 20 'Listrik'
  xdotool key Tab              # Nama -> Jumlah
  xdotool type --delay 20 '150000'
  xdotool key Return
  sleep 1
  [[ "$(sql "SELECT i.title || ':' || b.amount || ':' || b.repeat FROM bills b JOIN items i ON i.id = b.item_id")" = "Listrik:150000:monthly" ]] \
    || fail "bill not saved"
  sql "UPDATE items SET due_at = CAST(strftime('%s', 'now', 'localtime', 'start of day', '-1 day', 'utc') AS INTEGER) * 1000 WHERE type = 'bill'"
  # Keep due_day in step with the moved date, as saving the bill would (it drives the next monthly due date).
  sql "UPDATE bills SET due_day = CAST(strftime('%d', 'now', 'localtime', '-1 day') AS INTEGER)"

  click 36 94                  # nav: Dashboard reloads the data behind the bell
  shot 11-dashboard-late       # expect: "· 1 tagihan terlambat", chip "1 terlambat", coral dot on the bell
  click 36 652                 # bell
  shot 11-notif-bill           # expect: "Listrik" under Terlambat, "Terlambat 1 hari · Rp 150.000"
  xdotool key Escape
  sleep 0.3
  click 36 364                 # nav: Keuangan
  shot 11-bill-late            # expect: Listrik row on coral, "Terlambat 1 hari · sejak <yesterday>", "Tandai lunas"
  before=$(sql "SELECT due_at FROM items WHERE type = 'bill'")
  click 1177 508               # Tandai lunas on the first bill row
  sleep 1
  shot 11-bill-paid            # expect: "Lunas hari ini", toast "Tercatat Rp 150.000" with "Ubah"
  [[ "$(sql "SELECT amount || ':' || category FROM transactions WHERE bill_id IS NOT NULL")" = "-150000:Tagihan" ]] \
    || fail "payment not recorded"
  after=$(sql "SELECT due_at FROM items WHERE type = 'bill'")
  (( after - before >= 28 * 86400000 )) || fail "due date did not move a month ahead"
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

check_projects() {
  fresh
  start_app
  click 36 418                 # nav: Proyek
  shot 12-projects-empty        # measure "+ Proyek" and other coordinates from here
  click 1203 104                # + Proyek
  sleep 0.5
  xdotool type --delay 20 'Anchoa v1'
  xdotool key Return
  sleep 1
  click 450 355                 # + Tugas in Rencana
  sleep 0.5
  xdotool type --delay 20 'Tugas A'
  xdotool key Return
  sleep 1
  xdotool type --delay 20 'Tugas B'
  xdotool key Return
  sleep 1
  click 646 445                 # arrow on first card (Tugas A)
  sleep 1
  shot 12-projects
  proj_id=$(sql "SELECT item_id FROM projects")
  [[ -n "$proj_id" ]] || fail "project not created"
  [[ "$(sql "SELECT count(*) FROM projects")" = 1 ]] || fail "expected 1 project"
  [[ "$(sql "SELECT count(*) FROM tasks WHERE project_id = '$proj_id'")" = 2 ]] || fail "expected 2 tasks in project"
  [[ "$(sql "SELECT status FROM tasks WHERE project_id = '$proj_id' AND item_id = (SELECT id FROM items WHERE title = 'Tugas A')")" = "doing" ]] || fail "Tugas A should be doing"
  [[ "$(sql "SELECT status FROM tasks WHERE project_id = '$proj_id' AND item_id = (SELECT id FROM items WHERE title = 'Tugas B')")" = "plan" ]] || fail "Tugas B should be plan"
  # Task 10: subtask on Tugas B
  click 450 400                 # click Tugas B card
  sleep 1
  click 200 380                 # Tambah sub-tugas input
  sleep 0.5
  xdotool type --delay 20 'Sub 1'
  xdotool key Return
  sleep 1
  tugas_b_id=$(sql "SELECT id FROM items WHERE title = 'Tugas B'")
  [[ "$(sql "SELECT parent_id FROM items WHERE title = 'Sub 1'")" = "$tugas_b_id" ]] || fail "subtask parent_id not set"
  click 130 95                  # ← Kembali
  sleep 1
  shot 12-subtasks

  # Task 10: palette creates loose task
  xdotool key ctrl+k
  sleep 0.5
  xdotool type --delay 20 'tugas dari palette'
  sleep 0.5
  xdotool key Down
  sleep 0.3
  xdotool key Return
  sleep 1
  [[ "$(sql "SELECT t.status || ':' || COALESCE(t.project_id, 'loose') FROM tasks t JOIN items i ON i.id = t.item_id WHERE i.title = 'tugas dari palette'")" = "plan:loose" ]] \
    || fail "palette task not saved as loose plan task"

  # Task 10: convert note to task
  xdotool key ctrl+n
  sleep 0.5
  xdotool type --delay 20 'catatan jadi tugas'
  sleep 0.5
  xdotool key Return
  sleep 1
  click 36 148                  # nav: Jurnal
  sleep 1
  click 470 180                 # jenis: Ide
  sleep 0.7
  shot 12-note-item
  click 655 735                 # Jadikan tugas
  sleep 1
  [[ "$(sql "SELECT count(*) FROM items WHERE title = 'catatan jadi tugas' AND type = 'task'")" = "1" ]] || fail "task was not created from note"
  [[ "$(sql "SELECT status FROM tasks WHERE item_id = (SELECT id FROM items WHERE title = 'catatan jadi tugas' AND type = 'task')")" = "plan" ]] || fail "converted task status not plan"
  click 36 94                   # nav: Dashboard
  sleep 1
  shot 12-dashboard
  stop_app
}

check_schedule() {
  fresh
  start_app
  # 1. buat tugas bertenggat hari ini lewat palette "Buat tugas", lalu set due_at hari ini lewat SQL
  xdotool key ctrl+k
  sleep 0.5
  xdotool type --delay 20 'Tugas E2E'
  sleep 0.5
  xdotool key Down
  sleep 0.2
  xdotool key Return
  sleep 1
  sql "UPDATE items SET due_at = CAST(strftime('%s', 'now', 'localtime', 'start of day', 'utc') AS INTEGER) * 1000 WHERE title = 'Tugas E2E'"

  # 2. buat tagihan lewat SQL, dengan pola check_bills atau add_account dan formulir tagihan
  local now_ms
  now_ms=$(date +%s%3N)
  local due_ms
  due_ms=$(sql "SELECT CAST(strftime('%s', 'now', 'localtime', 'start of day', 'utc') AS INTEGER) * 1000")
  sql "INSERT INTO items (id, type, title, body, created_at, updated_at) VALUES ('acc-e2e', 'account', 'BCA', '', $now_ms, $now_ms)"
  sql "INSERT INTO accounts (item_id, kind, currency, opening_balance) VALUES ('acc-e2e', 'bank', 'IDR', 1000000)"
  sql "INSERT INTO items (id, type, title, body, due_at, created_at, updated_at) VALUES ('bill-e2e', 'bill', 'Tagihan Listrik', '', $due_ms, $now_ms, $now_ms)"
  sql "INSERT INTO bills (item_id, account_id, amount, repeat, due_day) VALUES ('bill-e2e', 'acc-e2e', 150000, 'monthly', CAST(strftime('%d', 'now', 'localtime') AS INTEGER))"

  # 3. nav Jadwal (y=256), lalu screenshot 13-calendar
  click 36 256
  sleep 1
  shot 13-calendar

  # 4. pilih hari ini lewat tombol "Hari ini" (posisi sel hari ini berubah tiap tanggal), lalu screenshot 13-agenda
  click 695 105
  sleep 1
  shot 13-agenda

  # 5. centang tugas di agenda, lalu cek DB status = 'done'
  click 964 344
  sleep 1
  [[ "$(sql "SELECT status FROM tasks WHERE item_id = (SELECT id FROM items WHERE title = 'Tugas E2E')")" = "done" ]] \
    || fail "task not marked done in schedule"

  # 6. matikan filter Tagihan, lalu screenshot 13-filter
  click 324 155
  sleep 1
  shot 13-filter

  # 7. toggle Timeline, screenshot 13-timeline
  sql "UPDATE tasks SET status = 'doing' WHERE item_id = (SELECT id FROM items WHERE title = 'Tugas E2E')"
  click 330 105
  sleep 1
  shot 13-timeline

  # 8. klik batang tugas dan pastikan halaman item terbuka. The window starts on
  # Monday of last week at x=342, 16px per day, so today's bar moves with the weekday.
  weekday=$(( $(date +%u) - 1 ))
  click $(( 342 + (7 + weekday) * 16 + 8 )) 264
  sleep 1
  shot 13-item
  [[ -n "$(sql "SELECT opened_at FROM items WHERE title = 'Tugas E2E'")" ]] || fail "timeline bar did not open the task"
  stop_app
}

check_habits() {
  fresh
  start_app
  click 36 310                 # nav: Habit
  shot 14-habits-empty         # measure "+ Habit" from here
  click 1215 104               # + Habit
  sleep 0.5
  xdotool type --delay 20 'Olahraga pagi'
  xdotool key Return
  sleep 1
  [[ "$(sql "SELECT i.title FROM habits h JOIN items i ON i.id = h.item_id WHERE i.deleted_at IS NULL")" = "Olahraga pagi" ]] \
    || fail "habit not saved"
  shot 14-habits-created       # measure checkbox from here
  click 140 351                # checkbox on the first habit row
  sleep 1
  [[ -n "$(sql "SELECT date FROM habit_checks WHERE deleted_at IS NULL")" ]] \
    || fail "habit not checked"
  shot 14-habits-checked
  click 140 351                # click again to uncheck
  sleep 1
  [[ -n "$(sql "SELECT deleted_at FROM habit_checks")" ]] \
    || fail "unchecking habit did not set deleted_at"
  shot 14-habits
  stop_app
}

check_journal() {
  fresh
  start_app

  local now_ms
  now_ms=$(date +%s%3N)
  sql "INSERT INTO items (id, type, title, body, created_at, updated_at) VALUES ('habit-journal', 'habit', 'Tulis jurnal', '', $now_ms, $now_ms)"
  sql "INSERT INTO habits (item_id, days, remind_on, auto_journal) VALUES ('habit-journal', 127, 0, 1)"

  xdotool key ctrl+n
  sleep 0.5
  xdotool type --delay 20 'catatan cepat jurnal'
  sleep 0.5
  xdotool key Return
  sleep 1
  [[ "$(sql "SELECT count(*) FROM items WHERE title = 'catatan cepat jurnal' AND type = 'note'")" = "1" ]] \
    || fail "quick capture note missing"

  click 36 148                  # nav: Jurnal
  sleep 1
  shot 15-journal-initial

  click 1215 104                # tombol Tulis
  sleep 1
  shot 15-journal-new

  click 480 235                 # judul
  xdotool type --delay 20 'Ide Bisnis Baru'
  sleep 0.5
  click 600 350                 # body
  xdotool type --delay 20 'Membangun aplikasi open-source untuk produktivitas.'
  sleep 1.5

  click 675 680                 # suasana hati 4 (Baik)
  sleep 1
  shot 15-journal-written

  click 470 180                 # ubah jenis ke Ide
  sleep 1
  shot 15-journal-idea

  click 655 735                 # Jadikan tugas
  sleep 1
  shot 15-journal

  [[ "$(sql "SELECT body FROM items WHERE title = 'Ide Bisnis Baru' AND type = 'note'")" = "Membangun aplikasi open-source untuk produktivitas." ]] \
    || fail "journal body not saved"
  [[ "$(sql "SELECT mood FROM journal_entries WHERE item_id = (SELECT id FROM items WHERE title = 'Ide Bisnis Baru' AND type = 'note')")" = "4" ]] \
    || fail "journal mood not saved"
  [[ "$(sql "SELECT count(*) FROM habit_checks WHERE habit_id = 'habit-journal' AND deleted_at IS NULL")" = "1" ]] \
    || fail "habit was not auto-checked upon writing journal"
  [[ "$(sql "SELECT count(*) FROM items WHERE title = 'Ide Bisnis Baru' AND type = 'task'")" = "1" ]] \
    || fail "task not created from idea"
  [[ "$(sql "SELECT status FROM tasks WHERE item_id = (SELECT id FROM items WHERE title = 'Ide Bisnis Baru' AND type = 'task')")" = "plan" ]] \
    || fail "created task status not plan"
  [[ -n "$(sql "SELECT task_id FROM journal_entries WHERE item_id = (SELECT id FROM items WHERE title = 'Ide Bisnis Baru' AND type = 'note')")" ]] \
    || fail "task_id not linked in journal_entries"

  stop_app
}

# Runs the app with a throwaway HOME, so the file manager never sees or
# trashes the real user's files.
check_files() {
  fresh
  local home="$WORK/home"
  rm -rf "$home" && mkdir -p "$home/Documents" "$home/Pictures" "$home/Downloads"
  echo "Catatan contoh untuk pratinjau." > "$home/Documents/catatan.txt"
  echo "Satu berkas lagi." > "$home/Documents/lain.txt"
  magick -size 64x64 xc:'#C6F36B' "$home/Pictures/contoh.png"
  magick xc:white "$home/Documents/kecil.pdf"
  HOME="$home" start_app
  click 36 472
  shot 16-files-home         # expect: Tempat sidebar, Documents/Downloads/Pictures folders
  xdotool mousemove 390 265 click --repeat 2 --delay 80 1; sleep 1
  click 390 265
  shot 16-files-preview      # expect: catatan.txt text in the 320px preview panel
  click 543 265
  sleep 3
  shot 16-files-pdf          # expect: WebKit PDF viewer, page 1 of 1
  click 162 350              # Gambar
  click 390 265
  sleep 1
  shot 16-files-image        # expect: lime thumbnail and image preview
  click 162 275              # Dokumen
  click 390 265
  xdotool keydown ctrl; click 689 265; xdotool keyup ctrl
  shot 16-files-multi        # expect: no preview, action bar "2 item · 50 B"
  click 938 752              # Salin
  click 162 313              # Unduhan
  click 1161 159             # Tempel 2 item
  sleep 1
  shot 16-files-pasted
  [[ -f "$home/Downloads/catatan.txt" && -f "$home/Downloads/lain.txt" ]] || fail "copied files missing"
  [[ -f "$home/Documents/catatan.txt" ]] || fail "copy removed the source"
  click 1161 159             # paste again: both names clash
  sleep 1
  shot 16-files-conflict     # expect: Ganti / Lewati / Simpan dengan nama baru
  click 640 336
  sleep 1
  [[ -f "$home/Downloads/catatan (2).txt" ]] || fail "rename on conflict did not create catatan (2).txt"
  click 390 265              # catatan (2).txt sorts first
  click 747 752              # Hapus
  shot 16-files-trash-confirm
  click 818 239
  sleep 1
  [[ ! -e "$home/Downloads/catatan (2).txt" ]] || fail "trashed file still in place"
  [[ -n "$(find "$WORK" -path '*Trash/files/catatan (2).txt')" ]] || fail "trashed file not in the throwaway Trash"
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
check_notifications
check_finance
check_bills
check_backup
check_assistant
check_github
check_projects
check_schedule
check_habits
check_journal
check_files
echo "PASS. Screenshots in $WORK"


