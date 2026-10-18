# PRD: Autentikasi Biometrik & Multi-Factor Desktop

## 1. Sasaran Produk
Menyediakan modul otentikasi lokal multi-faktor yang aman, cepat, dan terintegrasi untuk pengguna desktop Linux (Argon2id + PAM / fprintd).

## 2. Alur Proses Bisnis
1. **Input Pengguna:** Pengguna memasukkan PIN 6 digit atau menempelkan sidik jari pada sensor biometrik.
2. **Validasi Hash:** Backend Rust melakukan hashing kredensial dengan algoritma Argon2id dan membandingkannya dengan hash di database SQLite terenkripsi.
3. **Rate Limiting:** Maksimal 5 kali percobaan gagal berturut-turut. Jika terlampaui, sistem mengunci input selama 30 detik (cooldown).
4. **Otorisasi Sesi:** Setelah verifikasi berhasil, sesi aplikasi dibuka dan kunci dekripsi data didekripsi ke memori.

## 3. Kriteria Selesai & Pengujian
- [x] Skema database dan tabel `security_keys` tersimpan.
- [x] Hashing Argon2id teruji tanpa kebocoran memori.
- [ ] Pengujian timeout cooldown 30 detik via unit test Rust.
- [ ] Integrasi UI modal dialog konfirmasi PIN di frontend.
