# Roadmap `anchoa-app`

Kerjakan berurutan. Setiap fase punya **Selesai jika**. Centang `[x]` saat selesai. **⚑** = butuh keputusan pengguna.
Fase yang bergantung pada repo `anchoa-supabase` ditandai **↔**.

---

## Fase 0 — Uji coba Live2D & performa  ⚑ gerbang keputusan

- [ ] Scaffold sesuai `CLAUDE.md` (adapter-static + `fallback: 'index.html'`, `ssr = false`, Svelte 5).
- [ ] Halaman `/spike`: satu model Live2D dari `static/live2d/`, cincin kawanan teri (CSS `transform`), 4 batang gelombang suara, tombol idle ↔ aktif, overlay FPS.
- [ ] Ukur di **Linux** (GPU bawaan & NVIDIA bila hybrid) dan **Android**: FPS, CPU, RAM saat idle & aktif.
- [ ] Tulis `docs/spike-report.md`.

**Selesai jika:** laporan ada dan pengguna memutuskan ⚑ lanjut Tauri atau rencana cadangan (avatar statis di perangkat lemah). Target kasar: ≥ 50 fps aktif di desktop, mulus di Android, CPU idle mendekati 0%.

---

## Fase 1 — Fondasi & kerangka (data mock)

- [ ] `src/lib/styles/tokens.css` + `src/app.css`.
- [ ] `+layout.svelte`: Nav kiri (9 menu + Notifikasi, Profil, Pengaturan; tooltip; badge), TopBar (tombol palette + jam).
- [ ] Route: `/`, `/jurnal`, `/email`, `/jadwal`, `/habit`, `/keuangan`, `/proyek`, `/berkas`, `/unduhan`, `/profil`, `/pengaturan`, `/masuk`, `/penyiapan` (judul saja).
- [ ] Komponen state bersama (kosong, bilah offline, kartu error) sesuai artboard `State`.
- [ ] Command palette (tombol + `Ctrl+K` di window): filter, ↑↓/Enter/Esc, grup, "Tanya asisten", ARIA combobox/listbox.
- [ ] Panel notifikasi (mock), AssistantMini (default tertutup) di semua halaman kecuali Dashboard.
- [ ] Komponen UI dasar di `lib/components/ui/`.
- [ ] Reduced-motion & pause saat tab tersembunyi berlaku global.

**Selesai jika:** navigasi & overlay jalan dengan keyboard, `npm run check` bersih, cocok dengan screenshot.

---

## Fase 2 — Dashboard & asisten (UI, mock)

- [ ] `lib/state/assistant.svelte.ts`: `idle | listening | speaking`, caption, mode ketik.
- [ ] `AssistantPanel`: stage avatar (placeholder), FishRing, status + VoiceWave, caption, chip aksi, tombol keyboard/mikrofon/riwayat.
- [ ] Strip kontribusi (heatmap bulanan mini, total, % vs bulan lalu, streak, ‹ ›).
- [ ] Dashboard rekap: sapaan, "Dengarkan rekap", 5 pintasan, bento 7 kartu.

**Selesai jika:** kartu menaut ke modulnya, state asisten benar, animasi berhenti saat idle.

---

## Fase 3 — Tersambung ke Supabase ↔ (butuh Fase A–B di `anchoa-supabase`)

- [ ] `@supabase/supabase-js`, `src/lib/api/supabase.ts`, `.env.local` dari `supabase status` (Supabase lokal).
- [ ] `npm run gen:types` → `database.types.ts` di-commit.
- [ ] Auth sesuai artboard `Login`: email+sandi, magic link, GitHub OAuth; sign-up dimatikan; sesi disimpan aman (⚑ usulkan cara: plugin keyring/Stronghold di desktop, Keystore di Android).
- [ ] Penyiapan pertama (`Onboarding`) muncul sekali setelah login pertama; semua langkah bisa dilewati.
- [ ] Pengaturan › Sinkron & data dan › Laptop (SFTP) memakai data nyata (status, cache, perangkat terdaftar, cabut akses).
- [ ] Fungsi bertipe per domain di `src/lib/api/`: tasks, projects, events, finance, journal, habits, notifications, settings.
- [ ] Realtime: daftar tugas & notifikasi ter-update otomatis; langganan dibersihkan.
- [ ] **Cache baca lokal**: ⚑ pilih penyimpanan (usulan: IndexedDB untuk mulai cepat, atau SQLite lewat Rust agar bisa dipakai ulang untuk antrean offline nanti). Pola: tampilkan cache → ambil dari Supabase → perbarui cache; Realtime memperbarui cache.
- [ ] Query hemat: kolom seperlunya, rentang tanggal, pagination.
- [ ] Ganti mock di Dashboard dengan data asli.

