# Panduan pengguna Anchoa

Untuk Anchoa 0.18.0 di Fedora Linux. [Landing page](https://syharipf.github.io/Anchoa/) · [README](../README.md)

## Daftar isi

- [Mulai](#mulai)
- [Dashboard](#dashboard)
- [Jurnal](#jurnal)
- [Catatan](#catatan)
- [Email](#email)
- [Jadwal](#jadwal)
- [Habit](#habit)
- [Keuangan](#keuangan)
- [Proyek](#proyek)
- [Berkas](#berkas)
- [Unduhan](#unduhan)
- [Profil](#profil)
- [Pengaturan](#pengaturan)
- [Asisten](#asisten)
- [Notifikasi](#notifikasi)
- [Privasi](#privasi)
- [Kunci PIN](#kunci-pin)
- [Backup dan pemulihan](#backup-dan-pemulihan)
- [Pemecahan masalah](#pemecahan-masalah)
- [Pintasan keyboard](#pintasan-keyboard)

## Mulai

1. Tambahkan repo dan pasang aplikasi:

   ```bash
   sudo dnf config-manager addrepo --from-repofile=https://syharipf.github.io/Anchoa/anchoa.repo
   sudo dnf install anchoa
   ```

2. Buka Anchoa dari menu aplikasi atau jalankan `anchoa`. Saat pertama dibuka, database lokal dibuat dan Dashboard tampil. Tidak perlu membuat akun Anchoa.
3. Buka **Profil** untuk mengubah nama tampilan dan mengaktifkan PIN bila perlu.
4. Pilih modul dari sidebar. Tombol **Cari atau jalankan perintah…** atau Ctrl+K membuka command palette untuk berpindah halaman, mencari item, dan mencatat cepat.
5. Kebutuhan fitur tambahan ada di [Program tambahan](../README.md#program-tambahan-opsional).

Saat ini Fedora Linux saja. Windows dan Android masih direncanakan.

Untuk mencatat cepat, buka Ctrl+K dan ketik `Ide baru`. Pilih **Simpan ke Jurnal: “Ide baru”** atau **Buat tugas: “Ide baru”** dengan panah dan Enter. **Catat transaksi** membuka formulir transaksi baru.

## Dashboard

Ringkasan tugas, agenda, keuangan, proyek, unduhan, dan catatan terbaru. Panel Asisten serta kontribusi GitHub ada di kanan.

1. Di **Hari ini**, klik judul tugas untuk melihat isinya atau centang tugas yang selesai.
2. Lihat **7 hari ke depan** untuk tugas mendatang. Klik kartu modul untuk membuka halamannya.
3. Klik item di **Catatan terbaru** untuk membukanya.
4. Untuk kontribusi GitHub, sambungkan token melalui Pengaturan > Integrasi. Integrasi ini membaca kalender kontribusi.

**Batas:** **Dengarkan rekap** membacakan ringkasan Dashboard saat data tersedia, bukan rekap yang diproses AI. Buka modul untuk detail yang tidak ditampilkan di ringkasan.

## Jurnal

Untuk ide, curhat, dan catatan singkat, dengan tag serta suasana hati.

1. Klik **Tulis**. Pilih jenis **Ide**, **Curhat**, atau **Catatan**.
2. Isi judul bila perlu dan tulis isi entri. Perubahan tersimpan otomatis; tunggu status **Tersimpan** sebelum menutup aplikasi.
3. Isi **Tambah tag**, lalu Enter, dan pilih suasana hati. Tag memakai huruf, angka, atau tanda minus.
4. Cari entri di daftar kiri atau gunakan filter jenis. Panel kanan menampilkan **Suasana 30 hari** dan pemantik menulis.
5. Pada entri **Ide**, klik **Jadikan tugas**. Setelah dibuat, **Buka tugas** membuka tugas yang terhubung.

**Batas:** **Dikte**, **Bacakan**, dan **Minta tanggapan** masih nonaktif di halaman Jurnal. Suara tersedia melalui panel Asisten. Entri tersimpan lokal, tanpa enkripsi database.

## Catatan

Untuk dokumen Markdown yang disusun sebagai halaman dan subhalaman.

1. Klik **+ Halaman baru**, isi judul, lalu klik blok untuk menulis. Isi disimpan otomatis setelah berhenti mengetik.
2. Ketik `/` di blok untuk memilih **Teks**, **Judul 1**, **Judul 2**, **Judul 3**, **Daftar**, **Daftar bernomor**, **Tugas**, **Kutipan**, atau **Kode**.
3. Ketik `[[` untuk memilih tautan halaman atau membuat halaman baru. Tautan balik muncul di panel kanan.
4. Buka menu titik tiga pada halaman untuk **Subhalaman baru**, **Ganti nama**, **Pindahkan ke…**, atau **Hapus**. Saat memindahkan, pilih tujuan lalu klik **Pindahkan**. Saat menghapus, periksa dialog lalu **Hapus** lagi.
5. Untuk pemulihan, buka **Sampah (n)** lalu klik **Pulihkan**. Menghapus halaman juga memindahkan subhalamannya ke Sampah.
6. Klik **Ekspor Markdown**. Pesan hasil menunjukkan folder ekspor; **Buka di Berkas** membuka lokasi tersebut.

**Batas:** halaman tidak dapat dipindahkan ke dirinya sendiri atau turunannya. Sampah Catatan berbeda dari Tong Sampah file sistem. Ekspor Markdown mencakup halaman Catatan, bukan seluruh database.

## Email

Untuk membaca dan mengirim email dari satu akun Gmail.

1. Aktifkan 2-Step Verification di Google, lalu buat App Password melalui [akun Google](https://myaccount.google.com/apppasswords).
2. Di menu **Email**, isi **Alamat Gmail** dan **App Password**, lalu klik **Sambungkan**. App Password harus 16 huruf; spasi boleh.
3. Pilih **Kotak masuk**, **Berbintang**, atau **Terkirim**. Gunakan filter **Semua** atau **Belum dibaca**, lalu pilih email. Membukanya menandai email sebagai dibaca.
4. Klik tombol bintang untuk mengubah tanda bintang, atau **Arsipkan** untuk mengarsipkan. Klik **Sinkronkan** untuk mengambil perubahan dari Gmail.
5. Klik **Tulis**, isi **Kepada (pisahkan dengan koma)**, **Subjek**, dan **Isi**, lalu **Kirim**. Untuk membalas, isi **Tulis balasan…** di bawah email lalu klik **Kirim**.
6. Jika Ollama tersedia, klik **Ringkas email**. Asisten memberi ringkasan dan tiga saran balasan. Klik saran untuk mengisi kolom balasan, periksa teks, lalu **Kirim** sendiri.
7. Jika ada usulan tugas, periksa lalu klik **Setujui** atau **Tolak**. Tugas yang diberi tenggat muncul di Jadwal.
8. Untuk melepas akun, buka Pengaturan > Integrasi > Email, klik **Putuskan**, lalu **Ya, putuskan**.

**Batas:** server Gmail sudah ditentukan; belum ada OAuth atau banyak akun. Sinkron mengambil paling banyak 200 header terbaru per folder server. Isi email diambil saat dibuka dan disimpan lokal. Tampilan berupa teks; belum ada kirim lampiran, tampilan HTML penuh, atau acara kalender mandiri. Ringkasan AI perlu diperiksa. Memutus akun menghapus kredensial dari keyring dan menyembunyikan cache email dari daftar; salinan lama dapat tetap ada di database atau backup.

## Jadwal

Untuk melihat tenggat tugas dan tagihan dalam **Kalender** bulanan atau **Timeline** 8 minggu.

1. Buat tugas di Proyek dan isi **Tenggat**, atau buat tagihan di Keuangan. Jadwal membaca data itu.
2. Pilih **Kalender** atau **Timeline**. Gunakan **Sebelumnya**, **Berikutnya**, dan **Hari ini** untuk berpindah periode.
3. Di bawah **Tampilkan**, aktifkan atau matikan filter **Proyek**, **Tagihan**, dan **Pribadi**.
4. Di Kalender, klik tanggal untuk melihat agenda. Klik tugas untuk mengubahnya, atau centang untuk menyelesaikan. Centang tagihan untuk mencatat pelunasannya.
5. Di Timeline, klik batang tugas untuk membuka detail. Rentang memakai tanggal **Mulai** dan **Tenggat**.

**Batas:** tugas tanpa tenggat tidak muncul. Tugas selesai tidak tampil di Timeline. Belum ada acara kalender mandiri atau impor kalender; **Tambah lewat suara** di header masih nonaktif.

## Habit

Untuk kebiasaan terjadwal, centang hari ini, streak, dan konsistensi.

1. Klik **Habit** pada tombol tambah, atau **Buat habit** jika daftar kosong.
2. Isi **Nama**, pilih **Hari aktif**, dan isi **Jam pengingat (opsional)** jika perlu. Pilih **Centang otomatis saat menulis jurnal** bila sesuai, lalu **Simpan**.
3. Di **Centang hari ini**, centang habit yang selesai. Klik lagi untuk membatalkan centang. Filter **Belum** menampilkan yang belum selesai.
4. Klik nama habit untuk melihat **Riwayat**, streak, dan konsistensi 30 hari. Gunakan **Bulan sebelumnya** atau **Bulan berikutnya** untuk melihat bulan lain.
5. Klik **Ubah** untuk mengubah nama dan jadwal. Pengingat bisa dinyalakan di detail setelah jamnya diisi. **Hapus** di panel detail langsung menghapus habit.

**Batas:** centang hanya untuk hari ini yang terjadwal, bukan mengisi hari lampau. Hari libur tidak memutus streak. Pengingat tampil di panel Notifikasi; belum ada notifikasi desktop. **Catat lewat suara** di header masih nonaktif; gunakan Asisten untuk usulan centang.

## Keuangan

Untuk pencatatan uang secara manual: akun, transaksi, tagihan, dan batas bulanan.

1. Di **Akun**, klik **Buat akun** atau **+ Tambah**. Isi **Nama**, **Jenis**, dan **Saldo awal**, lalu **Simpan**.
2. Klik **+ Transaksi**. Pilih **Pengeluaran**, **Pemasukan**, atau **Transfer**. Isi **Jumlah**, akun, tanggal, dan keterangan, lalu **Simpan**. Transfer memakai akun **Dari** dan **Ke** yang berbeda.
3. Klik transaksi untuk mengubah atau menghapusnya. Gunakan filter **Semua**, **Masuk**, **Keluar**, serta **Muat lagi** untuk melihat transaksi lain.
4. Di **Tagihan**, klik **+ Tambah**. Isi nama, jumlah, akun **Dibayar dari**, **Pengulangan** (**Sekali** atau **Bulanan**), dan **Jatuh tempo**, lalu **Simpan**.
5. Saat tagihan jatuh tempo atau terlambat, klik **Tandai lunas** untuk mencatat pengeluaran sejumlah tagihan. Tagihan bulanan maju ke jatuh tempo berikutnya. Aksi **Ubah** di pesan hasil membuka transaksi pelunasan.
6. Klik kartu **Pengeluaran**/**Atur batas** untuk mengatur **Batas per bulan**. Klik **Simpan**, atau **Hapus batas** untuk menghilangkannya.
7. Gunakan pemilih bulan dan grafik **Arus kas 6 bulan** untuk melihat ringkasan periode lain.

**Batas:** rupiah penuh saja, tanpa koneksi bank, impor CSV, atau batas per kategori. Batas hanya memberi peringatan; transaksi tetap bisa dicatat. Akun yang masih dipakai transaksi/tagihan tidak bisa dihapus. Menghapus transaksi pelunasan tidak memundurkan jatuh tempo tagihan; ubah tagihannya bila perlu. **Catat lewat suara** di header masih nonaktif; usulan transaksi tersedia lewat Asisten.

## Proyek

Untuk proyek, tugas lepas, sub-tugas, dan aktivitas agen kode.

1. Klik **Proyek** pada tombol tambah di daftar kiri. Isi nama, jenis, deskripsi, serta tenggat atau URL repo GitHub bila perlu, lalu **Simpan**. Tombol **Ubah** di kanan atas proyek membuka pengaturan proyek.
2. Pilih proyek atau **Tugas lepas** di daftar kiri. Klik **Tugas** pada kolom Kanban, isi judul, lalu Enter.
3. Klik kartu tugas untuk mengubah judul, isi Markdown, **Status**, **Prioritas** (Tinggi, Sedang, Rendah), **Proyek**, **Mulai**, **Tenggat**, dan **Tag**. Perubahan tersimpan otomatis. Isi **Tambah sub-tugas…** lalu Enter untuk membuat sub-tugas.
4. Geser dan lepas (*drag-and-drop*) kartu antar kolom, atau gunakan tombol panah fallback keyboard pada kartu. Kartu diurutkan berdasarkan prioritas tertinggi lalu tenggat terdekat.
5. Gunakan bilah filter di atas papan untuk menyaring tugas berdasarkan kata kunci pencarian, tag, prioritas, atau status tenggat (**Terlambat**, **7 hari ke depan**, **Tanpa tenggat**). Klik **Reset** untuk mengosongkan filter.
6. Klik kanan pada kartu tugas (atau tombol menu **⋯**) untuk membuka menu konteks: ubah prioritas, pindah kolom, jalankan tugas dengan agen, atau hapus tugas. Klik kanan pada proyek di daftar kiri untuk membuka menu **Ubah** atau **Hapus**.
7. Menghapus tugas memunculkan notifikasi dengan tombol **Urungkan** (berlaku 6 detik). Menghapus proyek lewat menu memindahkan tugas-tugasnya ke **Tugas lepas**.

Untuk papan agen:

1. Di tab **Agen kode** atau pengaturan proyek, aktifkan proyek agen. Isi **Folder repo** dan **Perintah agen** langsung di formulir koneksi, lalu klik **Simpan**.
2. Klik **Uji konfigurasi** untuk memeriksa apakah folder dan perintah agen valid sebelum dijalankan. Indikator status agen menampilkan titik hijau saat agen aktif menjalankan proses dan abu-abu saat berhenti.
3. Kanban agen memiliki kolom **Rencana**, **Dikerjakan**, **Tes**, **Review**, dan **Selesai**. Klik kartu untuk membuka **Utas**, ubah status, atau tulis pesan lalu **Balas**.
4. Pilih **Agen kode**, isi **Permintaan ke agen**, lalu **Kirim**. Tombol seperti **Jalankan tes** hanya mengisi kolom permintaan; tetap klik **Kirim**.
5. Dengan perintah agen terpasang, klik **Jalankan dengan agen** pada menu tugas untuk mengeksekusi tugas langsung. Klik **Hentikan** untuk menghentikan proses, atau **Lihat log** untuk melihat keluarannya.
6. Agen luar melapor melalui CLI `anchoa agent …` ke database yang sama. Gunakan petunjuk koneksi di tab **Agen kode**. Contoh baca daftar proyek dan permintaan:

   ```bash
   anchoa agent projects
   anchoa agent inbox
   ```

**Batas:** sub-tugas satu tingkat; selesai sub-tugas tidak otomatis menyelesaikan induk. Satu proses agen berjalan per proyek. Perintah agen dijalankan melalui shell; Anchoa tidak menyediakan persetujuan per perintah atau sandbox agen. Layanan luar dan izin agen mengikuti program yang dipilih. Papan ini belum memakai MCP atau kontrol dari HP. **Tambah lewat suara** di header masih nonaktif.

## Berkas

Pengelola file yang benar-benar ada di disk laptop.

1. Pilih folder di **Tempat** atau **Perangkat**. Klik item untuk memilih dan melihat pratinjau; klik dua kali untuk membuka.
2. Gunakan **Kembali**, **Maju**, **Naik satu folder**, atau breadcrumb. Pilih **Tampilan ikon**/**Tampilan daftar**, dan **Tampilkan tersembunyi** bila perlu.
3. Gunakan Ctrl+klik untuk memilih beberapa item atau Shift+klik untuk rentang.
4. Klik **Salin** atau **Pindahkan**, buka folder tujuan, lalu **Tempel n item**. Jika nama bentrok, pilih **Ganti**, **Lewati**, atau **Simpan dengan nama baru**.
5. Klik **Hapus**, periksa dialog **Pindahkan n item ke Tong Sampah?**, lalu **Hapus**. Pulihkan melalui Tong Sampah pengelola file sistem.
6. Klik **Buka** di pratinjau untuk membuka file dengan aplikasi sistem.

**Batas:** akses hanya di bawah home dan perangkat terpasang yang terdaftar; symlink keluar akar ditolak saat dibuka. Pratinjau teks maksimal 64 KiB. Dukungan video/PDF mengikuti WebKit dan sistem. Belum ada akses SFTP dari HP atau tombol membuat folder/mengganti nama. Operasi dapat selesai sebagian jika ada kegagalan; baca pesan hasilnya.

## Unduhan

Untuk file HTTP/HTTPS langsung serta video/audio melalui yt-dlp.

1. Tempel URL di **Tautan unduhan**. Untuk file langsung, klik **Unduh**.
2. Untuk media, pilih **Video** atau **Audio saja**, kualitas dan format. Pilih **Subtitle** bila perlu. Label tombol mengikuti pilihan, misalnya **Unduh 1080p MP4** atau **Unduh audio MP3**.
3. Jika situs media terbaca sebagai file, klik chip **File langsung** untuk memaksa media lewat yt-dlp.
4. Pantau **Antrean** melalui tab **Semua**, **Aktif**, **Selesai**, atau **Gagal**. Gunakan **Jeda**, **Lanjutkan**, **Coba lagi**, atau **Batalkan**. Header menyediakan **Jeda semua**/**Lanjutkan semua**.
5. Saat selesai, klik **Buka berkas** atau **Buka di Berkas**. **Hapus dari daftar** menghapus catatan antrean, bukan file hasil.
6. Di panel **Pengaturan**, klik **Ubah** pada **Simpan ke**, isi path folder yang sudah ada, lalu **Simpan**. Atur unduhan bersamaan (1–5) dan batas kecepatan.

**Batas:** torrent/magnet belum didukung. yt-dlp dan ffmpeg harus ada di PATH untuk media; file langsung tidak memerlukannya. Playlist tidak diikuti, kualitas/subtitle bergantung sumber. Folder tujuan harus di dalam home. Setelah aplikasi dibuka kembali, unduhan yang belum selesai berstatus Dijeda; klik **Lanjutkan**. Jika server file tidak mendukung kelanjutan, unduhan dimulai ulang. Batas kecepatan dibagi menurut jumlah unduhan bersamaan yang diatur.

## Profil

Untuk nama tampilan, statistik pemakaian, keamanan, dan preferensi pengingat.

1. Klik **Ubah profil**, isi **Nama tampilan**, lalu **Simpan**. Nama kosong kembali menjadi **Kamu**; maksimal 40 karakter.
2. Lihat statistik streak, tugas selesai, entri jurnal, dan catatan.
3. Di **Keamanan**, aktifkan **Kunci dengan PIN saat aplikasi dibuka**. Ikuti [Kunci PIN](#kunci-pin).
4. Gunakan **Atur** pada akun terhubung untuk membuka Integrasi, atau **Atur suara** untuk membuka pengaturan suara.
5. Di **Notifikasi**, nyalakan atau matikan **Tugas**, **Tagihan**, **Batas anggaran**, dan **Habit**. Ini mengatur isi panel serta penanda lonceng.

**Batas:** profil lokal saja. Enkripsi data lokal, impor kalender, jam tenang, dan notifikasi desktop masih menyusul.

## Pengaturan

Untuk mengatur layanan dan data perangkat ini.

1. Pilih **Asisten & AI** untuk mengatur Ollama atau **Kustom**, **Tes koneksi**, dan model per tugas; lihat [Asisten](#asisten).
2. Pilih **Suara** untuk memasang model/binary, menguji mikrofon, memilih atau mengimpor suara, dan mengatur kecepatan, ekspresi, serta variasi.
3. Pilih **Sinkron & data**. Bagian atas berisi kartu **Sinkron antarperangkat**: masuk dengan Google atau GitHub, buat atau buka kunci frasa sandi sync, lalu **Sinkronkan sekarang**. Bagian bawah berisi ukuran database, ringkasan item, daftar backup, **Backup sekarang**, **Buka folder backup**, dan **Buka folder data**.
4. Pilih **Integrasi** untuk Gmail dan GitHub. Untuk kalender kontribusi GitHub, isi **Token GitHub** lalu **Sambungkan**. **Muat ulang data** mengambil ulang kalender; **Putuskan** menghapus token dan cache kontribusi.
5. Pilih **Tentang** untuk melihat versi, memeriksa pembaruan, membuka **Repositori GitHub**/**Catatan Rilis**, dan melihat lisensi. Pembaruan RPM dipasang melalui `sudo dnf upgrade anchoa`.

**Batas:** **Avatar Live2D** masih menampilkan avatar statis. SFTP dari HP belum aktif. OpenRouter, OpenAI, dan Anthropic belum tersedia sebagai penyedia langsung; endpoint kompatibel OpenAI dapat dipakai lewat **Kustom**. Belum ada pemasangan pembaruan aplikasi otomatis dari panel Tentang. Sync memerlukan Supabase yang dikonfigurasi saat build.

## Asisten

Asisten penuh ada di Dashboard. Pada halaman lain, buka tombol Asisten di kanan bawah; **Buka asisten penuh** kembali ke Dashboard.

### Penyedia dan percakapan

1. Untuk Ollama lokal, pasang dan siapkan model bawaan:

   ```bash
   sudo dnf install ollama
   sudo systemctl start ollama
   ollama pull qwen2.5:3b
   ```

2. Buka Pengaturan > **Asisten & AI**, pilih **Ollama**, klik **Tes koneksi**, lalu pilih model yang telah diunduh untuk **Percakapan & aksi**. Alamat bawaan Ollama `http://127.0.0.1:11434`. Untuk memakai endpoint kompatibel OpenAI seperti 9router, ikuti langkah Kustom di bawah.
3. Klik **Ketik pesan**, isi pesan, lalu **Kirim** atau Enter. Asisten dapat membaca ringkasan hari ini, mencari item yang diizinkan, dan melihat tugas.
4. Untuk perubahan data, baca kartu usulan lalu **Setujui** atau **Tolak**. Aksi tersedia: membuat/menyelesaikan tugas, menambah transaksi atau entri jurnal, dan mencentang habit.
5. Klik **Hentikan** untuk menghentikan jawaban yang sedang diproses.

Untuk **Kustom / 9router**:

1. Jalankan 9router, pilih **Kustom**, isi **Nama penyedia** (misalnya `9router`) dan **Base URL** `http://127.0.0.1:20128/v1`, lalu **Simpan metadata**. URL lain harus HTTPS; HTTP hanya diizinkan untuk `localhost`, `127.0.0.1`, atau `::1`.
2. **API key opsional**: server lokal boleh tanpa key. Jika diperlukan, isi key lalu **Ganti key**. Key disimpan di keyring OS dan tidak ditampilkan kembali; **Hapus key** menghapusnya.
3. Klik **Tes koneksi**. Pada **Percakapan & aksi**, pilih penyedia **Kustom**, pilih model yang ditemukan atau isi **ID model manual**, lalu **Simpan model Percakapan & aksi**. Menyimpan metadata saja tidak mengganti penyedia/model peran.

Mengubah URL menghapus key lama dan mereset sesi chat. Mengganti atau menghapus key, maupun mengganti penyedia/model **Percakapan & aksi**, mereset riwayat dan usulan yang belum disetujui. Menyimpan metadata dengan URL yang sama tidak mengubah key atau mereset sesi. Tidak ada fallback penyedia otomatis.

### Suara

1. Pasang program sistem jika belum ada:

   ```bash
   sudo dnf install whisper-cpp pipewire-utils
   ```

2. Di Pengaturan > **Suara**, klik **Pasang** untuk **Model Whisper Base (ggml-base.bin)**, **Piper TTS**, dan suara **Indonesia · News**. Unduhan ini memerlukan internet.
3. Klik **Uji mikrofon**, bicara beberapa detik, lalu **Hentikan rekaman uji**. Periksa hasil transkripsinya.
4. Di katalog suara, klik **Pilih** pada suara terpasang. Gunakan **Coba suara** untuk menguji dan **Hentikan** untuk menghentikan contoh.
5. Untuk suara sendiri, klik **Impor suara…**, pilih `.onnx`, dan pastikan pasangan `.onnx.json` ada di folder yang sama. Masing-masing berkas harus berisi data dan berukuran kurang dari 200 MiB.
6. Pada Asisten, klik **Ketuk untuk bicara**, bicara, lalu **Berhenti mendengarkan**. Ucapan ditranskripsi dan dikirim sebagai pesan; jawaban suara memakai Piper. **Hentikan suara** menghentikan pemutaran.

Rekaman dibatasi 60 detik. Whisper memakai bahasa Indonesia. pw-record merekam; pw-play memutar. File suara sementara dibersihkan setelah proses.

### Peran di Pengaturan > Asisten & AI

| Peran di UI | Pemakaian pada versi ini |
| --- | --- |
| Percakapan & aksi | Aktif: percakapan dan usulan aksi di panel Asisten, memakai Ollama atau Kustom. |
| Tanggapan jurnal | Wajib Ollama lokal; model dapat diatur, tetapi tombol Minta tanggapan di Jurnal masih nonaktif. |
| Rekap harian | Pemrosesan AI belum tersedia; pengaturan peran nonaktif. Dengarkan rekap di Dashboard hanya membacakan ringkasan biasa. |
| Asisten email | Wajib Ollama lokal: ringkasan, saran balasan, dan usulan tugas dari email terpilih. |

**Batas:** peran privat jurnal dan email terkunci ke Ollama lokal, bukan Kustom. Riwayat percakapan ada di memori dan hilang saat aplikasi ditutup atau sesi direset. Usulan dapat salah atau gagal dijalankan. Asisten tidak punya tool hapus, pengelolaan file, unduhan, atau menjalankan perintah shell. Isi jurnal, email, dan tugas turunan jurnal tidak otomatis masuk konteks percakapan umum. Avatar masih statis.

## Notifikasi

Panel pengingat dalam aplikasi, dibuka melalui lonceng **Notifikasi** di sidebar.

1. Klik lonceng untuk melihat **Terlambat** dan **Hari ini**: tugas, tagihan, pengingat habit yang waktunya tiba, serta batas pengeluaran mulai 80%.
2. Klik **Buka ›** pada pengingat untuk membuka item atau modul terkait.
3. Selesaikan tugas, lunasi tagihan, atau centang habit agar pengingatnya hilang saat data dimuat ulang.
4. Atur jenis pengingat di Profil > **Notifikasi**. Klik **Tutup** atau Escape untuk menutup panel.

**Batas:** belum ada notifikasi desktop, status dibaca, arsip notifikasi, bunyi, atau jam tenang. Daftar dihitung dari data aplikasi.

## Privasi

Data modul tersimpan dalam SQLite lokal di laptop. File asli dan hasil unduhan tetap berupa file di disk; App Password Gmail berada di keyring sistem, dan token GitHub di berkas terpisah. Database, jurnal, serta backup belum dienkripsi. PIN hanya mengunci akses melalui aplikasi.

| Fitur | Yang berada di perangkat | Yang keluar dari perangkat |
| --- | --- | --- |
| Modul harian | Jurnal, Catatan, tugas, jadwal, habit, keuangan, profil, pengaturan. | Jika sync aktif: record dienkripsi end-to-end (XChaCha20-Poly1305) dan dikirim ke Supabase. Server hanya menyimpan ciphertext. Tanpa sync, tidak ada data ke cloud. |
| Asisten | Prompt, konteks, jawaban, riwayat dalam memori; pemrosesan Ollama di localhost secara bawaan. API key Kustom di keyring OS. | Pengunduhan model Ollama menghubungi sumber model. Kustom mengirim pesan/riwayat sesi, nama profil, konteks tugas/tagihan/habit/akun, dan hasil tool yang diizinkan ke endpoint pilihan. Data sensitif yang diketik sendiri juga dikirim. |
| Suara | Rekaman sementara, Whisper, Piper, model suara; pemrosesan lokal. | Unduhan binary Piper dari GitHub dan model Whisper/suara dari Hugging Face. |
| Email | Alamat akun dan cache email di database; App Password di keyring. | Login/pengambilan ke `imap.gmail.com:993`; pengiriman ke `smtp.gmail.com:465`, melalui TLS. Ringkas email mengirim isi email terpilih ke Ollama lokal. |
| GitHub opsional | Token di `github-token` dengan izin file 0600; kalender kontribusi di SQLite. | Token dan permintaan kalender kontribusi ke API GraphQL GitHub. |
| Unduhan | Antrean, URL, file sementara, hasil. | Permintaan ke situs sumber melalui HTTP/HTTPS atau yt-dlp. |
| Agen proyek | Tugas, aktivitas, log agen. | Mengikuti perintah/program agen, termasuk layanan luar yang dipakainya. |
| Cek rilis dan tautan | Versi aplikasi. | Cek pembaruan menghubungi API GitHub; membuka tautan memakai browser/aplikasi sistem. |
| Sync opsional | Frasa sandi dan recovery key tidak disimpan; DEK dan token OAuth disimpan di keyring sistem. | Login OAuth ke Supabase Auth (Google/GitHub). Record terenkripsi dikirim/ditarik lewat REST Supabase. Server tidak bisa membaca isi. |

Endpoint **Kustom** diatur lewat Pengaturan > **Asisten & AI** dan dapat berupa server lokal atau remote. Jurnal, email, dan tugas turunan jurnal tidak disertakan otomatis dalam percakapan Kustom; peran jurnal/email tetap memakai Ollama lokal. Alamat Ollama dapat diganti lewat variabel lingkungan `ANCHOA_AI_BASE`; jika diarahkan keluar localhost, pesan/konteks dikirim ke alamat itu. Pemrosesan tetap di laptop hanya jika endpoint AI serta program agen yang dipilih juga lokal; layanan seperti 9router dapat meneruskan permintaan ke penyedia luar sesuai konfigurasinya.

## Kunci PIN

1. Buka Profil > **Keamanan** dan nyalakan **Kunci dengan PIN saat aplikasi dibuka**.
2. Di **Buat PIN**, isi PIN baru dan konfirmasinya, lalu **Simpan**. PIN harus 4–8 digit angka.
3. Saat aplikasi dibuka lagi, isi **PIN** pada layar **Anchoa terkunci**, lalu klik **Buka**.
4. Untuk mengubah, klik **Ganti PIN**, isi PIN saat ini, PIN baru, dan konfirmasi, lalu **Simpan**.
5. Untuk mematikan, matikan sakelar kunci, isi PIN saat ini di **Matikan PIN**, lalu **Simpan**.

**Batas:** setelah lima kesalahan ada jeda 30 detik. PIN disimpan sebagai hash Argon2id, tetapi database tidak dienkripsi. Belum ada kunci otomatis saat diam atau tombol kunci manual. CLI agen memakai database langsung dan tidak melewati layar PIN.

## Backup dan pemulihan

Backup database dibuat sekali per hari saat Anchoa dibuka, jika berkas untuk hari itu belum ada. Backup harian dan manual berbagi batas tujuh berkas terbaru.

1. Buka Pengaturan > **Sinkron & data**.
2. Klik **Backup sekarang** untuk membuat salinan database saat ini.
3. Klik **Buka folder backup** untuk melihat berkas, atau **Buka folder data** untuk memastikan lokasi database.
4. Salin backup yang ingin disimpan lama ke lokasi pilihan; rotasi otomatis dapat menghapus salinan lama di folder backup.

Lokasi bawaan:

```text
~/.local/share/io.github.syharipf.anchoa/anchoa.db
~/.local/share/io.github.syharipf.anchoa/backups/
```

**Memulihkan:** tutup Anchoa dan hentikan agen yang memakai database. Simpan database saat ini bersama berkas WAL/SHM, lalu salin backup terpilih menjadi `anchoa.db`. Perintah lengkap ada di [README](../README.md#memulihkan-dari-backup). Sesuaikan direktori jika lokasi data berbeda, dan buka aplikasi lagi.

**Batas:** belum ada tombol pemulihan di UI. Backup berisi data/pengaturan SQLite, termasuk hash PIN dan cache email. File asli, unduhan, model suara, log agen, keyring Gmail, dan `github-token` tidak ikut. Jika pindah perangkat, pasang ulang model dan sambungkan integrasi kembali.

## Pemecahan masalah

### Layar kosong atau gagal membuat GBM buffer pada NVIDIA

Anchoa otomatis memilih render node selain NVIDIA jika tersedia. Pilihan otomatis tidak mengganti `WEBKIT_WEB_RENDER_DEVICE_FILE` yang sudah diatur.

1. Tutup aplikasi. Periksa perangkat dan drivernya:

   ```bash
   ls /dev/dri/renderD*
   for node in /sys/class/drm/renderD*; do
     printf '%s: ' "$node"
     readlink "$node/device/driver"
   done
   ```

2. Pilih node GPU selain NVIDIA. Contoh berikut hanya jika `renderD128` memang GPU tersebut:

   ```bash
   WEBKIT_WEB_RENDER_DEVICE_FILE=/dev/dri/renderD128 anchoa
   ```

3. Jika tidak ada node lain, coba renderer alternatif yang dicatat dalam spec:

   ```bash
   WEBKIT_DISABLE_DMABUF_RENDERER=1 anchoa
   ```

Renderer alternatif dapat lebih lambat. Nomor node bergantung perangkat.

### Ollama belum berjalan atau model tidak ada

Jalankan `sudo systemctl start ollama`, lalu `ollama pull qwen2.5:3b`. Di Pengaturan > **Asisten & AI**, klik **Tes koneksi** dan pilih model yang tersedia. Pastikan layanan ada di `127.0.0.1:11434`; mengunduh model saja tidak menjalankan layanan.

### Program suara tidak ditemukan

Pasang `whisper-cpp` dan `pipewire-utils`. Buka Pengaturan > **Suara** dan periksa perekam, binary Whisper, model Base, Piper, serta suara terpilih. Model Base/Piper/suara dipasang lewat **Pasang** di aplikasi. Coba **Uji mikrofon** dan **Coba suara**. pw-record/pw-play memerlukan sesi PipeWire yang berjalan.

### Lupa PIN

Tutup Anchoa. Pasang utilitas bila perlu dengan `sudo dnf install sqlite`, lalu jalankan perintah persis dari **Lupa PIN?** di layar kunci:

```bash
sqlite3 ~/.local/share/io.github.syharipf.anchoa/anchoa.db "DELETE FROM settings WHERE key = 'security.pin_hash';"
```

Buka kembali Anchoa; PIN menjadi nonaktif. Jika direktori data berbeda, sesuaikan path.

### Database gagal dibuka atau pemulihan backup gagal

Tutup aplikasi sebelum menyalin database. Pastikan nama backup benar dan simpan database lama bersama `anchoa.db-wal` serta `anchoa.db-shm`, agar WAL lama tidak dipakai pada salinan backup. Ikuti [Backup dan pemulihan](#backup-dan-pemulihan). Jika backup masih gagal dibuka, coba salinan lain. Backup dapat mengaktifkan kembali PIN lama; Gmail/GitHub perlu disambungkan ulang jika kredensial tidak tersedia.

### Unduhan media gagal

Periksa yt-dlp dan ffmpeg di panel mesin Unduhan. Petunjuk aplikasi: `sudo dnf install yt-dlp ffmpeg`; paket ffmpeg bergantung repo yang aktif. Perbarui yt-dlp dengan `sudo dnf upgrade yt-dlp`, lalu **Coba lagi**. Kualitas/subtitle bergantung sumber; torrent/magnet ditolak.

### Gmail tidak tersambung

Gunakan App Password 16 huruf, bukan password login biasa. Pastikan 2-Step Verification aktif dan layanan keyring tersedia. Jika kredensial hilang setelah pemulihan/pindah perangkat, sambungkan Gmail kembali. Sinkron, membuka email (juga yang sudah dicache, karena status dibaca dikirim ke Gmail), serta mengirim email memerlukan koneksi.

## Pintasan keyboard

| Tempat | Tombol | Aksi |
| --- | --- | --- |
| Aplikasi | Ctrl+K atau Ctrl+N | Buka command palette. |
| Command palette | Panah atas/bawah, Enter, Escape | Pilih hasil, jalankan, tutup. |
| Dialog, panel Notifikasi, dan Asisten mini | Escape | Tutup. |
| Daftar bagian Pengaturan | Panah atas/bawah, Home, End | Pindah bagian; pilih pertama/terakhir. |
| Kolom pesan Asisten | Enter | Kirim pesan. |
| Judul tugas baru di Kanban / sub-tugas | Enter | Buat tugas. |
| Judul tugas baru di Kanban | Escape | Batalkan penambahan. |
| Kolom Tambah tag di Jurnal | Enter | Tambahkan tag yang valid. |
| Editor blok Catatan | Enter / Shift+Enter | Pecah blok (di daftar: item baru; di blok kode: baris baru) / baris baru dalam blok. |
| Editor blok Catatan | Ctrl+Enter atau Escape | Keluar dari edit blok (Escape menutup saran lebih dulu). |
| Saran `/` atau `[[` di Catatan | Panah atas/bawah, Enter atau Tab, Escape | Pilih saran, terapkan, tutup. |
| Berkas, saat fokus tidak di formulir/dialog | Backspace / Enter | Naik satu folder / buka item terpilih. |
| Berkas | Ctrl+klik / Shift+klik | Pilih beberapa item / rentang. |
| Kolom Tautan unduhan | Enter | Tambahkan unduhan yang valid. |

Pintasan berlaku di konteksnya. Belum ada pintasan tahan Spasi untuk bicara atau Ctrl+S khusus untuk menyimpan.
