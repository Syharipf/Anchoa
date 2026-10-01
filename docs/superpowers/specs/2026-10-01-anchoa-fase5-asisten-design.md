# Anchoa Fase 5 — Asisten

Tanggal: 2026-10-01
Status: keputusan utama dari user (2026-10-01 23:08–23:16, lihat §2 "Dari user"). Detail teknis diputuskan Claude semalam dan bisa diubah nanti.

## 1. Ringkasan

Panel asisten di Dashboard (`AssistantStage`) dan di halaman lain (`AssistantMini`) sudah ada sebagai UI tanpa otak. Fase ini memberinya:
1. **Otak lokal**: model di Ollama, dengan peran yang dibatasi, dan aksi lewat command Rust yang sama yang selalu menunggu persetujuan.
2. **Suara lokal**: whisper.cpp untuk STT dan Piper untuk TTS. Suaranya natural, bisa dipilih, dan bisa diimpor.
3. **Pengaturan**: bagian Asisten & AI, Suara, dan Avatar di Pengaturan diisi.

Avatar tetap statis (kawanan teri yang sudah ada). Live2D menunggu cek lisensi.

## 2. Keputusan

### Dari user

| Kode | Keputusan |
|---|---|
| U1 | Penyedia: Ollama lokal dulu. API pihak ketiga gratis (OpenRouter, opencode, 9router, dll.) menyusul. "Fokus yang lokal dulu, supaya rolenya bisa discope." |
| U2 | Model default: `qwen2.5:3b` di Ollama. User memasang Ollama sendiri. |
| U3 | STT: whisper.cpp lokal (paket Fedora `whisper-cpp`) dengan model `base`. TTS: Piper lokal yang diunduh oleh Anchoa. |
| U4 | Suara TTS tidak boleh kaku. User bisa memilih suara dan mengimpor model suara sendiri. |
| U5 | Avatar statis dulu. |
| U6 | Aksi AI hanya dijalankan setelah user menyetujuinya. |

### Dari Claude

| Kode | Keputusan | Alasan |
|---|---|---|
| C1 | Satu klien HTTP **OpenAI-compatible chat completions** (`POST {base}/chat/completions`, streaming SSE, tools). Ollama menyediakan endpoint ini di `http://127.0.0.1:11434/v1`. Penyedia lain nanti cukup menambah `base_url` dan kunci di keyring, tanpa klien kedua. | Satu kode untuk lokal dan remote. |
| C2 | **Peran (role)**: `chat` (percakapan dan aksi), `journal` (tanggapan jurnal), `recap` (rekap harian). Setiap peran punya penyedia dan model sendiri di tabel `settings` (`ai.<role>.provider`, `ai.<role>.model`). Fase ini hanya punya penyedia `ollama`. Peran `journal` dikunci ke penyedia lokal, dan aturan ini ditegakkan di Rust. | Ini yang dimaksud user dengan "rolenya bisa discope". |
| C3 | **Tools** untuk peran `chat`. Tool baca langsung dijalankan: `today_overview`, `search_items`, `list_tasks`. Tool tulis menjadi **usulan**: `create_task`, `complete_task`, `add_transaction`, `add_journal_entry`, `check_habit`. Usulan disimpan di memori, lalu UI menampilkan kartu "Setujui / Tolak". Setujui menjalankan fungsi Rust yang sama dengan UI. Tolak memberi tahu model. Tidak ada tool hapus. | U6, dan aturan CLAUDE.md "AI memanggil command yang sama". |
| C4 | **Konteks**: prompt sistem berbahasa Indonesia dengan tanggal dan jam lokal (dari Rust), nama profil, dan ringkasan singkat hari ini (tugas, tagihan, habit). Isi jurnal tidak pernah dikirim ke peran `chat`. | Jawaban yang relevan, dan privasi jurnal. |
| C5 | **Riwayat** percakapan hanya ada di memori proses dan hilang saat app ditutup. Sakelar "Simpan riwayat" ditunda. | Default paling privat. |
| C6 | **Streaming** token ke UI lewat `tauri::ipc::Channel`. Ada tombol Hentikan. Timeout koneksi 5 detik, dan timeout tanpa token 60 detik. | Model 3B di CPU butuh beberapa detik, jadi streaming terasa cepat. |
| C7 | **Rekam suara** lewat subprocess `pw-record` (PipeWire, bawaan Fedora): 16 kHz mono s16 ke WAV sementara. Mulai dan berhenti dari tombol mikrofon. Batas 60 detik. | Lebih andal daripada `getUserMedia` di WebKitGTK. Tanpa dependency baru. |
| C8 | **STT**: `whisper-cli -m <model> -l id -nt -f <wav>` (nama binary dicek saat runtime: `whisper-cli`, lalu `whisper-cpp`). Model `ggml-base.bin` diunduh oleh Anchoa dari Hugging Face `ggerganov/whisper.cpp` ke `<data>/models/whisper/`, dengan SHA-256 tetap di kode. | U3. |
| C9 | **TTS Piper**: binary resmi `piper_linux_x86_64.tar.gz` (rilis `2023.11.14-2` dari GitHub `rhasspy/piper`) dan suara dari Hugging Face `rhasspy/piper-voices`, diunduh ke `<data>/piper/` dengan SHA-256 tetap di kode. Katalog bawaan: `id_ID-news_tts-medium`, plus beberapa suara `en_US` kualitas medium/high sebagai pilihan. Impor: pasangan `.onnx` dan `.onnx.json` milik user, divalidasi (JSON terbaca, `audio.sample_rate` ada, ukuran < 200 MB). | U3 dan U4. |
| C10 | **Kealamian suara (U4)**: parameter per suara disimpan di `settings`: `length_scale` (kecepatan, 0,8–1,3), `noise_scale` (ekspresi, 0,3–0,9), dan `noise_w` (variasi durasi, 0,5–1,0). Default `noise_scale 0,667` dan `noise_w 0,8`. Teks dipecah per kalimat dan diputar berurutan, sehingga jeda terasa alami dan kalimat pertama cepat terdengar. Ada tombol "Coba suara". espeak-ng tidak pernah jadi default. | Piper medium/high dengan noise yang pas jauh lebih natural daripada espeak. |
| C11 | **Putar audio** lewat `pw-play <wav>`. Bisa dihentikan, misalnya saat mikrofon ditekan lagi. | Bawaan PipeWire. |
| C12 | **Unduhan model** memakai mesin unduhan yang sama dengan modul Unduhan kalau cocok. Kalau tidak cocok, pakai `ureq` dengan progres, dan berkas `.part` di-rename setelah hash cocok. | Tidak ada model rusak yang dipakai. |
| C13 | **Pengaturan**: bagian Asisten & AI, Suara, dan Avatar diisi. Detailnya di §4. | Mengganti panel "Menyusul" dari fase Pengaturan. |

