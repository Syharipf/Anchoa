# Copy / Cut / Paste + Dialog Konflik — Desain

Tanggal: 2026-09-25. PRD: §4.2 (operasi manual), R8.

## Scope

Masuk: Ctrl+C / Ctrl+X / Ctrl+V di list file, dialog konflik saat tujuan sudah ada, dicatat ke history sehingga Ctrl+Z bekerja.

Tidak masuk:
- Clipboard sistem (interop dengan Nautilus/Dolphin lewat `x-special/gnome-copied-files`). Clipboard internal saja — ponytail: tambahkan bila pengguna butuh paste antar aplikasi.
- Pilihan per item. Satu kebijakan untuk semua konflik di satu paste (setara "terapkan ke semua" selalu aktif), karena `ActionPlan.on_conflict` memang satu per plan. Tambahkan per item bila ada permintaan nyata.
- Drag and drop, progress/batal.

## Perilaku

- Ctrl+C / Ctrl+X: simpan path item terpilih + mode (copy/cut) di state `App`. Toast `Copied N items` / `Cut N items`. Tanpa pilihan: tidak terjadi apa-apa.
- Ctrl+V: tempel ke folder aktif. Tidak ada di clipboard: tidak terjadi apa-apa. Di folder Trash: tidak didukung (toast).
- Copy ke folder yang sama dengan sumbernya → konflik dengan dirinya sendiri → dialog konflik; "Keep Both" menghasilkan `name (2).ext` (executor sudah mendukung).
- Cut lalu paste ke folder asal → item itu dibuang dari plan (no-op). Plan kosong → tidak terjadi apa-apa.
- Setelah cut-paste berhasil, clipboard dikosongkan. Copy tetap di clipboard (bisa ditempel berkali-kali).
- Tidak ada dialog konfirmasi terpisah untuk paste tanpa konflik: tindakan eksplisit, dan bisa di-undo (sama seperti rename/new folder). Paste dengan konflik selalu lewat dialog konflik.

## Dialog konflik

`adw::AlertDialog`: heading `N items already exist in <folder>`, isi daftar nama (dipendekkan seperti `confirm`). Tombol: Cancel, Skip, Keep Both, Replace (Destructive). Enter = Keep Both (paling aman yang tetap menjalankan paste), Esc = Cancel. Replace berarti item lama masuk trash (executor), tidak dihapus permanen.

## Alur

```text
Ctrl+V -> [worker] paste::plan(sources, cwd, cut) -> paste::conflicts(&plan)
  kosong    -> Msg::Submit(Job::Paste { cut }, plan)          (jalur validate -> run yang ada)
  ada       -> dialog konflik -> plan.on_conflict = Some(policy) -> Msg::Submit(..)
  Cancel    -> tidak ada apa-apa
```

## Unit baru: `loom::paste` (`src/paste.rs`)

- `plan(sources: &[PathBuf], dest: &Path, cut: bool) -> ActionPlan`: satu `Copy` (atau `Move` bila `cut`) per sumber ke `dest.join(nama_file)`, urutan sumber, `on_conflict: None`. Bila `cut` dan folder induk sumber == `dest`, sumber itu dilewati. Sumber tanpa nama file (mis. `/`) dilewati.
- `conflicts(plan: &ActionPlan) -> Vec<PathBuf>`: `dst` dari aksi `Move`/`Copy`/`Rename` yang sudah ada di disk (`symlink_metadata`, jadi symlink rusak juga dihitung), urutan plan.

Keduanya blocking-ringan (stat); panggil di worker.

## Binary

- `Job::Paste { cut: bool }`: `confirm` langsung emit (seperti Rename), `summary` → `Pasted N items` (+ `, M skipped` bila ada `ItemStatus::Skipped`).
- `App.clipboard: Option<(Vec<PathBuf>, bool)>`.

## Test (ditulis dulu, pelaksana tidak boleh mengubah)

`tests/paste.rs`: plan copy/cut, cut ke folder asal dilewati, copy ke folder asal tetap ada, `conflicts` menemukan file, folder, symlink rusak, dan tidak melaporkan yang belum ada; aksi selain move/copy/rename diabaikan.

UI (shortcut, dialog, toast) diuji manual oleh pengguna.
