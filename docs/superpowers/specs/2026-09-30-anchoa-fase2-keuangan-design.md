# Anchoa — Fase 2: Keuangan

Tanggal: 2026-09-30
Status: **DRAF**, disusun tanpa sesi tanya-jawab. Setiap keputusan yang belum kamu setujui ditandai **[ASUMSI Ax]**. Pertanyaan yang perlu dijawab sebelum implementasi ada di bagian 11.

> **Perlu disusun ulang (2026-09-30).** Redesign D (`docs/superpowers/specs/2026-09-30-anchoa-ui-d-design.md`) mengubah dasar dokumen ini:
> - migrasi `002` dan `003` sekarang dipakai `002_item_completion.sql` dan `003_contributions.sql`, jadi migrasi keuangan menjadi `004_finance.sql` (beserta test upgrade dan `user_version` di E2E);
> - struktur `Dashboard` di backend berubah (`today: DayTask[]`, `inboxCount`);
> - widget, sidebar, dan gaya UI sekarang mengikuti desain D (nav rail, kartu KPI "Saldo total" dan "Pengeluaran" yang menunggu modul ini).
>
> Keputusan A1–A10 tetap berlaku sebagai draf. Blok kode UI di rencana perlu dibuat ulang sebelum Fase 2 diimplementasikan.

## 1. Ringkasan

Fase 2 menambah modul keuangan pribadi di atas fondasi Fase 1:
- akun (kas, bank, e-wallet, kartu kredit) dengan saldo;
- transaksi pemasukan dan pengeluaran;
- transfer antar akun;
- ringkasan bulanan per kategori.

Widget "Keuangan bulan ini" di dashboard, yang di Fase 1 masih kosong, menjadi aktif.

Semua data keuangan mengikuti prinsip Fase 1: setiap akun dan transaksi adalah satu baris di `items`, sedangkan field khususnya ada di tabel tambahan dengan `item_id` yang sama. Dengan begitu, integrasi di Fase 3 (misalnya transaksi yang di-link ke project) langsung bisa jalan tanpa mengubah model.

## 2. Keputusan dan asumsi

| Kode | Keputusan | Alasan |
|---|---|---|
| A1 | Hanya satu mata uang, IDR. Kolom `currency` tetap disimpan, tapi UI dan ringkasan menganggap semuanya IDR. | Konversi kurs butuh sumber data kurs dan aturan pembulatan. Belum ada kebutuhan nyata. |
| A2 | Jumlah uang disimpan sebagai integer dalam rupiah penuh (1 = Rp1), tanpa sen. | Sen tidak dipakai dalam transaksi sehari-hari di Indonesia. Tetap integer, tidak pernah float. |
| A3 | Jenis akun: `cash` (Tunai), `bank`, `ewallet` (E-wallet), `credit` (Kartu kredit). Jenis hanya untuk label dan ikon, tanpa logika khusus. | Kartu kredit cukup diwakili saldo negatif (= utang). Limit dan tanggal tagihan belum perlu. |
| A4 | Saldo akun = saldo awal + jumlah semua transaksi yang belum dihapus di akun itu, termasuk transaksi bertanggal masa depan. | Mirip buku kas. Pemisahan "saldo hari ini" dan "saldo terjadwal" menunggu fitur tagihan berulang. |
| A5 | Transfer disimpan sebagai **dua transaksi** (keluar dari akun asal, masuk ke akun tujuan) dengan `transfer_id` yang sama. Transfer tidak dihitung sebagai pemasukan atau pengeluaran. | Saldo tiap akun tetap cukup dijumlahkan per akun. Ubah dan hapus selalu mengenai kedua baris sekaligus. |
| A6 | Kategori berupa teks bebas dan boleh kosong. Formulir menampilkan saran dari daftar bawaan ditambah kategori yang pernah dipakai. | Tidak perlu tabel dan halaman kelola kategori. Kalau nanti dibutuhkan, teks yang ada bisa dimigrasi. |
| A7 | Tanggal transaksi hanya tanggal, disimpan sebagai 00:00 waktu lokal, sama seperti `due_at` di Fase 1. Urutan di tanggal yang sama mengikuti waktu dibuat. | Aplikasi keuangan pribadi jarang butuh jam. |
| A8 | Akun hanya bisa dihapus (soft delete) kalau tidak punya transaksi hidup. Belum ada fitur arsip. | Mencegah transaksi yatim dan saldo yang tiba-tiba hilang. |
| A9 | Inbox dan "Item terbaru" hanya menampilkan item bertipe `note`. Akun dan transaksi punya halaman sendiri. | Tanpa filter ini, setiap transaksi akan membanjiri Inbox, dan membukanya di halaman item generik membingungkan (jumlah uang tidak bisa diedit di sana). |
| A10 | Tagihan berulang, anggaran per kategori, impor CSV bank, dan grafik ditunda ke fase berikutnya. | Menjaga Fase 2 tetap kecil dan bisa langsung dipakai. |

