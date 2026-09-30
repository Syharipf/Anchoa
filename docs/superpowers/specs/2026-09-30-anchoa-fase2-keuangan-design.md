# Anchoa — Fase 2: Keuangan

Tanggal: 2026-09-30
Status: disetujui lewat tanya-jawab 2026-09-30. Menggantikan draf 2026-09-29 (PR #13). Ini versi awal: tampilan dan detail boleh diubah setelah dipakai.

## 1. Ringkasan

Fase 2 membangun halaman Keuangan sesuai artboard `docs/design/artboards/Keuangan.dc.html`:
- beberapa akun (kas, bank, e-wallet, kartu kredit), masing-masing dengan saldo;
- transaksi pemasukan, pengeluaran, dan transfer antar akun;
- 4 kartu bulanan, grafik arus kas 6 bulan, dan porsi saldo per akun;
- tagihan sekali atau bulanan dengan tombol "Tandai lunas";
- satu batas pengeluaran bulanan sebagai peringatan.

Kartu Keuangan di dashboard, panel notifikasi, dan command palette ikut memakai data ini.

Setiap akun, transaksi, tagihan, dan batas adalah satu baris di `items` dengan tabel ekstensi ber-`item_id` yang sama (spec Fase 1 bagian 5). Link transaksi ke project di Fase 3 dan Jadwal yang membaca tagihan tidak butuh model baru.

## 2. Keputusan

| Kode | Keputusan | Alasan |
|---|---|---|
| K1 | Hanya IDR. Kolom `currency` disimpan, tapi UI dan hitungan menganggap semuanya IDR. | Belum ada kebutuhan kurs. |
| K2 | Jumlah uang berupa integer rupiah penuh (1 = Rp1), tanpa sen. | Sen tidak dipakai sehari-hari. Tetap integer, tidak pernah float. |
| K3 | Jumlah akun tidak dibatasi. Jenis akun: `cash` (Tunai), `bank`, `ewallet` (E-wallet), `credit` (Kartu kredit). Jenis hanya untuk label dan ikon. | Kartu kredit cukup diwakili saldo negatif (= utang). Limit dan tanggal cetak tagihan belum perlu. |
| K4 | Saldo dihitung sampai hari ini. Transaksi bertanggal masa depan tampil di daftar dengan label "terjadwal", tapi belum masuk saldo. | Artboard menulis saldo "per hari ini". |
| K5 | Transfer disimpan sebagai dua transaksi (keluar dan masuk) dengan `transfer_id` yang sama, dan tidak dihitung sebagai pemasukan atau pengeluaran. | Saldo tetap cukup dijumlahkan per akun. Ubah dan hapus selalu mengenai kedua baris. |
| K6 | Kategori berupa teks bebas dan boleh kosong. Formulir menyarankan daftar bawaan ditambah kategori yang pernah dipakai. | Tidak perlu tabel dan halaman kelola kategori. |
| K7 | Tanggal transaksi dan jatuh tempo hanya tanggal, disimpan sebagai 00:00 waktu lokal, sama seperti `due_at` di Fase 1. | Keuangan pribadi jarang butuh jam. |
| K8 | Akun yang masih dipakai transaksi atau tagihan hidup tidak bisa dihapus. Belum ada fitur arsip. | Mencegah transaksi yatim dan saldo yang tiba-tiba hilang. |
| K9 | Akun, transaksi, tagihan, dan batas tidak muncul di Inbox, Catatan terbaru, Hari ini, 7 hari ke depan, atau Terbaru di palette. Semua query itu difilter ke `type = 'note'`. | Modul keuangan punya halamannya sendiri. |
| K10 | Tagihan berulang sekali (`once`) atau bulanan (`monthly`). "Tandai lunas" langsung mencatat pengeluaran dengan jumlah tersimpan, tanpa formulir. | Satu klik, seperti di artboard. Kalau jumlah bulan ini berbeda (misalnya listrik), transaksinya diubah lewat toast "Ubah". |
| K11 | Ada satu batas pengeluaran total per bulan, berlaku untuk semua bulan. Batas hanya memberi peringatan dan tidak menolak transaksi. | Aplikasi tidak bisa menahan uang keluar di dunia nyata, dan menolak catatan membuat data tidak jujur. Kolom `category` sudah disiapkan untuk batas per kategori nanti. |
| K12 | Tidak ada parsing teks seperti "-25rb makan". Palette mendapat aksi "Catat transaksi" yang membuka formulir. | Pencatatan cepat lewat bahasa alami menunggu asisten di Fase 5. |

**Tidak masuk Fase 2:** multi mata uang, batas per kategori, impor dan ekspor CSV, lampiran struk, filter transaksi per akun, pengulangan mingguan atau tahunan, "Catat lewat suara" (tombolnya nonaktif sampai Fase 5), dan link transaksi ke project (Fase 3).

## 3. Model data

### Migrasi `004_finance.sql`

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
  amount      INTEGER NOT NULL,          -- rupiah; negatif = uang keluar dari akun
  category    TEXT,                      -- NULL = tanpa kategori; selalu NULL untuk transfer
  occurred_at INTEGER NOT NULL,          -- 00:00 lokal pada tanggal transaksi, epoch ms UTC
  transfer_id TEXT,                      -- sama di kedua baris transfer
  bill_id     TEXT REFERENCES items(id)  -- terisi kalau dibuat oleh "Tandai lunas"
);

