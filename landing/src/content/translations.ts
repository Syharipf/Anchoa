export const id = {
  'nav.features': 'Fitur',
  'nav.how': 'Cara kerja',
  'nav.eng': 'Rekayasa',
  'nav.download': 'Unduh',
  'nav.cta': 'Unduh',
  'hero.eyebrow': 'v0.18.0 · tersedia di Fedora & Arch · Windows/Android direncanakan',
  'hero.title': 'Satu kawanan untuk <em>semua urusan harianmu.</em>',
  'hero.lead':
    'Anchoa menyatukan tugas, jadwal, keuangan, jurnal, catatan, habit, email, berkas, dan unduhan di laptop. Dashboard dan asisten suara membantu urusan harianmu.',
  'hero.cta1': 'Unduh untuk Fedora & Arch',
  'hero.cta2': 'Lihat kode',
  'hero.hint':
    'gerakkan kursor untuk membubarkan kawanan, klik untuk memberi makan, gulir untuk menyelam',
  'term.l1': '› Data modul tersimpan di SQLite lokal.',
  'term.l2': '› Asisten lokal: Ollama · qwen2.5:3b',
  'term.l3': '› Aksi asisten menunggu Setujui atau Tolak.',
  'mock.caption':
    'Pratinjau konsep desktop dan HP · data contoh · versi HP belum tersedia',
  'zone.epi': 'zona epipelagik',
  'feat.title': 'Semua yang kamu urus tiap hari, dalam satu aplikasi.',
  'feat.lead':
    'Ketik pesan atau bicara lewat mikrofon. Asisten memakai Ollama lokal untuk membaca ringkasan hari ini dan mengusulkan aksi yang kamu setujui.',
  'f1.t': 'Asisten suara lokal dengan Ollama',
  'f1.d':
    'Ucapkan “catat makan siang 35 ribu” atau “aku sudah olahraga”. Whisper mengubah ucapan menjadi teks, Piper membacakan jawaban di laptop. Perubahan data menunggu persetujuanmu.',
  'f1.c1': '# kamu',
  'f1.c2': '“buat tugas kirim laporan”',
  'f1.c3': '# anchoa',
  'f1.c4': 'Usulan: buat tugas · Setujui / Tolak',
  'f2.t': 'Jadwal & tugas',
  'f2.d':
    'Kalender bulanan, timeline 8 minggu, dan Kanban proyek. Tenggat tugas dan tagihan tampil di Jadwal; tugas harian juga ada di Dashboard.',
  'f3.t': 'Habit',
  'f3.d':
    'Centang hari ini, pilih hari aktif, lihat streak dan riwayat bulanan. Hari libur tidak memutus streak; pengingat muncul di panel Notifikasi.',
  'f4.t': 'Jurnal di perangkat',
  'f4.d':
    'Simpan ide, curhat, tag, dan suasana hati di SQLite lokal. Ide bisa dijadikan tugas. Database belum dienkripsi; isi jurnal tidak otomatis masuk konteks percakapan umum.',
  'f5.t': 'Keuangan',
  'f5.d':
    'Akun, saldo, arus kas 6 bulan, tagihan, dan batas pengeluaran bulanan. Catat transaksi manual atau setujui usulan dari asisten.',
  'f6.t': 'Berkas lokal di laptop',
  'f6.d':
    'Jelajahi home dan perangkat terpasang, lihat pratinjau, salin atau pindahkan file. Hapus memindahkannya ke Tong Sampah. Akses dari HP masih direncanakan.',
  'f7.tag': 'untuk developer',
  'f7.t': 'Agen kode tercatat di proyekmu',
  'f7.d':
    'Papan agen punya kolom Rencana, Dikerjakan, Tes, Review, dan Selesai. Agen luar melapor lewat CLI lokal; perintah agen opsional dijalankan saat kamu mengirim permintaan.',
  'f7.c1': '# di Anchoa',
  'f7.c2': 'Rencana, progres, dan hasil tes → utas tugas',
  'f7.c3': 'Tanpa perintah agen, tugas menunggu di Rencana.',
  'f8.t': 'Unduhan & email',
  'f8.d':
    'File langsung serta video/audio lewat yt-dlp dan ffmpeg. Satu akun Gmail lewat IMAP/SMTP, dengan ringkasan Ollama lokal. App Password disimpan di keyring sistem; torrent belum didukung.',
  'how.title': 'Data aplikasi lokal, asisten di laptop.',
  'how.lead':
    'Data modul tersimpan di SQLite pada laptop. Ollama menjalankan asisten secara lokal; email dan unduhan menghubungi sumbernya. Sinkron antarperangkat masih direncanakan.',
  'how.n1tag': 'desktop · Fedora · Arch',
  'how.n1a': 'Tauri 2 + React + Rust',
  'how.n1b': 'Data modul dibaca dari database lokal',
  'how.n1c': 'Panel asisten, email, dan unduhan',
  'how.l1': 'Command Rust<br/>Baca / tulis lokal',
  'how.n2tag': 'penyimpanan · lokal',
  'how.n2a': 'Tugas, keuangan, jurnal, dan catatan',
  'how.n2b': 'Backup harian dan manual',
  'how.n2c': 'App Password terpisah di keyring',
  'how.l2': 'File database<br/>di perangkat',
  'how.n3tag': 'perangkatmu',
  'how.n3t': 'Laptop',
  'how.n3a': 'Folder dan hasil unduhan lokal',
  'how.n3b': 'Suara lokal: Whisper dan Piper',
  'how.n3c': 'Ollama di localhost (opsional)',
  'how.note':
    'Email memakai server Gmail dan unduhan memakai situs sumber. Sinkron perangkat serta Windows/Android masih direncanakan.',
  'eng.title': 'Dibangun dengan pengujian alur dan batas akses.',
  'eng.lead':
    'Frontend React dan backend Rust memakai database yang sama. Pengujian mencakup PIN, kredensial email, usulan asisten, dan operasi berkas lokal.',
  'e1.t': 'Kunci PIN saat aplikasi dibuka',
  'e1.d':
    'PIN 4–8 digit disimpan sebagai hash Argon2id. Saat terkunci, akses data melalui aplikasi ditolak; lima kesalahan memberi jeda 30 detik.',
  'e2.t': 'App Password di keyring sistem',
  'e2.d':
    'App Password Gmail disimpan di keyring. Token GitHub opsional ada di berkas lokal berizin 0600, terpisah dari database dan backup.',
  'e3.t': 'Backup database di perangkat',
  'e3.d':
    'Backup harian dan manual menyimpan tujuh berkas terbaru. Database dan jurnal masih tanpa enkripsi; PIN mengunci akses aplikasi.',
  'e4.t': 'Usulan asisten menunggu persetujuan',
  'e4.d':
    'Setujui atau Tolak sebelum asisten mengubah data. Agen kode memakai perintah lokal pilihanmu; izin perintah mengikuti program agen itu sendiri.',
  'dl.title': 'Saat ini tersedia di Fedora dan Arch Linux.',
  'dl.lead':
    'Paket .rpm dan .pkg.tar.zst tersedia di GitHub Releases. Repo DNF (Fedora) dan repo pacman (Arch Linux, CachyOS) Anchoa juga tersedia untuk pemasangan dan pembaruan. Windows dan Android masih direncanakan.',
  'dl.ready': 'tersedia',
  'dl.rpmT': 'Fedora · paket .rpm',
  'dl.rpmD':
    'Unduh berkas .rpm terbaru dari halaman rilis, lalu pasang dengan dnf supaya dependensinya ikut terpasang.',
  'dl.rpmBtn': 'Buka GitHub Releases',
  copy: 'Salin',
  'dl.soon': 'direncanakan',
  'dl.dnfT': 'Repo DNF Anchoa',
  'dl.dnfD':
    'Tambahkan repo Anchoa sekali, pasang paket, lalu perbarui lewat dnf upgrade.',
  'dl.archT': 'Arch Linux / CachyOS · repo pacman',
  'dl.archD':
    'Impor kunci GPG Anchoa, tambahkan repo [anchoa] ke pacman.conf, lalu pasang. Pembaruan ikut sudo pacman -Syu atau paru. Paket AUR anchoa-bin menyusul setelah terbit di AUR.',
  'dl.flatD':
    'Paket Flatpak belum tersedia. Dukungan distro Linux lain masih direncanakan.',
  'rm.title': 'Rute platform',
  'rm.note': 'urutan bisa berubah',
  'rm.s1': '.rpm · repo DNF · repo pacman · tersedia',
  'rm.l2': 'Linux lain',
  'rm.s2': 'paket belum tersedia',
  'rm.s3': 'direncanakan',
  'rm.s4': 'belum tersedia',
  'zone.meso': 'batas mesopelagik',
  'faq.title': 'Pertanyaan yang sering muncul',
  q1: 'Apakah Anchoa gratis?',
  a1: 'Anchoa memakai asisten lokal lewat Ollama, tanpa kunci API AI. Jika memilih program agen luar, biaya dan layanannya mengikuti program tersebut.',
  q2: 'Data saya disimpan di mana?',
  a2: 'Data modul ada di SQLite lokal pada laptop. File dan unduhan ada di disk, App Password Gmail di keyring. Database dan jurnal belum dienkripsi; belum ada sinkron antarperangkat.',
  q3: 'Apakah butuh internet?',
  a3: 'Modul lokal dan Ollama dapat dipakai offline setelah model terpasang. Email, unduhan, pengambilan kontribusi GitHub, cek rilis, serta pemasangan model memerlukan koneksi.',
  q4: 'Kenapa namanya Anchoa?',
  a4: 'Anchoa adalah kata Spanyol untuk ikan teri. Kawanan teri menjadi gambaran urusan harian yang saling terhubung dalam satu aplikasi.',
  q6: 'Bisa dipakai di Windows, macOS, atau Ubuntu?',
  a6: 'Belum. Versi 0.18.0 tersedia untuk Fedora Linux (.rpm dan repo DNF) serta Arch Linux dan CachyOS (repo pacman). Windows dan Android masih direncanakan; platform lain belum tersedia.',
  q5: 'Avatar-nya bisa diganti?',
  a5: 'Belum. Avatar saat ini memakai kawanan teri statis. Bagian Avatar Live2D di Pengaturan masih berupa keterangan; impor model Live2D belum tersedia.',
  'g.title': 'Yang berenang di halaman ini',
  'g.lead':
    'Diurutkan dari permukaan. Ikan lentera biasanya tinggal lebih dalam dan naik ke atas saat malam.',
  'g.n1': 'Penyu hijau',
  'g.d1': 'Sesekali lewat dekat permukaan. Ia harus naik untuk bernapas.',
  'g.n2': 'Ubur-ubur bulan',
  'g.d2': 'Melayang dengan denyut payungnya. Kawanan teri menghindarinya.',
  'g.n3': 'Teri',
  'g.d3': 'Kawanan utama, pemakan plankton. Klik untuk memberi makan.',
  'g.n4': 'Tongkol',
  'g.d4': 'Pemangsa teri. Saat ia datang, kawanan merapat jadi bola umpan.',
  'g.n5': 'Pari manta karang',
  'g.d5': 'Meluncur pelan di perairan tengah sambil menyaring plankton.',
  'g.n6': 'Ikan lentera',
  'g.d6':
    'Muncul saat kamu menyelam mendekati 200 m. Titik cahayanya disebut fotofor.',
  'au.eyebrow': 'di balik Anchoa',
  'au.title': 'Proyek Anchoa',
  'au.d':
    'Aplikasi desktop dengan React, Tauri 2, Rust, dan SQLite. Kode dan spec tersedia di repositori; fitur yang berjalan mengikuti implementasi versi 0.18.0.',
  'au.port': 'Repositori',
  'ft.live2d': 'Avatar aplikasi masih statis. Dukungan Live2D direncanakan.',
  'ft.top': 'Kembali ke permukaan',

  // Landing-only additions (mobile section + sound toggle).
  'mob.title': 'Di HP, kawanan yang sama.',
  'mob.lead':
    'Rancangan aplikasi HP Anchoa dari desain yang sama: beranda, asisten Ako, jurnal, keuangan, dan jadwal. Versi HP belum tersedia; Android masih direncanakan.',
  'mob.caption': 'Rancangan · data contoh · versi HP belum tersedia',
  'snd.on': 'Nyalakan suara',
  'snd.off': 'Matikan suara',
} as const;

