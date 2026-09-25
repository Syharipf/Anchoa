# Settings — Desain

Tanggal: 2026-09-26. PRD: §4.11, R9.

## Scope

Masuk: preferensi yang sudah berpengaruh hari ini.

- **Tampilkan file tersembunyi** (`show_hidden`): dibaca saat startup sebagai keadaan awal list; Ctrl+H dan switch di dialog sama-sama mengubah dan menyimpannya.
- **Hapus otomatis trash setelah N hari** (`trash_auto_delete_days`, 0 = mati): sudah dipakai saat startup; kini bisa diubah dari dialog. Berlaku pada startup berikutnya.

Ditunda:
- Pemilih file model `.gguf` dan threshold confidence: baru berguna setelah LLM fallback ada (tanpa itu pengaturannya tidak melakukan apa-apa). `model_path` tetap di `Config` seperti sekarang.
- Sort default: belum ada di `Config`; tambahkan saat ada permintaan.

## Perilaku

- Ctrl+, membuka `adw::PreferencesDialog` (satu halaman "General"): `adw::SwitchRow` "Show hidden files" dan `adw::SpinRow` "Delete trash items after (days)" 0–365, subtitle "0 keeps them until you empty the trash".
- Setiap perubahan langsung disimpan (pola GNOME, tanpa tombol Apply) lewat `config::update` di worker; gagal simpan → toast `Cannot save settings: …`. Switch hidden files juga langsung mengubah list, sama seperti Ctrl+H.
- Startup: config dibaca di worker (sudah untuk trash); `show_hidden` diterapkan ke list begitu terbaca. Config tidak valid → default dipakai, dan toast `Settings file is invalid; using defaults` (file tidak ditimpa sampai pengguna mengubah sesuatu — dan `update` pun menolak menimpanya).

## Unit baru

- `config::update(path, change: impl FnOnce(&mut Config)) -> Result<Config, ConfigError>`: load (default bila file belum ada), terapkan `change`, save atomik (sudah lewat `save`), kembalikan hasilnya. File yang tidak bisa di-parse → `Err(Parse)` dan file tidak disentuh.

## Test (ditulis dulu, pelaksana tidak boleh mengubah)

`tests/config.rs`: `update` membuat file dari default, mempertahankan setting lain, dan tidak menimpa file yang tidak valid.

UI (dialog, Ctrl+,, penerapan saat startup, toast) diuji manual.
