# Copy / Cut / Paste, Drag and Drop + Dialog Konflik — Desain

Tanggal: 2026-09-25. PRD: §4.2 (operasi manual), R8.

## Scope

Masuk: Ctrl+C / Ctrl+X / Ctrl+V di list file, drag and drop, dialog konflik saat tujuan sudah ada, dicatat ke history sehingga Ctrl+Z bekerja.

Tidak masuk:
- Clipboard sistem (interop dengan Nautilus/Dolphin lewat `x-special/gnome-copied-files`). Clipboard internal saja — ponytail: tambahkan bila pengguna butuh paste antar aplikasi.
- Pilihan per item. Satu kebijakan untuk semua konflik di satu paste (setara "terapkan ke semua" selalu aktif), karena `ActionPlan.on_conflict` memang satu per plan. Tambahkan per item bila ada permintaan nyata.
- Drop ke baris Trash atau drive yang belum di-mount di sidebar (diabaikan). Progress/batal.

## Perilaku

- Ctrl+C / Ctrl+X: simpan path item terpilih + mode (copy/cut) di state `App`. Toast `Copied N items` / `Cut N items`. Tanpa pilihan: tidak terjadi apa-apa.
- Ctrl+V: tempel ke folder aktif. Tidak ada di clipboard: tidak terjadi apa-apa. Di folder Trash: tidak didukung (toast).
- Copy ke folder yang sama dengan sumbernya → konflik dengan dirinya sendiri → dialog konflik; "Keep Both" menghasilkan `name (2).ext` (executor sudah mendukung).
- Cut lalu paste ke folder asal → item itu dibuang dari plan (no-op). Plan kosong → tidak terjadi apa-apa.
- Setelah cut-paste berhasil, clipboard dikosongkan. Copy tetap di clipboard (bisa ditempel berkali-kali).
- Tidak ada dialog konfirmasi terpisah untuk paste tanpa konflik: tindakan eksplisit, dan bisa di-undo (sama seperti rename/new folder). Paste dengan konflik selalu lewat dialog konflik.

## Drag and drop

- Sumber drag: item terpilih di list (atau item yang di-drag bila tidak terpilih), konten `gdk::FileList`. Karena formatnya standar, drag keluar ke Nautilus/Dolphin dan drop masuk dari aplikasi lain ikut berfungsi.
- Target drop: baris folder di list (masuk ke folder itu), area kosong list (folder aktif), baris Places/Bookmarks/drive yang sudah di-mount di sidebar.
- Aksi: Ctrl = copy, Shift = move. Tanpa modifier: move bila sumber dan tujuan satu filesystem, copy bila beda (konvensi Nautilus), lewat `paste::same_device`.
- Setelah drop, jalurnya sama persis dengan Ctrl+V: `paste::plan` → `conflicts` → dialog konflik bila perlu → `Msg::Submit(Job::Paste { cut })`. Drag and drop tidak menyentuh clipboard.
- Drag and drop hanya pelengkap mouse; semua yang bisa dilakukan dengannya juga bisa lewat keyboard (Ctrl+C/X/V), jadi R9 tetap terpenuhi.

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

- `plan(sources: &[PathBuf], dest: &Path, cut: bool) -> ActionPlan`: satu `Copy` (atau `Move` bila `cut`) per sumber ke `dest.join(nama_file)`, urutan sumber, `on_conflict: None`. Dilewati: bila `cut` dan folder induk sumber == `dest`; bila `dest` sama dengan sumber atau berada di dalamnya (folder ke dalam dirinya sendiri, untuk copy maupun cut); sumber tanpa nama file (mis. `/`).
- `conflicts(plan: &ActionPlan) -> Vec<PathBuf>`: `dst` dari aksi `Move`/`Copy`/`Rename` yang sudah ada di disk (`symlink_metadata`, jadi symlink rusak juga dihitung), urutan plan.

- `same_device(src: &Path, dest: &Path) -> bool`: `st_dev` keduanya sama (`MetadataExt::dev`, `symlink_metadata` untuk sumber). Salah satu tidak bisa di-stat → `false` (jatuh ke copy, yang tidak menghapus sumber).

Semuanya blocking-ringan (stat); panggil di worker.

## Binary

- `Job::Paste { cut: bool }`: `confirm` langsung emit (seperti Rename), `summary` → `Pasted N items` (+ `, M skipped` bila ada `ItemStatus::Skipped`).
- `App.clipboard: Option<(Vec<PathBuf>, bool)>`.

## Test (ditulis dulu, pelaksana tidak boleh mengubah)

`tests/paste.rs`: plan copy/cut, cut ke folder asal dilewati, copy ke folder asal tetap ada, `conflicts` menemukan file, folder, symlink rusak, dan tidak melaporkan yang belum ada; aksi selain move/copy/rename diabaikan; folder tidak bisa ditempel ke dalam dirinya sendiri; `same_device` benar di satu filesystem dan `false` untuk path yang tidak ada.

UI (shortcut, drag and drop, dialog, toast) diuji manual oleh pengguna.
