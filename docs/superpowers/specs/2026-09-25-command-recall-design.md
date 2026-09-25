# Riwayat Perintah di Panel — Desain

Tanggal: 2026-09-25. Tambahan kecil untuk panel perintah (PRD §4.5, R9).

## Perilaku

- Di panel perintah, panah atas memanggil perintah sebelumnya, panah bawah bergerak maju. Setelah yang terbaru, panah bawah mengembalikan teks yang sedang diketik sebelum mulai menelusuri (draft).
- Sumbernya tabel `command_history` (termasuk perintah yang tidak dikenali, agar typo bisa diperbaiki), unik, terbaru dulu, maksimal 100.
- Daftar dimuat di worker setelah database terbuka, dan dimuat ulang setelah setiap perintah dicatat (dieksekusi atau tidak dikenali).
- Mengetik manual di panel tidak mengubah posisi; `up` berikutnya menyimpan teks saat itu sebagai draft baru hanya bila penelusuran belum dimulai atau sudah kembali ke draft.
- Tanpa database: tidak ada riwayat, panah atas/bawah tidak melakukan apa-apa.

## Unit

- `history::recent_commands(conn, limit: usize) -> Result<Vec<String>, DbError>`: `input` unik, urut `MAX(id)` menurun, maksimal `limit`.
- `command::Recall` (logika murni, tanpa GTK):
  - `new(items: Vec<String>)` — `items` terbaru dulu.
  - `up(&mut self, current: &str) -> Option<String>` — langkah pertama menyimpan `current` sebagai draft dan mengembalikan item terbaru; berikutnya item yang lebih lama; di item tertua → `None` (tetap di tempat); daftar kosong → `None`.
  - `down(&mut self) -> Option<String>` — ke item yang lebih baru; dari item terbaru → draft dan penelusuran selesai; belum menelusuri → `None`.
- UI (`main.rs`): `App` memegang satu `Recall`; `ShortcutController` pada entry perintah untuk `Up`/`Down` memanggil `up`/`down` dan, bila `Some`, `set_text` + kursor di akhir. `Recall` diganti baru setiap daftar dimuat ulang.

## Test (ditulis dulu, pelaksana tidak boleh mengubah)

`tests/history.rs`: `recent_commands` unik/terbaru dulu/limit, riwayat kosong. `tests/command.rs`: `Recall` naik sampai tertua, turun sampai draft, turun sebelum naik, daftar kosong, mulai ulang setelah kembali ke draft.

Shortcut dan pemuatan di UI diuji manual.
