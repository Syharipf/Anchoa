# Panel Perintah (rule-based) — Desain

Tanggal: 2026-09-25. PRD: §4.5, §4.8, §6.1 langkah 4, §6.2, §6.6.

## Scope

Masuk PR ini: panel perintah rule-based end to end — ketik perintah, preview, konfirmasi, eksekusi, riwayat, undo.

Ditunda (PR lain): LLM fallback (§6.3), dialog konflik skip/replace/keep both (Validator tetap menolak tujuan yang sudah ada), progress + batal saat eksekusi (§6.4), link ke Settings → Model (Settings belum ada).

## UI

- `gtk::Entry` di bawah list file, selalu terlihat. Placeholder: `move *.jpg older than 30d to ~/Pictures/old`.
- Ctrl+K fokus ke panel. F6 berputar sidebar → list → panel → sidebar. Esc di panel: kembali ke list.
- Enter: kirim perintah. Teks tetap di panel sampai eksekusi berhasil (lalu dikosongkan), jadi typo bisa diperbaiki.
- Pesan error parser tampil di label di bawah entry, plus maksimal 3 contoh sintaks terdekat. Label hilang saat teks diubah.

## Alur

```text
Enter -> Msg::Submit(Job::Command { input }, ..)            (UI thread)
  [worker] parser::parse -> planner::build(cwd, home, now) -> file_ops::validate
    parse gagal    -> record_command(resolved_by = none), tampilkan error + command::examples
    planner gagal  -> tampilkan PlanError (toast), tanpa eksekusi, tanpa record
    validator tolak-> file_ops::show_rejections, tanpa eksekusi
    lolos          -> command::preview(plan) untuk heading dialog
  confirm dialog (selalu, termasuk mkdir) -> Msg::Run
  [worker] history::begin(Source::Rule) -> execute -> history::finish
           -> record_command(resolved_by = rule, confidence 1.0, operation_id)
  toast hasil; Ctrl+Z meng-undo seperti operasi manual
```

Parser tidak punya confidence parsial (lihat doc `parser.rs`): lolos = 1.0.

Perintah yang dibatalkan di dialog konfirmasi tidak dicatat — `command_history` hanya perintah yang dieksekusi atau yang tidak dikenali.

## Unit baru

### `anchoa::command` (baru, `src/command.rs`)

- `EXAMPLES: [&str; 6]` — contoh dari PRD §4.5, urutan move, trash, copy, rename, mkdir, chmod.
- `examples(input) -> Vec<&'static str>`: tepat 3 contoh. Kata pertama input (lowercase) dibandingkan dengan verb tiap contoh; contoh yang verbnya diawali kata itu, atau kata itu diawali verbnya, didahulukan. Sisanya diisi urutan `EXAMPLES`. Tanpa duplikat.
- `Preview { items, bytes, new_dirs }` + `preview(&ActionPlan) -> Preview` (blocking, worker):
  - `items`: jumlah aksi selain `Mkdir`.
  - `bytes`: total ukuran sumber aksi `Move`/`Copy`/`Trash` yang berupa file (`symlink_metadata`); folder dihitung 0 — ponytail: tanpa hitung rekursif, tambahkan bila perlu. Sumber yang tidak bisa di-stat dilewati.
  - `new_dirs`: path semua aksi `Mkdir`, urutan plan.

### `anchoa::history` (tambahan)

- `ResolvedBy { Rule, Llm, None }` → kolom `resolved_by` (`rule`/`llm`/`none`).
- `record_command(conn, input, resolved_by, confidence: Option<f64>, operation_id: Option<i64>, now) -> Result<i64, DbError>`.

### Binary (`main.rs`, `file_ops.rs`)

- `Job::Command { input: String }`; `file_ops::run` untuk job ini memakai `Source::Rule` dan memanggil `record_command` setelah `finish`. Kegagalan record = warning, bukan error operasi (sama seperti history).
- `file_ops::confirm` untuk `Job::Command`: heading `"Run: <input>"`, baris ringkasan `N items, <ukuran>` + `Creates <folder>` per `new_dirs`, lalu daftar `describe` yang sudah ada (dipendekkan). Tombol "Run", appearance Suggested kecuali ada `Trash` (Destructive).
- `summary` untuk `Job::Command`: `"Done: N items"`.

## Test (ditulis dulu, tidak boleh diubah pelaksana)

- `tests/command.rs`: `examples` (verb cocok, prefix typo `mov`, verb tak dikenal, tanpa duplikat, selalu 3), `preview` (hitung item tanpa mkdir, total ukuran file, folder = 0, sumber hilang dilewati, `new_dirs`).
- `tests/history.rs`: `record_command` untuk `rule` + `operation_id`, dan `none` tanpa operasi; `operation_id` jadi NULL saat operasi dipangkas.

UI (Ctrl+K, F6, Esc, dialog) diuji manual oleh pengguna.
