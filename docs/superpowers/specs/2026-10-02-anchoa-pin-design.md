# Anchoa — Kunci PIN

Tanggal: 2026-10-02
Status: keputusan user 2026-10-01 23:10 ("PIN saja dulu"; dependency mapan boleh). Detail diputuskan Claude dan bisa diubah nanti.

## 1. Ringkasan

Kartu Keamanan di Profil sekarang masih "Menyusul". Fase ini menambah kunci PIN: kalau aktif, Anchoa menampilkan layar kunci saat app dibuka, dan isi app baru bisa diakses setelah PIN benar. Enkripsi DB tidak termasuk dan menyusul.

## 2. Keputusan

| Kode | Keputusan | Alasan |
|---|---|---|
| K1 | PIN 4–8 digit angka. | Cepat diketik dan cukup untuk laptop pribadi. Pelindung utamanya tetap enkripsi disk dan login OS. |
| K2 | Hash dengan **Argon2id** (crate `argon2` dari RustCrypto) dan salt acak per PIN. Hash disimpan di tabel `settings` (`security.pin_hash`, format PHC string). PIN mentah tidak pernah disimpan atau di-log. | Standar untuk hash rahasia. User menyetujui dependency mapan. |
| K3 | Semua pemeriksaan ada di Rust. Command `security_status() -> { pinEnabled, locked }`, `unlock(pin)`, `set_pin(old?, new)`, `disable_pin(pin)`. State "terkunci" disimpan di Rust (`SecurityState`), dimulai `locked = pin_enabled` saat startup. | Frontend tidak bisa melewati kunci dengan mengubah state di JS. |
| K4 | Selama terkunci, semua command lain menolak dengan `AppError::Locked`, kecuali `security_status`, `unlock`, `app_status`, dan command yang dibutuhkan layar kunci. Guard dipasang di satu tempat: `invoke_handler` di `lib.rs` membungkus handler hasil `generate_handler!`. Selama terkunci, ia menolak setiap command yang tidak ada di daftar izin, lewat `invoke.resolver.reject("Anchoa terkunci")` dan `return true`. CLI `anchoa agent` **tidak** terkena kunci. | Kunci benar-benar melindungi data di app. CLI dipakai agen di terminal yang sudah login. |
| K5 | Salah 5 kali berturut-turut membuat jeda 30 detik, dengan batas penghitung di memori. Pesan error dalam bahasa Indonesia. | Menahan tebakan cepat tanpa mengunci user selamanya. |
| K6 | Layar kunci: logo, "Anchoa terkunci", input PIN (`inputMode="numeric"`, `type="password"`), tombol Buka, pesan error, dan sisa jeda. Ada tautan "Lupa PIN?" yang menjelaskan cara reset lewat terminal: hapus baris `security.pin_hash` dengan `sqlite3` setelah app ditutup. | Tidak ada pintu belakang di UI. Reset butuh akses ke berkas user. |
| K7 | Profil › Keamanan: sakelar "Kunci dengan PIN saat aplikasi dibuka". Menyalakannya membuka dialog Buat PIN (PIN dan konfirmasi). Mematikannya meminta PIN lama. Ada tombol Ganti PIN. Baris "Enkripsi data lokal" tetap menyusul. | Mengikuti artboard Profil. |
| K8 | Kunci otomatis setelah idle tidak dikerjakan di fase ini. | YAGNI. Bisa ditambah nanti. |

## 3. Testing

- **Rust:**
  - hash dan verifikasi (benar, salah);
  - PIN tidak valid ditolak (huruf, panjang);
  - `set_pin` butuh PIN lama kalau sudah ada;
  - `disable_pin` butuh PIN benar;
  - jeda setelah 5 kali salah;
  - command data menolak saat terkunci dan menerima setelah unlock.
- **Frontend:** layar kunci (benar, salah, jeda), alur sakelar di Profil.
- **E2E (`check_pin`):**
  - nyalakan PIN 1234 di Profil, lalu cek `security.pin_hash` di DB (dan bukan "1234");
  - tutup dan buka app, lalu layar kunci tampil;
  - PIN salah menampilkan pesan;
  - 1234 membuka Dashboard.

## 4. Rencana PR

| PR | Isi | Versi |
|---|---|---|
| K-1 (#112) | Backend `security.rs`, guard di command, test | — |
| K-2 (#113) | Layar kunci, Profil › Keamanan, E2E | 0.15.0 |
