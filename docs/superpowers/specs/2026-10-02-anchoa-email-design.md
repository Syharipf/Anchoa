# Anchoa Fase 8 — Email

Tanggal: 2026-10-02
Status: keputusan user 2026-10-01 23:10: Gmail lewat App Password, disimpan di keyring, tanpa OAuth; dependency mapan boleh. Detail teknis diputuskan Claude dan bisa diubah nanti.

## 1. Ringkasan

Menu Email sekarang masih halaman "Segera". Fase ini menyambungkan satu akun Gmail lewat IMAP/SMTP dengan App Password. Isinya:
- membaca kotak masuk, Berbintang, dan Terkirim;
- membuka email;
- menandai dibaca dan berbintang;
- mengarsipkan;
- membalas dan menulis email baru.

Ringkasan dan saran balasan dari asisten lokal, serta aksi kontekstual ("Jadikan tugas", "Tambahkan ke Jadwal"), ada di PR terakhir.

## 2. Keputusan

| Kode | Keputusan | Alasan |
|---|---|---|
| E1 | **Satu akun Gmail.** Alamat disimpan di `settings` (`email.address`). App Password hanya disimpan di keyring sistem (Secret Service lewat crate `keyring`), tidak pernah di DB, log, atau frontend setelah disimpan. | Keputusan user. Kredensial tetap di perangkat. |
| E2 | **TLS rustls, tanpa OpenSSL.** IMAP `imap.gmail.com:993` dan SMTP `smtp.gmail.com:465`. Crate mapan: klien IMAP (`async-imap` atau `imap`) dengan rustls, dan `lettre` dengan fitur rustls. | ureq sudah memakai rustls. Tidak perlu `openssl-devel` di CI atau di laptop. |
| E3 | **Email adalah item** `type = 'email'` (judul = subjek, body = teks polos yang sudah dibersihkan). Tabel ekstensi `emails(item_id, folder, uid, message_id, from_name, from_addr, to_addrs, sent_at, unread, starred, has_html)`, unik per `(folder, uid)`. | Prinsip "semua hal adalah item": email bisa dicari lewat FTS dan ditaut. |
| E4 | **Sinkron:** 200 header terbaru per folder (INBOX, `[Gmail]/Sent Mail`, dan yang ber-flag `\Flagged`) saat halaman dibuka dan dari tombol Sinkronkan. Badan diambil saat email dibuka, lalu di-cache di item. Email yang hilang dari server dihapus lunak (`deleted_at`). | Cepat dan hemat. Tanpa sinkron latar di fase ini. |
| E5 | **HTML** tidak pernah dirender sebagai HTML. Badan ditampilkan sebagai teks polos: bagian `text/plain` kalau ada; kalau tidak, HTML dikonversi ke teks dengan pembersih sederhana. Tautan tampil sebagai teks yang dibuka lewat `openLink` setelah diklik. Gambar remote tidak dimuat. | Keamanan: tanpa XSS dan tanpa pelacak piksel. |
| E6 | **Aksi:** tandai dibaca (`\Seen`), bintang (`\Flagged`), arsip (pindah ke `[Gmail]/All Mail`), balas (`In-Reply-To` dan `References`), dan tulis baru. Tidak ada hapus permanen. | Cukup untuk dipakai sehari-hari, dan aman. |
| E7 | **Asisten (PR terakhir):** peran baru `email` (lokal, default `qwen2.5:3b`). Isinya: ringkasan 2–3 poin, 3 saran balasan pendek, dan satu aksi kontekstual lewat usulan tools yang sudah ada (`create_task`, dll.), yang tetap harus disetujui. Hanya teks email yang dikirim ke model, tanpa kredensial. | Mengikuti artboard. Memakai otak Fase 5. |
| E8 | **Test** tidak butuh Gmail. Rust memakai trait `MailClient` dengan implementasi asli dan palsu, plus `keyring` mock. E2E memeriksa empty state "Sambungkan Gmail" dan alur dengan klien palsu yang diaktifkan lewat env `ANCHOA_FAKE_MAIL=1`, yang hanya berlaku di build debug. | Tanpa kredensial di CI. |

## 3. Backend

- **Migrasi 011:** tabel `emails` beserta indeks `(folder, sent_at DESC)` dan unik `(folder, uid)`.
- **`src-tauri/src/email/`:**
  - `account.rs`: simpan, uji, dan putuskan akun; keyring;
  - `client.rs`: trait `MailClient` dengan IMAP dan SMTP asli;
  - `fake.rs`: klien palsu untuk test dan E2E;
  - `sync.rs`: header, upsert, dan hapus lunak;
  - `body.rs`: MIME ke teks;
  - `send.rs`.
- **Command:** `email_status`, `email_connect(address, app_password)` (uji login dulu), `email_disconnect`, `email_sync`, `email_list(folder, filter, limit)`, `email_open(id)` (badan dan tandai dibaca), `email_set_flag(id, flag, on)`, `email_archive(id)`, `email_send(draft)`.
- DB tidak dipegang selama IO jaringan.

## 4. UI

- Halaman Email tiga kolom sesuai artboard `Email.dc.html` dan DESIGN.md §Email:
  - folder;
  - daftar dengan tab Semua / Belum dibaca, titik belum dibaca, dan bintang;
  - isi email dengan bar balasan (padding kanan 88px untuk tombol asisten).
- **Empty state:** "Sambungkan Gmail", berisi langkah membuat App Password, kolom alamat dan App Password, dan tombol Sambungkan.
- **Pengaturan › Integrasi:** kartu Email (status, alamat, Putuskan).
- **Profil › Akun terhubung:** baris Email menampilkan status.

## 5. Rencana PR

| PR | Isi | Versi |
|---|---|---|
| E-1 (#116) | Backend: akun dan keyring, klien, sinkron, badan, flag, kirim, migrasi, test | — |
| E-2 (#117) | UI tiga kolom, tulis/balas, empty state, Integrasi, E2E | 0.16.0 |
| E-3 (#118) | Asisten: ringkasan, saran balasan, aksi kontekstual, E2E | 0.17.0 |