## 3. Scope Fase 2

**Masuk:**
- Migrasi `002_finance.sql`: tabel `accounts` dan `transactions`.
- Kelola akun: tambah, ubah nama/jenis/saldo awal, hapus kalau belum ada transaksi.
- Transaksi: tambah, ubah, hapus. Jenisnya pengeluaran, pemasukan, atau transfer.
- Halaman Keuangan dengan pemilih bulan dan tiga tab: Transaksi, Akun, Ringkasan.
- Widget dashboard "Keuangan bulan ini" aktif.
- Inbox dan "Item terbaru" difilter ke `note` (A9).
- Test Rust, test frontend untuk format dan parsing uang, dan E2E.

**Tidak masuk:** multi mata uang, tagihan berulang, anggaran, impor/ekspor CSV, grafik, lampiran struk, link transaksi ke project (Fase 3), dan quick capture transaksi dari dashboard.

## 4. Model data

### Migrasi `002_finance.sql`

```sql
CREATE TABLE accounts (
  item_id         TEXT PRIMARY KEY REFERENCES items(id),
  kind            TEXT NOT NULL,              -- cash | bank | ewallet | credit
  currency        TEXT NOT NULL DEFAULT 'IDR',
  opening_balance INTEGER NOT NULL DEFAULT 0  -- rupiah
);

CREATE TABLE transactions (
  item_id     TEXT PRIMARY KEY REFERENCES items(id),
  account_id  TEXT NOT NULL REFERENCES items(id),
  amount      INTEGER NOT NULL,   -- rupiah; negatif = uang keluar dari akun
  category    TEXT,               -- NULL = tanpa kategori; selalu NULL untuk transfer
  occurred_at INTEGER NOT NULL,   -- 00:00 lokal pada tanggal transaksi, epoch ms UTC
  transfer_id TEXT                -- sama di kedua baris transfer; NULL untuk transaksi biasa
);

CREATE INDEX transactions_account  ON transactions(account_id);
CREATE INDEX transactions_occurred ON transactions(occurred_at);
CREATE INDEX transactions_transfer ON transactions(transfer_id) WHERE transfer_id IS NOT NULL;
```

### Pemetaan ke `items`

| | `items.type` | `items.title` | `items.body` |
|---|---|---|---|
| Akun | `account` | nama akun | tidak dipakai |
| Transaksi | `transaction` | keterangan ("Makan siang") | catatan opsional |

- `parent_id` untuk akun dan transaksi selalu NULL. Inbox tetap bersih karena A9.
- Hapus akun atau transaksi berarti soft delete lewat `items.deleted_at`. Semua query keuangan melakukan join ke `items` dan memfilter `deleted_at IS NULL`.

### Aturan hitungan