CREATE TABLE bills (
  item_id    TEXT PRIMARY KEY REFERENCES items(id),
  account_id TEXT NOT NULL REFERENCES items(id),
  amount     INTEGER NOT NULL,  -- rupiah, positif
  repeat     TEXT NOT NULL,     -- once | monthly
  due_day    INTEGER NOT NULL   -- tanggal jatuh tempo asli, 1–31
);

CREATE TABLE budgets (
  item_id  TEXT PRIMARY KEY REFERENCES items(id),
  category TEXT,             -- NULL = batas total (satu-satunya jenis di Fase 2)
  amount   INTEGER NOT NULL  -- rupiah per bulan, positif
);

CREATE INDEX transactions_account  ON transactions(account_id);
CREATE INDEX transactions_occurred ON transactions(occurred_at);
CREATE INDEX transactions_transfer ON transactions(transfer_id) WHERE transfer_id IS NOT NULL;
CREATE INDEX transactions_bill     ON transactions(bill_id)     WHERE bill_id IS NOT NULL;
```

`user_version` naik dari 3 ke 4. Upgrade membuat `anchoa.db.bak-v3` lewat `db::migrate` yang sudah ada.

### Pemetaan ke `items`

| | `type` | `title` | `body` | `due_at` | `completed_at` |
|---|---|---|---|---|---|
| Akun | `account` | nama akun | - | - | - |
| Transaksi | `transaction` | keterangan | catatan opsional | - | - |
| Tagihan | `bill` | nama tagihan | - | jatuh tempo berikutnya | terisi saat tagihan sekali sudah lunas |
| Batas | `budget` | - | - | - | - |

- `parent_id` selalu NULL.
- Hapus berarti soft delete lewat `items.deleted_at`. Semua query keuangan melakukan join ke `items` dan memfilter `deleted_at IS NULL`.
- Jatuh tempo tagihan disimpan di `items.due_at`, supaya Jadwal di Fase 3 bisa membacanya langsung. Karena itu semua query lama yang membaca `due_at` perlu filter `type = 'note'` (K9).
- Hanya boleh ada satu batas total yang hidup. `set_budget` mengubah baris yang ada atau membuatnya, dan `null` menghapusnya (soft delete).

### Aturan hitung

Semua batas hari dan bulan dihitung di Rust dengan waktu lokal, sama seperti batas hari di Fase 1.

- **Saldo akun** = `opening_balance` + `SUM(amount)` transaksi hidup di akun itu dengan `occurred_at` < awal hari besok (K4).
- **Saldo total** = jumlah saldo semua akun hidup.
- **Pemasukan bulan M** = `SUM(amount)` transaksi hidup dengan `amount > 0`, `transfer_id IS NULL`, dan `occurred_at` di dalam bulan M.
- **Pengeluaran bulan M** = `-SUM(amount)` transaksi hidup dengan `amount < 0` dan syarat yang sama.
- **Arus bersih** = pemasukan − pengeluaran.
- **Grafik** menampilkan 6 bulan yang berakhir di bulan berjalan. Kalau bulan terpilih lebih lama dari itu, grafik berakhir di bulan terpilih. Pemilih bulan tidak bisa maju melewati bulan berjalan.
- **Porsi saldo** = saldo akun ÷ jumlah saldo akun yang positif, dibulatkan ke persen terdekat. Akun bersaldo nol atau negatif tidak mendapat persen dan tidak ikut di bar porsi.
- **Tingkat batas** = pengeluaran bulan ÷ batas: `ok` di bawah 80%, `warn` dari 80% sampai 100%, dan `over` di atas 100%.

### Tagihan

- **Status** dihitung di Rust setiap kali tagihan dibaca:
  - `paidToday`: ada transaksi hidup dengan `bill_id` tagihan ini yang dibuat hari ini;
  - `done`: tagihan sekali dengan `completed_at` sebelum hari ini. Tidak dikirim ke UI;
  - `overdue`: `due_at` sebelum hari ini, dengan `daysLate` = jumlah hari lokal sejak `due_at`;
  - `dueToday`: `due_at` hari ini;
  - `upcoming`: selain itu.
- **"Tandai lunas"** berjalan dalam satu transaksi SQLite:
  1. membuat pengeluaran di akun tagihan: jumlah tersimpan, tanggal hari ini, kategori "Tagihan", judul = nama tagihan, dan `bill_id`;
  2. tagihan bulanan: `due_at` maju satu bulan ke tanggal `due_day`, dibatasi ke hari terakhir bulan itu (31 Jan → 28 Feb → 31 Mar);
  3. tagihan sekali: `completed_at` diisi.
- **Satu pelunasan = satu periode.** Tagihan yang terlambat dua bulan tetap `overdue` setelah satu kali "Tandai lunas".
- **Menghapus transaksi pelunasan tidak memundurkan jatuh tempo.** Jatuh tempo bisa diubah manual di formulir tagihan. Tandai di kode dengan komentar `ponytail:`.
- **Menyimpan tagihan** mengisi `due_day` dari tanggal `dueAt`.

## 4. Command

Semua command mengembalikan `Result<T, AppError>`. Nama field JSON memakai camelCase, dan jumlah uang selalu integer rupiah. `id` kosong di `save_*` berarti membuat baru.

| Command | Masukan | Keluaran | Catatan |
|---|---|---|---|
| `list_accounts` | - | `AccountView[]` | Diurutkan menurut nama. |
| `save_account` | `{ id?, name, kind, openingBalance }` | `AccountView` | |
| `delete_account` | `id` | `()` | Ditolak dengan `account_in_use` (K8). |
| `list_transactions` | `{ until, flow, offset }` | `{ items: TransactionView[], more }` | Lihat di bawah. |
| `save_transaction` | `TransactionInput` | `TransactionView` | |
| `save_transfer` | `TransferInput` | `TransactionView` | Mengembalikan baris keluar. |
| `delete_transaction` | `id` | `()` | Kalau bagian dari transfer, kedua baris ikut terhapus. |
| `finance_categories` | - | `{ expense: string[], income: string[] }` | Daftar bawaan ditambah kategori yang pernah dipakai, tanpa duplikat. |
| `finance_overview` | `{ month }` | `FinanceOverview` | Untuk header, kartu, dan grafik. |
| `list_bills` | - | `BillView[]` | Diurutkan menurut `dueAt`, tanpa yang `done`. |
| `save_bill` | `BillInput` | `BillView` | |
| `pay_bill` | `id` | `TransactionView` | Mengembalikan transaksi yang dibuat, untuk toast "Tercatat · Ubah". |
| `delete_bill` | `id` | `()` | Transaksi pelunasan lama tetap ada. |
| `set_budget` | `{ amount: number \| null }` | `()` | `null` menghapus batas. |

```
AccountView      { id, name, kind, currency, openingBalance, balance }
TransactionView  { id, title, body, amount, category, accountId, accountName,
                   occurredAt, createdAt, transferId, counterAccountId,
                   counterAccountName, billId, scheduled }
