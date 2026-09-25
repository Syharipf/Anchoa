# Tab Completion di Path Bar — Desain

Tanggal: 2026-09-26. PRD: §6.1 langkah 3 ("Tab melengkapi nama").

## Perilaku

- Di path bar (Ctrl+L), Tab melengkapi komponen terakhir dengan nama **folder** di folder yang dituju (file tidak dihitung: path bar hanya membuka folder).
- Satu kecocokan → nama lengkap + `/`. Beberapa → dilengkapi sampai awalan bersama; bila tidak ada yang bisa ditambahkan, tidak terjadi apa-apa (tanpa daftar pilihan — ponytail: tambahkan popover daftar bila diminta).
- Teks sebelum `/` terakhir tidak diubah (`~/Mu` → `~/Music/`, relatif tetap relatif). Folder tersembunyi hanya bila awalan diawali `.`. Case-sensitive, seperti shell.
- Tab tanpa hasil tidak memindahkan fokus ke widget lain (Tab di path bar selalu dipakai untuk completion). Kursor ke akhir teks setelah melengkapi.
- Listing folder berjalan di worker; hasil diterapkan hanya bila teks di path bar belum berubah sejak Tab ditekan.

## Unit baru

`fs::complete(input: &str, cwd: &Path, home: &Path) -> Option<String>` (blocking, worker): pisahkan `input` di `/` terakhir menjadi bagian folder (apa adanya) dan awalan; folder di-resolve lewat `resolve_input` (bagian kosong = `cwd`, `~` = home); daftar nama folder yang diawali awalan (`.`-rule di atas); kembalikan `bagian_folder + tambahan` menurut aturan di atas, atau `None`.

## Test (ditulis dulu, pelaksana tidak boleh mengubah)

`tests/complete.rs` — satu kecocokan, awalan bersama, tidak ada tambahan, teks sebelum `/` dipertahankan (`~`, relatif), folder tersembunyi, trailing slash.

Shortcut Tab di path bar diuji manual.