- **Saldo akun** = `opening_balance` + `SUM(amount)` transaksi hidup di akun itu (A4).
- **Saldo total** = jumlah saldo semua akun hidup.
- **Pemasukan bulan M** = `SUM(amount)` untuk transaksi hidup dengan `amount > 0`, `transfer_id IS NULL`, dan `occurred_at` di dalam bulan M (batas bulan dihitung dalam waktu lokal).
- **Pengeluaran bulan M** = `-SUM(amount)` untuk transaksi dengan `amount < 0`, dengan syarat yang sama.
- **Pengeluaran per kategori** memakai syarat yang sama dengan pengeluaran, dikelompokkan per `category`. Nilai NULL tampil sebagai "Tanpa kategori". Hasilnya diurutkan dari yang terbesar.

## 5. Command

Semua mengembalikan `Result<T, AppError>`. Nama field JSON memakai camelCase. Jumlah uang selalu berupa integer rupiah.

| Command | Masukan | Keluaran | Catatan |
|---|---|---|---|
| `list_accounts` | - | `AccountView[]` | Diurutkan menurut nama. |
| `create_account` | `{ name, kind, openingBalance }` | `AccountView` | `name` di-trim dan tidak boleh kosong. `kind` harus salah satu dari empat nilai A3. |
| `update_account` | `id`, `{ name?, kind?, openingBalance? }` | `AccountView` | |
| `delete_account` | `id` | `()` | Ditolak dengan `code: "account_in_use"` kalau masih ada transaksi hidup. |
| `list_transactions` | `{ month: "2026-09", accountId? }` | `TransactionView[]` | Diurutkan `occurredAt` terbaru dulu, lalu `createdAt` terbaru dulu. Tanpa filter akun, transfer hanya muncul sekali (baris keluarnya). Dengan filter akun, yang muncul baris milik akun itu. |
| `save_transaction` | `TransactionInput` | `TransactionView` | Membuat baru kalau `id` kosong, mengubah kalau terisi. |
| `save_transfer` | `TransferInput` | `TransactionView` (baris keluar) | Membuat baru kalau `transferId` kosong, mengubah kedua baris kalau terisi. |
| `delete_transaction` | `id` | `()` | Kalau transaksinya bagian dari transfer, kedua baris ikut terhapus. |
| `month_summary` | `{ month }` | `{ income, expense, byCategory: [{ category, amount }] }` | |
| `finance_categories` | - | `{ expense: string[], income: string[] }` | Daftar bawaan ditambah kategori yang pernah dipakai, tanpa duplikat. |

`get_dashboard` mendapat field baru: `finance: { hasAccounts, balance, income, expense }` untuk bulan berjalan.

```
AccountView     { id, name, kind, currency, openingBalance, balance }
TransactionView { id, title, body, amount, category, accountId, accountName,
                  occurredAt, createdAt, transferId, counterAccountId, counterAccountName }
TransactionInput { id?, kind: "expense" | "income", amount (> 0), accountId,
                   occurredAt, category?, title, body? }
TransferInput    { transferId?, fromAccountId, toAccountId, amount (> 0),
                   occurredAt, title? }   // judul default: "Transfer"
```

- **`amount` di `TransactionInput` selalu positif.** Tanda disimpan menurut `kind`: pengeluaran menjadi negatif, pemasukan positif.
- **Validasi:**
  - `amount > 0`;
  - akun ada dan belum dihapus;
  - akun asal transfer ≠ akun tujuan;
  - judul transaksi biasa boleh kosong dan tampil sebagai "Tanpa keterangan".

  Semua kegagalan validasi mengembalikan `code: "invalid"` dengan pesan dalam Bahasa Indonesia.
- **Parameter `month`** berformat `YYYY-MM`. Batas bulannya dihitung di Rust dengan zona waktu lokal, sama seperti batas hari di Fase 1.

### Daftar kategori bawaan (A6)