**Selesai jika:** data tersimpan & sinkron antar dua jendela app; pengguna lain (akun uji) tidak bisa melihat data (dibuktikan oleh test RLS di repo Supabase); membuka ulang app menampilkan data dari cache sebelum jaringan selesai.

---

## Fase 4 — Jadwal, Habit, Jurnal, Proyek, Keuangan

- [ ] Jadwal: Kalender bulanan + agenda, Timeline 8 minggu, filter 3 jenis.
- [ ] Habit: centang hari ini, 7 hari terakhir, streak (hanya hari terjadwal), heatmap bulanan per habit, pengingat (jam + hari) → notifikasi lokal di perangkat; "Tulis jurnal" tercentang otomatis bila ada entri Jurnal hari itu.
- [ ] Jurnal: daftar + filter jenis, editor (jenis, suasana hati 1–5, tag), autosave draf di perangkat, pemantik, ide → tugas.
- [ ] Jurnal **terenkripsi di perangkat** (⚑ usulkan skema: kunci acak disimpan di keyring/Keystore, dibuka dengan PIN; algoritme mis. XChaCha20-Poly1305). Pencarian jurnal hanya lokal (di atas cache terdekripsi).
- [ ] Proyek: daftar + kanban 3 kolom + tenggat terdekat.
- [ ] Keuangan: ringkasan, arus kas 6 bulan, transaksi, akun, tagihan.

**Selesai jika:** semua CRUD jalan lewat `src/lib/api/`, tampilan cocok dengan screenshot (`/cek-desain`).

---

## Fase 5 — Suara & AI ↔ (butuh `ai-gateway` + `ai-config` di `anchoa-supabase`)

- [ ] Pengaturan › Asisten & AI: pilih penyedia, simpan kunci (dikirim sekali ke `ai-config`, app tidak pernah membacanya kembali), *Tes koneksi* dengan 5 hasil (ok/401/429/belum ada/menguji), model per tugas, pemakaian dari `ai_usage`.
- [ ] **Ollama lokal dipanggil langsung dari perangkat** lewat Tailscale (command Rust `local_llm`), bukan lewat `ai-gateway` — Edge Function di cloud tidak bisa menjangkau jaringan Tailscale. Dipakai untuk "Tanggapan jurnal" bila sakelar *Jurnal hanya ke model lokal* aktif.
- [ ] Pengaturan › Suara: STT/TTS lokal vs cloud, pilih mikrofon + meter level.

- [ ] Rekam mikrofon di Rust; STT: ⚑ lokal (whisper.cpp) di desktop atau lewat `ai-gateway`.
- [ ] TTS: ⚑ lokal (Piper, cek kualitas bahasa Indonesia) atau lewat `ai-gateway`.
- [ ] Intent dasar lewat `ai-gateway`: buka halaman, tambah tugas, catat transaksi, rekap hari ini, **centang habit**, **dikte entri Jurnal**.
- [ ] Jurnal "Minta tanggapan": kirim teks terdekripsi **hanya entri itu** ke `ai-gateway` atas permintaan eksplisit; tanggapan tidak disimpan di server.
- [ ] Kata pemanggil "Hai Anchoa" — opsional, default mati di Android.

---

## Fase 6 — Berkas + akses laptop

- [ ] Berkas lokal: listing dengan validasi path, ikon/daftar, breadcrumb, multi-pilih + bar aksi.
- [ ] Pratinjau (1 item): gambar, video (tanpa autoplay), PDF (pdf.js per halaman), teks, folder; thumbnail untuk item terlihat + cache.
- [ ] **Lokasi "Laptop"**: klien SFTP (Rust) ke laptop lewat Tailscale; status online/offline; pratinjau bertahap; "Simpan ke HP".
- [ ] Kredensial SFTP (SSH key) di keyring/Keystore.
- [ ] Panduan setup laptop di `docs/sftp-laptop.md` (sshd, user chroot, key-only, firewalld hanya `tailscale0`, ACL Tailscale).

---

## Fase 7 — Unduhan (di perangkat)

- [ ] File langsung: `reqwest` + resume (Range).
- [ ] Media: desktop → yt-dlp + ffmpeg sidecar; Android → plugin Kotlin `youtubedl-android`.
- [ ] Pembaruan yt-dlp otomatis.
- [ ] Torrent (`librqbit`) di balik flag, default mati.
- [ ] Antrean, tab, status; notifikasi lokal saat selesai.

---