## 3. Backend

```
src-tauri/src/assistant/
  mod.rs        // AssistantState { history, pending proposals, cancel flag }
  llm.rs        // klien OpenAI-compatible: stream_chat(base, key?, model, messages, tools, on_delta) -> Message
  roles.rs      // RoleConfig dari settings; validasi journal = lokal
  tools.rs      // definisi tool (JSON schema) + eksekusi baca + pembuatan usulan
  context.rs    // prompt sistem + ringkasan hari ini
  voice.rs      // pw-record, whisper-cli, piper, pw-play, unduhan model + SHA-256
```

Command:
- `assistant_send(text, channel)`: streaming, mengembalikan pesan akhir plus usulan;
- `assistant_stop()`;
- `assistant_decide(proposal_id, approve)`;
- `assistant_reset()`;
- `ai_status()`: Ollama terjangkau, daftar model dari `/api/tags`;
- `ai_roles()` dan `set_ai_role(role, provider, model)`;
- `voice_status()`: pw-record, whisper, model, piper, dan suara mana yang ada;
- `voice_install(component)`: unduhan dengan event progres;
- `voice_record_start()`, `voice_record_stop()` (lalu teks hasil STT);
- `voice_speak(text)`, `voice_stop()`;
- `voice_voices()`, `voice_import(onnx_path)`, `set_voice(id, params)`.

## 4. UI

- **AssistantStage dan AssistantMini:**
  - mode ketik mengirim ke `assistant_send`;
  - caption menampilkan stream jawaban;
  - kartu usulan dengan Setujui dan Tolak;
  - tombol Hentikan.
  - Mikrofon: tekan untuk merekam (`listening`), tekan lagi untuk berhenti. Teks hasil STT dikirim, lalu jawabannya dibacakan (`speaking`). Caption selalu tampil.
  - Kalau Ollama tidak terjangkau, kartu state berbunyi "Ollama belum berjalan", dengan perintah `sudo systemctl start ollama` dan tautan ke Pengaturan.
- **Pengaturan › Asisten & AI:**
  - status Ollama;
  - pilihan model per peran (dari `/api/tags`);
  - Tes koneksi;
  - catatan "Penyedia pihak ketiga (OpenRouter, dll.) menyusul";
  - privasi: jurnal hanya ke model lokal (terkunci nyala).
- **Pengaturan › Suara:**
  - status whisper dan Piper, dengan tombol Pasang (progres unduhan);
  - pilihan suara: katalog dan suara impor;
  - Impor suara (.onnx + .onnx.json);
  - slider kecepatan, ekspresi, dan variasi;
  - "Coba suara";
  - uji mikrofon.
- **Pengaturan › Avatar:** "Avatar statis (kawanan teri). Live2D menyusul setelah cek lisensi Cubism."

## 5. Testing

- **Rust:**
  - klien LLM melawan server HTTP palsu (`TcpListener` di thread test): stream SSE, tool call, error 4xx/5xx, timeout;
  - peran: `journal` menolak penyedia non-lokal;
  - tools: tool tulis menjadi usulan dan tidak menyentuh DB sampai disetujui; Setujui membuat tugas; Tolak tidak mengubah data;
  - voice: pembentukan argumen `whisper-cli` dan `piper`, pemecahan kalimat, validasi impor, cek SHA-256 (berkas salah ditolak).
- **Frontend:** reducer state asisten (`idle`/`listening`/`speaking`, stream, usulan), label peran.
- **E2E:** Xvfb tanpa Ollama dan tanpa suara.
  - `check_assistant` memeriksa kartu "Ollama belum berjalan".
  - Dengan `ANCHOA_AI_BASE` menunjuk ke server palsu di skrip (`python3 -m http.server` tidak cukup, jadi pakai skrip Python kecil yang menjawab SSE), kirim "buat tugas beli teri", cek kartu usulan, klik Setujui, lalu cek tugasnya ada di DB.

## 6. Rencana PR

| PR | Isi | Versi |
|---|---|---|
| 5-1 (#103) | `assistant/` llm, roles, tools, context, dan command (tanpa suara), plus test | — |
| 5-2 (#104) | UI chat di Stage/Mini, kartu usulan, Pengaturan › Asisten & AI, E2E | 0.13.0 |
| 5-3 (#105) | `voice.rs`: rekam, STT, Piper, unduhan, impor, plus test | — |
| 5-4 (#106) | UI suara, Pengaturan › Suara dan Avatar, E2E | 0.14.0 |