- Pengeluaran: Makan & minum, Transportasi, Belanja, Tagihan, Kesehatan, Hiburan, Pendidikan, Lainnya.
- Pemasukan: Gaji, Bonus, Hadiah, Lainnya.

## 6. UI

### Sidebar

Dashboard, Inbox, **Keuangan**, lalu Pengaturan di bawah.

### Halaman Keuangan

```
┌ Keuangan ─────────────────────── ‹  September 2026  ›   [+ Transaksi] ┐
│ [Transaksi]  Akun   Ringkasan                  Akun: [Semua akun ▾]   │
│                                                                        │
│ Selasa, 29 September                                                   │
│   Makan siang          Makan & minum · BCA            − Rp 25.000      │
│   Transfer             BCA → GoPay                       Rp 100.000    │
│ Senin, 28 September                                                    │
│   Gaji September       Gaji · BCA                     + Rp 8.000.000   │
└────────────────────────────────────────────────────────────────────────┘
```

- **Pemilih bulan** berlaku untuk tab Transaksi dan Ringkasan. Bulan awalnya adalah bulan berjalan.
- **Tab Transaksi:**
  - daftar dikelompokkan per tanggal;
  - pengeluaran merah dengan tanda "−", pemasukan hijau dengan tanda "+", transfer netral dengan "A → B";
  - filter akun di kanan atas;
  - klik baris untuk membuka formulir ubah.
- **Tab Akun:**
  - daftar akun berisi nama, jenis, dan saldo (merah kalau negatif), dengan saldo total di bawahnya;
  - tombol "+ Akun";
  - klik akun untuk membuka formulir ubah, yang juga berisi tombol hapus. Kalau akun masih punya transaksi, muncul pesan "Akun masih punya transaksi".
- **Tab Ringkasan:**
  - Pemasukan, Pengeluaran, dan Selisih bulan terpilih;
  - daftar pengeluaran per kategori dengan batang CSS proporsional, tanpa library grafik.
- **Kalau belum ada akun:** tab Transaksi dan tombol "+ Transaksi" mengarahkan ke "Buat akun dulu" di tab Akun.

### Formulir transaksi

Formulir tampil sebagai panel di atas halaman, bukan halaman terpisah.

- **Jenis:** [Pengeluaran | Pemasukan | Transfer], default Pengeluaran.
- **Jumlah:** menerima "25000", "25.000", atau "Rp 25.000". Nilai yang tampil diformat dengan pemisah titik saat fokus pindah. Angka desimal ditolak.
- **Tanggal:** default hari ini.
- **Akun:** pengeluaran dan pemasukan memakai satu pilihan akun (default akun terakhir dipakai), transfer memakai pilihan "Dari" dan "Ke".
- **Kategori:** input dengan saran (`<datalist>`), tidak tampil untuk transfer.
- **Keterangan** dan **Catatan** (opsional).
- **Tombol:** Simpan, Batal, dan Hapus (hanya saat mengubah transaksi).
- **Keyboard:** Enter menyimpan, Esc menutup panel.

### Dashboard

Widget "Keuangan bulan ini" menampilkan:
- Saldo total;
- Pemasukan (hijau) dan Pengeluaran (merah) bulan berjalan;
- tautan "Buka Keuangan".

Kalau belum ada akun: "Belum ada akun", dengan tombol "Buat akun" yang membuka tab Akun.

### Format uang

`Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 })`, contohnya `Rp 25.000`.

## 7. Error handling

- **Mengikuti aturan Fase 1:** command tidak boleh panic, dan error tampil sebagai toast.
- **Panel formulir:** kalau simpan gagal, panel tetap terbuka dengan isi yang sudah diketik.
- **Transfer diubah dalam satu transaksi SQLite**, jadi tidak mungkin hanya satu dari dua barisnya yang berubah.
- **Perubahan saldo awal akun hanya mengubah saldo.** Transaksi tidak disentuh.

