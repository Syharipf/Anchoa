# Anchoa — Jurnal v2

Tanggal: 2026-10-03
Status: user memilih keempat paket (Dasar, Menulis, Refleksi, Data) dan menyetujui ringkasan desain di chat pada 2026-10-03. Keputusan detail di §2 diambil Claude dan bisa diubah. Spec dasar Jurnal: `2026-10-01-anchoa-fase4-jurnal-design.md` (N1–N12 tetap berlaku kecuali disebut di sini).

## 1. Ringkasan

Update menu pertama dalam seri "poles per menu". Empat PR, masing-masing dikerjakan di sesi Claude Code terpisah:

| PR | Isi |
|---|---|
| J-1 Dasar (#140) | Hapus entri + Urungkan, sematkan entri, filter tag/suasana hati |
| J-2 Menulis (#141) | Dikte suara, template entri, pengingat menulis harian |
| J-3 Refleksi (#142) | Kalender bulanan + streak, "Hari ini, setahun lalu", ringkasan mingguan oleh asisten lokal |
| J-4 Data (#143) | Ekspor Markdown, pencarian FTS5, tautan `[[...]]` ke Catatan dan tugas |

Rilis setelah J-4: "Anchoa v0.19.0 — Jurnal lebih lengkap" (nomor menyesuaikan kalau sync v0.18.0 belum rilis).

## 2. Keputusan

| Kode | Keputusan | Alasan |
|---|---|---|
| V1 | Hapus = soft delete (`items.deleted_at`, `updated_at`). Toast "Entri dihapus" dengan tombol Urungkan selama 6 detik memanggil `restore_entry`. Tidak ada halaman Sampah. | Aturan soft delete proyek. Halaman Sampah lebih cocok dibuat sekali untuk semua modul. |
| V2 | Menghapus entri tidak menghapus tugas hasil "Jadikan tugas" dan tidak membatalkan centang habit `auto_journal`. | Tugas dan habit sudah jadi item sendiri. |
| V3 | `journal_entries.pinned INTEGER NOT NULL DEFAULT 0` (migrasi baru). Entri tersemat tampil di grup "Disematkan" paling atas dan tidak diulang di grup waktu. Kolom ikut daftar kolom record sync. | Satu kolom cukup; sync tetap membawa semua data. |
| V4 | Filter di `journal_list`: `tag` (satu tag) dan `mood` (1–5), dihitung di Rust, digabung dengan `query` dan `kind`. Chip filter aktif tampil di atas daftar dengan tombol ×. Klik tag di editor menerapkan filter tag. | Satu jalur query; frontend tidak menyaring. |
| V5 | Dikte memakai `voice_record_start`/`voice_record_stop` yang sudah ada. Teks disisipkan di posisi kursor isi entri (atau di akhir kalau editor tidak fokus). Model whisper belum terpasang → pesan dengan tautan ke Pengaturan › Suara. | Memakai ulang Fase 5. |
| V6 | Empat template bawaan di frontend (`view.ts`), dipilih dari menu "Entri baru ▾": Refleksi harian, 3 hal yang disyukuri, Review mingguan, Curhat terarah. Template mengisi jenis, judul, dan kerangka isi. Tanpa template buatan user. | YAGNI; pola sama dengan pemantik (N9). |
| V7 | `NotifyPrefs` mendapat `journal: bool` (bawaan mati) dan `journalAt: "HH:MM"` (bawaan 20:00). Notifikasi "Belum menulis jurnal hari ini" muncul sekali per hari lokal setelah jam itu, hanya kalau belum ada entri yang tidak terhapus hari itu. Diatur di Pengaturan › Notifikasi. Penjadwal memakai mekanisme pengingat habit. | Tidak mengganggu kalau sudah menulis. |
| V8 | `journal_calendar(month)` mengembalikan per hari lokal: jumlah entri dan rata-rata suasana hati, plus streak saat ini dan terpanjang. Streak = hari berturut-turut dengan minimal satu entri, berakhir hari ini atau kemarin. Dihitung di Rust. | Batas hari di Rust. |
| V9 | Kalender di kolom kanan, di atas Suasana 30 hari. Titik per hari berwarna suasana hati (token tema), abu-abu kalau tanpa suasana hati. Klik tanggal memfilter daftar ke hari itu (`date` di `journal_list`), tampil sebagai chip filter. | Satu cara filter (V4). |
| V10 | "Hari ini, setahun lalu": `journal_side` menambah `memories`: entri dari tanggal yang sama setahun dan sebulan lalu (29 Feb → 28 Feb; tanggal 31 → hari terakhir bulan itu). Kartu hanya tampil kalau ada isinya. | Dihitung di Rust, tanpa layar kosong. |
| V11 | "Ringkas minggu ini" adalah tombol, bukan otomatis. Asisten lokal dengan peran `recap` membaca entri 7 hari terakhir (judul, isi dipotong 2.000 karakter per entri, suasana hati, tag) dan menulis ringkasan tema dan suasana hati. Hasil disimpan sebagai entri Catatan baru berjudul "Ringkasan minggu <tgl awal>–<tgl akhir>" bertag `ringkasan`. Ollama tidak jalan → error jelas, tidak ada entri dibuat. Teks privasi di kolom kanan diperbarui. | User yang memutuskan kapan data dibaca; data tetap di perangkat. |
| V12 | Ekspor: "Ekspor entri ini" dan "Ekspor semua" ke folder yang dipilih lewat dialog. Satu file per entri `YYYY-MM-DD-<slug>.md` dengan front-matter YAML (`jenis`, `suasana`, `tag`, `dibuat`). Tidak pernah menimpa file: nama bentrok diberi akhiran `-2`, `-3`, … Entri terhapus tidak diekspor. | Data milik user, aman diulang. |
| V13 | Pencarian Jurnal pindah ke `items_fts` (sudah mencakup semua item, termasuk entri). Input user dipecah jadi token yang dikutip dengan awalan (`"kata"*`), jadi karakter FTS tidak bisa menyuntik sintaks. Ini mengganti N5. | Indeks sudah ada sejak Catatan. |
| V14 | Tautan `[[Judul]]` di isi entri memakai `links::parse`/`links::refresh` milik Catatan, ke halaman Catatan dan tugas. Mengetik `[[` membuka autocomplete. Di bawah editor ada daftar "Tautan" yang bisa diklik; entri juga muncul di backlink halaman tujuan. Judul yang tidak ditemukan tampil redup. | Satu parser untuk seluruh app. |
| V15 | Setiap PR ditutup dengan E2E Xvfb untuk fiturnya (`check_journal_*` di `scripts/e2e-smoke.sh`) dan cek DB di disk. | Aturan proyek. |

## 3. Data dan command

Migrasi baru (nomor berikutnya setelah yang ada di `main` saat J-1 dibuat):

```sql
ALTER TABLE journal_entries ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
```

Command baru atau berubah (semua `Result<T, AppError>`, lewat `src/api.ts`):

| Command | PR | Catatan |
|---|---|---|
| `delete_entry(id)`, `restore_entry(id)` | J-1 | Hanya untuk `type = 'note'`. `restore_entry` pada entri yang tidak terhapus → tanpa efek. |
| `update_entry` patch `pinned` | J-1 | |
| `journal_list` + `tag`, `mood`, `date` | J-1, J-3 | Grup "Disematkan" pertama. |
| `get/set_notify_prefs` + `journal`, `journalAt` | J-2 | Validasi `HH:MM`. |
| `journal_calendar(month)` | J-3 | `month = "YYYY-MM"`. |
| `journal_side` + `memories` | J-3 | |
| `journal_weekly_summary()` | J-3 | Mengembalikan `Entry` baru. |
| `journal_export(dir, ids?)` | J-4 | Mengembalikan jumlah file dan path folder. |
| `journal_list` pencarian FTS | J-4 | |
| `link_suggest(prefix)` | J-4 | Pakai yang sudah ada di Catatan kalau ada. |

## 4. Asisten

Tool asisten `add_journal_entry` tetap. Asisten tidak mendapat tool hapus entri (tindakan merusak tetap di tangan user).

## 5. Di luar cakupan

Halaman Sampah lintas modul, template buatan user, lampiran foto, kunci per entri, ringkasan otomatis terjadwal.
