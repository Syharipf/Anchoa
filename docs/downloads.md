# Arsitektur & Spesifikasi Pengelola Unduhan Anchoa (Fase 7 Upgrade)

Dokumen ini menjelaskan arsitektur pengelola unduhan Anchoa setelah peningkatan Fase 7: multi-range partitioned transfer, pemulihan interupsi otomatis (resilience), integritas berkas SHA-256, deteksi media sosial baru (X/Twitter dan Telegram publik), serta handoff native messaging dari browser.

---

## 1. Pemisahan Range (Multi-Range Partitioned Download)

### Syarat 4-Worker Range
Unduhan berkas HTTP(S) akan dipartisi ke dalam 4 worker paralel jika dan hanya jika:
1. Ukuran berkas $\ge 8\text{ MiB}$ (8.388.608 byte).
2. Server merespons probe `GET bytes=0-0` dengan HTTP `206 Partial Content` dan header `Content-Range: bytes 0-0/<total>`.
3. Server menyediakan validator yang kuat (*strong ETag*, diawali dan diakhiri dengan `"` tanpa awalan `W/`).

Jika salah satu syarat tidak terpenuhi (misal ukuran tidak diketahui, server mengabaikan range, atau hanya menyediakan weak etag), sistem secara otomatis beralih ke *single-stream download*.

### Pembagian Partisi
Total byte dibagi rata menjadi 4 rentang byte kontigu tanpa jeda dan tanpa tumpang tindih (*non-overlapping*):
- Range 0: `0 .. (chunk - 1)`
- Range 1: `chunk .. (2 * chunk - 1)`
- Range 2: `(2 * chunk) .. (3 * chunk - 1)`
- Range 3: `(3 * chunk) .. (total - 1)`

Setiap worker membuka file handle independen ke `.anchoa-part/<id>/payload.part`, melakukan `seek(SeekFrom::Start(fetch_start))`, dan menulis langsung ke partisi masing-masing.

---

## 2. Checkpoint & Pemulihan Interupsi (Interruption Recovery)

### Checkpoint Atomik
- Disimpan di `.anchoa-part/<id>/resume.json`.
- Ditulis setiap $\ge 1\text{ MiB}$ atau setiap 2 detik (mana yang tercapai lebih dulu) setelah pemanggilan `file.sync_data()`.
- Penulisan bersifat atomik melalui berkas sementara `resume.json.tmp` yang kemudian di-rename ke `resume.json`.
- Struktur mencatat `version`, `url`, `validator`, `total`, `safe_name`, dan array `ranges` (start, end, done).

### Penanganan Kegagalan & Retry Bertingkat
1. **Network Retries Bounded (3 kali)**: Jika koneksi terputus atau mengembalikan HTTP 408/429/5xx, worker melakukan sleep eksponensial (1s, 2s, 4s) hingga maksimal 3 kali sebelum menyerah.
2. **Status Interrupted**: Jika 3 percobaan gagal di tengah unduhan, status baris diubah menjadi `interrupted`, bukan `failed`.
3. **Penjadwalan Otomatis**: Background scheduler memeriksa baris `interrupted` secara berkala (30s, 60s, 120s, hingga per 5 menit) hingga batas waktu 24 jam. Jika melewati 24 jam berturut-turut, status menjadi `failed`.
4. **App Exit / Startup**: Saat aplikasi ditutup atau dimulai kembali, unduhan berstatus `running` atau `processing` otomatis ditandai `interrupted` (bukan `paused`) dan di-resume dari checkpoint terakhir saat scheduler berjalan.

---

## 3. Integritas Berkas (SHA-256)

1. **Input Opsional**: Pengguna dapat memasukkan 64 digit heksadesimal SHA-256 pada dialog penambahan unduhan berkas.
2. **Validasi Hash Lengkap**: Setelah seluruh partisi selesai diunduh, sistem menghitung ringkasan SHA-256 dari seluruh `payload.part`.
3. **Pencocokan**:
   - Jika `expected_sha256` diberikan dan tidak cocok: unduhan ditandai gagal dengan galat `"Integritas SHA-256 tidak cocok"`, dan file akhir tidak dipublikasikan ke folder tujuan pengguna.
   - Jika cocok (atau tidak diberikan hash sumber): hash hasil perhitungan disimpan ke basis data (`actual_sha256`), lalu berkas dipindahkan secara aman ke nama tujuan final.

---

## 4. Ekstensi Browser & Native Messaging Host

### Protokol Komunikasi
- Subcommand desktop CLI: `anchoa native-host`.
- Format framed stdio: 4-byte native-endian prefix penanda panjang pesan + payload JSON UTF-8 (maksimal 64 KiB).
- Nama host: `io.github.syharipf.anchoa.downloads`.

### Durable Pending Handoff
Untuk mencegah balapan (*race condition*) kehilangan unduhan saat browser membatalkan proses lokalnya:
1. **Prepare**: Ekstensi mengirim pesan `action: "prepare"`, `requestId`, `url`, `filename`, `referrer`. Desktop menyimpan ke tabel `native_handoffs` dengan status `pending` dan mengembalikan ACK `accepted: true, downloadId`.
2. **ACK & Cancel**: Setelah ekstensi menerima ACK sukses, ekstensi membatalkan unduhan di API browser (`chrome.downloads.cancel`).
3. **Commit**: Ekstensi mengirim `action: "commit"`, `requestId`. Desktop mengubah status `native_handoffs` menjadi `committed`, menambahkan baris ke tabel `items` dan `downloads` dengan status `queued`, serta mengaktifkan antarmuka pengguna.
4. **Keamanan**: Hanya tautan HTTP(S) GET publik yang dialihkan. Sesi cookie privat, metode `POST`, tautan `blob:`, dan `data:` tetap ditangani oleh browser pengguna.