TransactionInput { id?, kind: "expense" | "income", amount (> 0), accountId,
                   occurredAt, category?, title, body? }
TransferInput    { transferId?, fromAccountId, toAccountId, amount (> 0),
                   occurredAt, title? }            // judul default: "Transfer"
FinanceOverview  { month, balance, accountCount, income, expense, net,
                   budget: { amount, level: "ok" | "warn" | "over" } | null,
                   chart: { month, income, expense }[6] }
BillView         { id, name, amount, accountId, accountName, repeat, dueAt,
                   status: "overdue" | "dueToday" | "upcoming" | "paidToday",
                   daysLate }
BillInput        { id?, name, amount (> 0), accountId, repeat: "once" | "monthly", dueAt }
```

- **`list_transactions`:**
  - `until` berformat `YYYY-MM`. Hasilnya transaksi dengan `occurred_at` sebelum akhir bulan itu;
  - `flow` bernilai `all`, `in`, atau `out`. Transfer hanya muncul di `all`, sekali saja (baris keluarnya, dengan `counterAccount*` terisi);
  - urutan: `occurredAt` terbaru dulu, lalu `createdAt` terbaru dulu. 50 baris per halaman; `more` bernilai benar kalau masih ada baris berikutnya;
  - `scheduled` bernilai benar untuk transaksi yang `occurred_at`-nya setelah hari ini.
- **`amount` di `TransactionInput` selalu positif.** Tanda disimpan menurut `kind`: pengeluaran negatif, pemasukan positif.
- **Parameter `month`** berformat `YYYY-MM`. Batas bulannya dihitung di Rust dengan zona waktu lokal.
- **`get_dashboard`** mendapat field `finance`:
  ```
  finance: { hasAccounts, balance, expense, budget: { amount, level } | null,
             dueBills: BillView[] }   // status overdue atau dueToday
  ```

### Validasi dan error

`AppError` mendapat dua varian baru:
- `Invalid(String)` dengan `code: "invalid"`, untuk semua kegagalan validasi. Pesannya dalam Bahasa Indonesia;
- `AccountInUse` dengan `code: "account_in_use"` dan pesan "Akun masih punya transaksi atau tagihan".

Aturan validasi:
- jumlah transaksi, transfer, tagihan, dan batas > 0;
- nama akun dan nama tagihan di-trim dan tidak boleh kosong;
- `kind` dan `repeat` harus salah satu nilai yang dikenal;
- akun yang dirujuk ada dan belum dihapus;
- akun asal transfer ≠ akun tujuan;
- judul transaksi biasa boleh kosong dan tampil sebagai "Tanpa keterangan".

### Kategori bawaan (K6)

- Pengeluaran: Makan & minum, Transportasi, Belanja, Tagihan, Kesehatan, Hiburan, Pendidikan, Lainnya.
- Pemasukan: Gaji, Bonus, Hadiah, Lainnya.

## 5. UI

Mengikuti `Keuangan.dc.html` dan `DESIGN.md` §2 "Keuangan", dengan warna dari `tokens.css`. Halaman Keuangan menggantikan halaman "menyusul", dan field `about` Keuangan dihapus dari `src/shell/nav.ts`.

### Halaman Keuangan

- **Header:**
  - judul "Keuangan";
  - pemilih bulan ‹ September 2026 ›, default bulan berjalan;
  - "Catat lewat suara", nonaktif dengan tooltip "Hadir di Fase 5";
  - "+ Transaksi".
- **4 kartu:**
  - Saldo total, dengan keterangan "n akun · per hari ini";
  - Pemasukan dan Pengeluaran bulan terpilih;
  - Arus bersih, coral kalau negatif.
  - Kalau ada batas, kartu Pengeluaran juga menampilkan "dari Rp y" dan bar: `--accent` untuk `ok`, `--cat-tagihan` untuk `warn`, dan `--danger` untuk `over`. Klik kartu untuk mengatur atau menghapus batas.
- **Kolom kiri:**
  - **Arus kas 6 bulan:** batang CSS masuk (`--accent`) dan keluar (`--danger`), tanpa library grafik. Satu tombol per bulan dengan `aria-pressed` dan `aria-label` "September 2026: masuk Rp x, keluar Rp y". Klik untuk memilih bulan.
  - **Transaksi terbaru:**
    - filter Semua, Masuk, Keluar, dan grup per bulan;
    - baris berisi tanggal, ikon kategori, judul, "kategori · akun" (transfer: "BCA → GoPay"), dan jumlah bertanda "+" atau "−";
    - pemasukan berwarna `--accent`, pengeluaran dan transfer netral;
    - transaksi terjadwal diberi label "terjadwal";
    - klik baris untuk membuka formulir ubah; tombol "Muat lagi" tampil kalau `more`;
    - kalau kosong: "Tidak ada transaksi untuk filter ini."
  - **Ikon kategori:** Transportasi = mobil, Makan & minum = makanan, Tagihan = tagihan, Belanja = tas, semua pemasukan = ikon pemasukan, selain itu ikon umum.
- **Kolom kanan:**
  - **Akun:** tautan "+ Tambah", bar porsi bertumpuk, lalu satu baris per akun berisi ikon jenis, nama, "n% saldo", dan saldo (coral kalau negatif). Klik baris untuk mengubah.
  - **Tagihan:** tautan "+ Tambah". "Lihat semua" di artboard tidak dipakai, karena bagian ini sudah menampilkan semua tagihan aktif. Setiap baris menurut status:
    - `overdue`: latar `--danger-row`, "Terlambat n hari · sejak 28 Sep", tombol "Tandai lunas";
    - `dueToday`: "Jatuh tempo hari ini", tombol "Tandai lunas";
    - `upcoming`: "Jatuh tempo 5 Okt" dan jumlahnya;
    - `paidToday`: "Lunas hari ini" dan "✓ Lunas".
    - Klik baris (di luar tombol) untuk mengubah. Sesudah "Tandai lunas", toast "Tercatat Rp x · Ubah" membuka formulir transaksi itu.
- **Keadaan kosong:**
  - Tanpa akun: bagian Akun menampilkan "Belum ada akun" dan tombol "Buat akun". "+ Transaksi" dan "+ Tambah" di Tagihan membuka formulir akun dengan pesan "Buat akun dulu".
  - Tanpa tagihan: "Belum ada tagihan".
- **Asisten mini** tetap tertutup secara default (DESIGN.md §1) dan tidak berubah di fase ini.

### Formulir

Satu komponen dialog dipakai oleh formulir transaksi, akun, tagihan, dan batas.
- Fokus terkunci di dialog seperti di command palette, dan kembali ke pemicu saat ditutup. Enter menyimpan, Esc menutup.
- Kalau simpan gagal, dialog tetap terbuka dengan isi yang sudah diketik, dan error tampil sebagai toast.
- **Jumlah:** menerima "25000", "25.000", atau "Rp 25.000", dan menolak desimal ("25,5") serta teks ("abc"). Saat fokus pindah, nilai diformat ulang dengan pemisah titik.
- **Transaksi:**
  - jenis [Pengeluaran | Pemasukan | Transfer], default Pengeluaran;
  - jumlah;
  - tanggal (`<input type="date">`), default hari ini;
  - akun (`<select>`), default akun terakhir dipakai. Transfer memakai pilihan "Dari" dan "Ke";
  - kategori (`<input list>` dengan `<datalist>`), tidak tampil untuk transfer;
  - keterangan dan catatan;
  - tombol Simpan, Batal, dan Hapus (hanya saat mengubah).
- **Akun:** nama, jenis, saldo awal. Tombol Hapus menampilkan "Akun masih punya transaksi atau tagihan" kalau ditolak.
- **Tagihan:** nama, jumlah, akun, jatuh tempo, dan pengulangan [Sekali | Bulanan].
- **Batas:** jumlah per bulan, dengan tombol "Hapus batas" kalau batas sudah ada.

### Format uang

`Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 })`, contohnya `Rp 25.000`. Tanda "+" dan "−" (U+2212) ditambahkan di depan untuk jumlah bertanda.

### Di luar halaman Keuangan

- **Kartu Keuangan di dashboard** menggantikan kartu "Hadir di Fase 2":
  - saldo total;
  - "Keluar bulan ini Rp x", ditambah "dari Rp y" kalau ada batas;
  - chip tagihan: "n terlambat" (coral) kalau ada yang `overdue`, lalu "Nama hari ini" kalau ada yang `dueToday`, selain itu "Tagihan aman";
  - tanpa akun: "Belum ada akun".
  - Klik kartu membuka Keuangan.
- **Ringkasan satu baris** mendapat "· n tagihan terlambat" kalau n > 0.
- **Panel notifikasi:**
  - tagihan `overdue` masuk grup Terlambat, tagihan `dueToday` masuk grup Hari ini;
  - batas dengan tingkat `warn` atau `over` untuk bulan berjalan muncul sebagai "Pengeluaran 85% dari batas";
  - semuanya menaut ke Keuangan dan ikut dihitung di titik lonceng.
- **Command palette:** aksi "Catat transaksi" membuka Keuangan dengan formulir transaksi terbuka.

## 6. Error handling

- **Mengikuti aturan Fase 1:** command tidak boleh panic di jalur yang dipicu user, dan error tampil sebagai toast.
- **Transfer dan pelunasan atomik:** `save_transfer`, `delete_transaction` pada transfer, dan `pay_bill` masing-masing berjalan dalam satu transaksi SQLite.
- **Saldo awal:** mengubah saldo awal akun hanya mengubah saldo. Transaksi tidak disentuh.
- **Upgrade gagal:** migrasi 004 gagal berarti DB tetap di versi 3 dan app menampilkan layar error yang sudah ada. App tidak pernah membuat DB baru di atas DB yang gagal dibuka.

## 7. Testing

- **Rust** (SQLite in-memory):
  - migrasi 004 berjalan di atas DB versi 3 yang berisi catatan, dan catatan itu tetap ada;
  - saldo = saldo awal + transaksi sampai hari ini: transaksi yang dihapus dan transaksi bertanggal besok tidak ikut dihitung;
  - transfer membuat dua baris dengan tanda berlawanan. Ubah dan hapus mengenai keduanya, dan transfer tidak masuk pemasukan atau pengeluaran;
  - batas bulan lokal: transaksi 1 Oktober 00:00 WIB tidak masuk September;
  - `list_transactions`: filter `in` dan `out`, transfer hanya sekali di `all`, halaman 50 dan `more`, serta `scheduled`;
  - `finance_overview`: kartu, grafik 6 bulan, dan tingkat batas `ok`, `warn`, `over`;
  - tagihan: status di setiap cabang; pelunasan bulanan dari 31 Jan → 28 Feb → 31 Mar; tagihan sekali menjadi `done`; `paidToday`; transaksi pelunasan berkategori "Tagihan";
  - validasi: jumlah ≤ 0, akun sudah dihapus, transfer ke akun yang sama, nama kosong, `kind` atau `repeat` tidak dikenal;
  - akun yang masih dipakai transaksi atau tagihan tidak bisa dihapus;
  - Inbox, Terbaru, Hari ini, dan 7 hari ke depan hanya berisi `note`, termasuk ketika ada tagihan dengan `due_at` hari ini.
- **Frontend** (`bun test`):
  - `formatRupiah` dan `parseRupiah` ("25.000", "Rp 25.000", "25000"; menolak "25,5" dan "abc");
  - label bulan "September 2026" dan navigasi bulan;
  - porsi saldo, termasuk akun negatif;
  - status teks tagihan;
  - `reminders` dengan tagihan dan batas.
- **E2E** (`scripts/e2e-smoke.sh`, `user_version` = 4):
  1. buat akun "BCA" dengan saldo awal 1.000.000;
  2. tambah pengeluaran 25.000 dan cek DB;
  3. buat tagihan bulanan "Listrik" 150.000 yang jatuh tempo kemarin, lalu screenshot panel notifikasi (tagihan di grup Terlambat);
  4. tekan "Tandai lunas" dan cek DB: ada transaksi baru berkategori "Tagihan", dan `due_at` maju sebulan;
  5. atur batas 200.000 (pengeluaran 175.000 = 88%, tingkat `warn`);
  6. cek kartu dashboard: saldo Rp 825.000, keluar Rp 175.000 dari Rp 200.000, chip "Tagihan aman";
  7. screenshot halaman Keuangan, formulir transaksi, dan panel notifikasi ("Pengeluaran 88% dari batas").

## 8. Kriteria selesai

1. Beberapa akun bisa dibuat, diubah, dan dihapus sesuai K8.
2. Pengeluaran, pemasukan, dan transfer bisa dibuat, diubah, dan dihapus, dan saldo setiap akun selalu benar.
3. Kartu, grafik, dan daftar transaksi benar untuk bulan lokal yang dipilih.
4. Tagihan sekali dan bulanan bisa dibuat, diubah, dihapus, dan dilunasi dengan satu klik.
5. Batas pengeluaran memberi peringatan di halaman Keuangan, kartu dashboard, dan panel notifikasi.
6. Inbox, Catatan terbaru, Hari ini, dan 7 hari ke depan tidak berisi data keuangan.
7. DB versi 3 yang berisi data ter-upgrade ke versi 4 tanpa kehilangan data, dan `anchoa.db.bak-v3` terbentuk.
8. Semua test lulus di CI, dan quality gate SonarCloud hijau.

## 9. Rencana PR

Rinciannya akan ditulis ulang di `docs/superpowers/plans/2026-09-30-anchoa-fase2-keuangan.md`.

| PR | Isi |
|---|---|
| F2-1 | Migrasi 004, varian `AppError`, filter `type = 'note'` di query lama, backend akun (daftar, simpan, hapus, saldo). |
| F2-2 | Backend transaksi, transfer, kategori, `finance_overview`, dan `set_budget`. |
| F2-3 | Backend tagihan (daftar, simpan, lunas, hapus, status) dan `finance` di `get_dashboard`. |
| F2-4 | Halaman Keuangan: header, kartu, grafik, daftar transaksi, bagian Akun, dialog formulir (transaksi, akun, batas), format uang, dan E2E. |
| F2-5 | Bagian Tagihan dan formulirnya, kartu dashboard, ringkasan satu baris, panel notifikasi, aksi palette, dan E2E tagihan. |