## Fase 8 — Email (IMAP/SMTP di perangkat)

- [ ] IMAP baca + SMTP kirim di Rust; kredensial hanya di keyring/Keystore.
- [ ] Tiga kolom, ringkasan & saran balasan lewat `ai-gateway` (hanya teks email yang dikirim, bukan kredensial), dikte suara.
- [ ] Aksi kontekstual: tambah ke Jadwal, tandai tagihan lunas.

---

## Fase 9 — Android penuh

- [ ] `npm run tauri android init`, ikon & identifier.
- [ ] Komponen **dok + roda menu** (`WheelNav.svelte`): dok ringkas (Cari · Menu · Mic); tap Menu membuka roda dengan scrim; geser kiri/kanan + snap, tombol ‹ ›; tap item = putar lalu buka; kawanan teri ikut berputar (berhenti setelah 6 s diam); Back Android menutup roda. Test: TalkBack/keyboard dan `prefers-reduced-motion`.
- [ ] Layout HP untuk **semua** menu sesuai artboard `Hp*` (19 artboard): Beranda, Asisten, Cari, Notifikasi, Jurnal, Habit, Jadwal, Keuangan, Proyek, Agen kode, Email + Baca, File laptop, Unduhan, Pengaturan + AI, Profil, Masuk.
- [ ] Unduhan di Android: youtubedl-android (⚑ cek lisensi & ukuran APK), torrent mati bawaan.
- [ ] Push (FCM lewat `kirim-push`) — ⚑ perlu atau cukup notifikasi saat app terbuka.
- [ ] Uji di minimal 2 perangkat.

---

## Fase 10 — Offline penuh, Live2D penuh, rilis

- [ ] Antrean aksi saat offline di atas cache lokal (pakai `updated_at`/`deleted_at`), dikirim ulang saat online.
- [ ] Live2D di AssistantPanel, lip-sync sederhana, render loop berhenti saat idle; popup mini pakai gambar statis.
- [ ] Pengaturan › Avatar Live2D: impor model (.zip → validasi model3.json, versi moc3, ukuran tekstur, gerakan idle, parameter mulut/kedip), pratinjau + Uji bicara, FPS maks, fallback statis otomatis bila < 30 fps. File model disimpan di perangkat (bukan Supabase).
- [ ] Layar loading < 2 detik.
- [ ] ⚑ Cek lisensi Cubism SDK sebelum rilis publik.
- [ ] Paket: `.rpm`/AppImage, `.apk`/`.aab`, `.msi`.

---

## Fase 11 — Agen kode di Proyek (opsional) ↔ (butuh Fase G di `anchoa-supabase`)

Detail: `docs/agent-integration.md`. Bagian 11b boleh ditunda/dibatalkan.

**11a — Mencatat (agen → Anchoa)**
- [ ] Tab **Agen kode** di Proyek sesuai `ProyekAgen`: aktivitas per sesi (rencana, tugas, file, tes, izin), filter, lencana status di header.
- [ ] Dialog **Hubungkan agen** (`ProyekAgenHubungkan`): buat/cabut token (scope per proyek), salin perintah `claude mcp add …`, snippet CLAUDE.md.
- [ ] Tugas dari `plan_create` tampil di Kanban dengan lencana "dari agen".
- [ ] `anchoa-hook` (shell + curl) untuk hooks SessionStart/Stop/SessionEnd dan git post-commit.

**Selesai jika:** sesi Claude Code nyata di repo `anchoa-app` membuat rencana → muncul di Kanban; tes yang dilaporkan muncul di aktivitas; token yang dicabut langsung ditolak.

**11b — Memerintah (Anchoa → agen)** ⚑ keputusan pengguna sebelum mulai
- [ ] Panel **Kirim ke agen**: pilih agen + folder, mode (Rencana saja / Minta izin / Edit otomatis), perintah cepat, dikte; masuk ke `agent_commands`.
- [ ] Mode **Agen kode** di asisten (ucapan → perintah, dengan konfirmasi).
- [ ] Runner di desktop: sidecar Claude Agent SDK, `canUseTool` → `agent_approvals`, Realtime, abort untuk *Hentikan*. Pemetaan proyek → folder hanya di laptop.
- [ ] HP: layar `HpAgen` (izin + status + perintah cepat), notifikasi push untuk izin.
- [ ] Semua aturan keamanan di `docs/agent-integration.md` bagian B.

**Selesai jika:** dari HP, perintah "Rencana saja" menghasilkan rencana di Kanban; permintaan `npm install` muncul di HP, ditolak dari HP, dan agen benar-benar tidak menjalankannya.