## 8. Testing

- **Rust** (SQLite in-memory):
  - migrasi 002 berjalan di atas DB versi 1;
  - saldo = saldo awal + transaksi, dan transaksi yang dihapus tidak ikut dihitung;
  - transfer membuat dua baris dengan tanda berlawanan, ubah dan hapus mengenai keduanya, dan transfer tidak masuk pemasukan atau pengeluaran;
  - batas bulan lokal: transaksi 1 Oktober 00:00 WIB tidak masuk September;
  - ringkasan per kategori, termasuk "Tanpa kategori";
  - validasi: jumlah ≤ 0, akun sudah dihapus, transfer ke akun yang sama;
  - akun yang masih punya transaksi tidak bisa dihapus;
  - Inbox dan `recent` hanya berisi `note`.
- **Frontend** (`bun test`): `formatRupiah`, `parseRupiah` ("25.000", "Rp 25.000", "25000", menolak "25,5" dan "abc"), serta label bulan "September 2026".
- **E2E:**
  1. buat akun "BCA" dengan saldo awal 1.000.000;
  2. tambah pengeluaran 25.000;
  3. cek DB;
  4. cek widget dashboard: saldo Rp 975.000, pengeluaran Rp 25.000;
  5. screenshot tab Transaksi, Akun, dan Ringkasan.

## 9. Kriteria selesai Fase 2

1. Akun bisa dibuat, diubah, dan dihapus sesuai A8.
2. Pengeluaran, pemasukan, dan transfer bisa dibuat, diubah, dan dihapus, dan saldo setiap akun selalu benar.
3. Ringkasan bulanan dan widget dashboard menampilkan angka yang benar untuk bulan lokal.
4. Inbox dan Item terbaru tidak berisi akun atau transaksi.
5. Semua test lulus, termasuk di CI, dan quality gate SonarCloud hijau.
6. DB Fase 1 yang sudah berisi data ter-upgrade ke versi 2 tanpa kehilangan data, dan backup `.bak-v1` terbentuk.

## 10. Rencana PR

Rinciannya ada di `docs/superpowers/plans/2026-09-30-anchoa-fase2-keuangan.md`.

| PR | Isi |
|---|---|
| F2-1 | Migrasi 002, backend akun (CRUD + saldo), filter Inbox dan Item terbaru ke `note` |
| F2-2 | Backend transaksi, transfer, ringkasan bulanan, kategori, `finance` di dashboard |
| F2-3 | Halaman Keuangan, format uang, tab Transaksi dan Akun, formulir, E2E keuangan |
| F2-4 | Tab Ringkasan, widget dashboard aktif, E2E ringkasan dan dashboard |

## 11. Pertanyaan terbuka

Jawab langsung, misalnya "Q1 ya, Q2 tidak". Draf ini memakai jawaban di kolom "Draf".

| # | Pertanyaan | Draf |
|---|---|---|
| Q1 | Cukup satu mata uang (IDR) di Fase 2? | Ya (A1) |
| Q2 | Transaksi bertanggal masa depan ikut dihitung di saldo sekarang? | Ya (A4) |
| Q3 | Kategori teks bebas dengan saran, atau daftar tetap yang bisa dikelola? | Teks bebas (A6) |
| Q4 | Akun dan transaksi muncul di Inbox atau Item terbaru? | Tidak (A9) |
| Q5 | Tagihan berulang dan anggaran masuk Fase 2? | Tidak, ditunda (A10) |
| Q6 | Akun yang masih punya transaksi: tidak bisa dihapus, atau bisa diarsipkan? | Tidak bisa dihapus, tanpa arsip (A8) |
| Q7 | Kartu kredit butuh logika khusus (limit, tanggal tagihan)? | Tidak (A3) |
| Q8 | Perlu quick capture transaksi dari dashboard (misalnya ketik "-25rb makan")? | Tidak di Fase 2 |