export type TranslationKey = keyof typeof id;
export type Language = 'id' | 'en';

export const en: Record<TranslationKey, string> = {
  'nav.features': 'Features',
  'nav.how': 'How it works',
  'nav.eng': 'Engineering',
  'nav.download': 'Download',
  'nav.cta': 'Download',
  'hero.eyebrow': 'v0.18.0 · available on Fedora & Arch · Windows/Android planned',
  'hero.title': 'One school for <em>everything in your day.</em>',
  'hero.lead':
    'Anchoa brings tasks, schedules, money, journal, notes, habits, email, files and downloads together on your laptop. A dashboard and voice assistant help with your day.',
  'hero.cta1': 'Download for Fedora & Arch',
  'hero.cta2': 'View the code',
  'hero.hint':
    'move your cursor to scatter the school, click to feed it, scroll to dive',
  'term.l1': '› Module data stays in local SQLite.',
  'term.l2': '› Local assistant: Ollama · qwen2.5:3b',
  'term.l3': '› Assistant actions wait for approval or rejection.',
  'mock.caption':
    'Desktop and phone design concepts · sample data · the phone app is not available · app UI is in Indonesian',
  'zone.epi': 'epipelagic zone',
  'zone.meso': 'edge of the mesopelagic',
  'feat.title': 'Everything you handle every day, in one app.',
  'feat.lead':
    'Type a message or speak into the microphone. The assistant uses local Ollama to read today’s summary and propose actions for your approval.',
  'f1.t': 'Local voice assistant with Ollama',
  'f1.d':
    'Say “log lunch 35k” or “I worked out”. Whisper transcribes speech and Piper reads replies on your laptop. Changes to your data wait for approval.',
  'f1.c1': '# you',
  'f1.c2': '“create a task to send the report”',
  'f1.c3': '# anchoa',
  'f1.c4': 'Proposal: create a task · Approve / Reject',
  'f2.t': 'Calendar & tasks',
  'f2.d':
    'Month view, an 8-week timeline and project Kanban. Task deadlines and bills appear in Schedule; daily tasks also appear on the Dashboard.',
  'f3.t': 'Habits',
  'f3.d':
    'Check off today, choose active days, and view streaks and monthly history. Rest days keep your streak; reminders appear in the notification panel.',
  'f4.t': 'On-device journal',
  'f4.d':
    'Keep ideas, thoughts, tags and moods in local SQLite. Turn ideas into tasks. The database is not encrypted; journal content is not added to general chat context automatically.',
  'f5.t': 'Money',
  'f5.d':
    'Accounts, balances, 6-month cash flow, bills and a monthly spending limit. Enter transactions yourself or approve a proposal from the assistant.',
  'f6.t': 'Local files on your laptop',
  'f6.d':
    'Browse home and mounted devices, preview, copy or move files. Delete moves them to Trash. Access from a phone is still planned.',
  'f7.tag': 'for developers',
  'f7.t': 'Coding agents report into your project',
  'f7.d':
    'The agent board has Plan, Doing, Test, Review and Done columns. External agents report through the local CLI; an optional agent command runs when you send a request.',
  'f7.c1': '# in Anchoa',
  'f7.c2': 'Plans, progress and test results → task threads',
  'f7.c3': 'Without an agent command, tasks wait in Plan.',
  'f8.t': 'Downloads & email',
  'f8.d':
    'Direct files plus video/audio through yt-dlp and ffmpeg. One Gmail account over IMAP/SMTP with local Ollama summaries. The App Password stays in the system keyring; torrents are not supported yet.',
  'how.title': 'Local app data, an assistant on your laptop.',
  'how.lead':
    'Module data stays in SQLite on your laptop. Ollama runs the assistant locally; email and downloads contact their sources. Sync between devices is still planned.',
  'how.n1tag': 'desktop · Fedora · Arch',
  'how.n1a': 'Tauri 2 + React + Rust',
  'how.n1b': 'Module data read from the local database',
  'how.n1c': 'Assistant, email and download panels',
  'how.l1': 'Rust commands<br/>Local reads / writes',
  'how.n2tag': 'storage · local',
  'how.n2a': 'Tasks, money, journal and notes',
  'how.n2b': 'Daily and manual backups',
  'how.n2c': 'App Password separate in the keyring',
  'how.l2': 'Database file<br/>on device',
  'how.n3tag': 'your device',
  'how.n3t': 'Laptop',
  'how.n3a': 'Local folders and downloaded files',
  'how.n3b': 'Local voice: Whisper and Piper',
  'how.n3c': 'Ollama on localhost (optional)',
  'how.note':
    'Email uses Gmail servers and downloads use source sites. Device sync and Windows/Android are still planned.',
  'eng.title': 'Built with tests for flows and access boundaries.',
  'eng.lead':
    'The React frontend and Rust backend share one database. Tests cover PIN locking, email credentials, assistant proposals and local file operations.',
  'e1.t': 'PIN lock when the app opens',
  'e1.d':
    'A 4–8 digit PIN is stored as an Argon2id hash. App data access is blocked while locked; five mistakes trigger a 30-second delay.',
  'e2.t': 'App Password in the system keyring',
  'e2.d':
    'The Gmail App Password stays in the keyring. The optional GitHub token is in a local file with 0600 permissions, separate from the database and backups.',
  'e3.t': 'On-device database backups',
  'e3.d':
    'Daily and manual backups retain the latest seven files. The database and journal are not encrypted; the PIN locks app access.',
  'e4.t': 'Assistant proposals wait for approval',
  'e4.d':
    'Approve or reject before the assistant changes data. Coding agents use your chosen local command; command permissions follow that agent program.',
  'dl.title': 'Available on Fedora and Arch Linux.',
  'dl.lead':
    'The .rpm and .pkg.tar.zst packages are available on GitHub Releases. The Anchoa DNF repo (Fedora) and pacman repo (Arch Linux, CachyOS) are also available for installation and updates. Windows and Android are still planned.',
  'dl.ready': 'available',
  'dl.rpmT': 'Fedora · .rpm package',
  'dl.rpmD':
    'Download the latest .rpm from the releases page, then install it with dnf so its dependencies come along.',
  'dl.rpmBtn': 'Open GitHub Releases',
  'dl.soon': 'planned',
  'dl.dnfT': 'Anchoa DNF repository',
  'dl.dnfD':
    'Add the Anchoa repo once, install the package, then update through dnf upgrade.',
  'dl.archT': 'Arch Linux / CachyOS · pacman repository',
  'dl.archD':
    'Import the Anchoa GPG key, add the [anchoa] repo to pacman.conf, then install. Updates come with sudo pacman -Syu or paru. The AUR package anchoa-bin follows once it is published to the AUR.',
  'dl.flatD':
    'A Flatpak package is not available yet. Support for other Linux distributions is still planned.',
  'rm.title': 'Platform route',
  'rm.note': 'order may change',
  'rm.s1': '.rpm · DNF repo · pacman repo · available',
  'rm.l2': 'Other Linux',
  'rm.s2': 'packages not available yet',
  'rm.s3': 'planned',
  'rm.s4': 'not available yet',
  copy: 'Copy',
  'faq.title': 'Frequently asked questions',
  q1: 'Is Anchoa free?',
  a1: 'Anchoa uses a local Ollama assistant without an AI API key. If you choose an external agent program, its own costs and services apply.',
  q2: 'Where is my data stored?',
  a2: 'Module data lives in local SQLite on your laptop. Files and downloads stay on disk, and the Gmail App Password stays in the keyring. The database and journal are not encrypted; device sync is not available yet.',
  q3: 'Does it need internet?',
  a3: 'Local modules and Ollama work offline once models are installed. Email, downloads, GitHub contribution refreshes, release checks and model installation need a connection.',
  q4: 'Why is it called Anchoa?',
  a4: 'Anchoa is Spanish for anchovy. A school of anchovies represents daily tasks connected within one application.',
  q6: 'Can I use it on Windows, macOS or Ubuntu?',
  a6: 'Not yet. Version 0.18.0 is available for Fedora Linux (.rpm and DNF repo) and for Arch Linux and CachyOS (pacman repo). Windows and Android are planned; other platforms are not available yet.',
  q5: 'Can I change the avatar?',
  a5: 'Not yet. The current avatar is a static school of anchovies. The Avatar Live2D settings section is informational; Live2D model import is not available.',
  'au.eyebrow': 'behind Anchoa',
  'au.title': 'The Anchoa project',
  'au.d':
    'A desktop app using React, Tauri 2, Rust and SQLite. Code and specs are available in the repository; current features follow the implementation in version 0.18.0.',
  'au.port': 'Repository',
  'g.title': 'Who swims on this page',
  'g.lead':
    'Ordered from the surface down. Lanternfish usually live deeper and rise at night.',
  'g.n1': 'Green sea turtle',
  'g.d1':
    'Passes by near the surface now and then. It has to come up to breathe.',
  'g.n2': 'Moon jellyfish',
  'g.d2': 'Drifts by pulsing its bell. The anchovy school steers clear.',
  'g.n3': 'Anchovy',
  'g.d3': 'The main school, plankton feeders. Click to feed them.',
  'g.n4': 'Kawakawa (mackerel tuna)',
  'g.d4':
    'Hunts anchovies. When it arrives, the school tightens into a bait ball.',
  'g.n5': 'Reef manta ray',
  'g.d5': 'Glides slowly through mid-water, filtering plankton.',
  'g.n6': 'Lanternfish',
  'g.d6':
    'Shows up as you dive toward 200 m. Its glowing dots are called photophores.',
  'ft.live2d': 'The app avatar is still static. Live2D support is planned.',
  'ft.top': 'Back to the surface',

  'mob.title': 'The same school, on your phone.',
  'mob.lead':
    'Anchoa phone designs from the same design work: home, the Ako assistant, journal, finance and schedule. The phone app is not available yet; Android is planned.',
  'mob.caption': 'Concept · sample data · the phone app is not available',
  'snd.on': 'Turn on sound',
  'snd.off': 'Turn off sound',
};
