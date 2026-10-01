# Anchoa Fase 5 Asisten: Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Implementasi utama oleh Codex gpt-6.1-sol xhigh. Kalau kuotanya habis, pakai Gemini 3.8 Flash High lewat `agy-multi`, lalu agen `implementer`. Review oleh Gemini dan Sol, lalu dicek sesi Opus.

**Goal:** Asisten lokal dengan Ollama (`qwen2.5:3b`), peran yang dibatasi, aksi lewat persetujuan, serta suara lokal (whisper.cpp dan Piper) yang natural, bisa dipilih, dan bisa diimpor.

**Spec:** `docs/superpowers/specs/2026-10-01-anchoa-fase5-asisten-design.md` (U1–U6, C1–C13). Baca seluruhnya.

## Global Constraints

- Semua aturan di `CLAUDE.md` berlaku: SonarCloud, tanpa panic, `src/api.ts` sebagai satu-satunya pemanggil `invoke()`, query menyaring baris terhapus, dan hari dihitung di Rust.
- Dependency baru hanya crate mapan, dan disebut di body PR beserta alasannya. Yang sudah disetujui: `sha2` untuk SHA-256 unduhan model.
- `Db::conn()` tidak boleh dipegang selama panggilan HTTP atau subprocess.
- Tool tulis tidak pernah mengubah DB sebelum `assistant_decide(id, true)`.
- Isi jurnal tidak pernah masuk ke prompt peran `chat`.
- Test tidak boleh butuh Ollama, mikrofon, atau internet. Pakai server palsu di `TcpListener`, dan binary palsu berupa skrip shell di tempdir.
- Nama rilis: "Anchoa v0.13.0 — Asisten" dan "Anchoa v0.14.0 — Suara asisten".

## Pembagian PR

| PR | Task |
|---|---|
| 5-1 (#103) | 1–3 |
| 5-2 (#104) | 4–5 |
| 5-3 (#105) | 6–7 |
| 5-4 (#106) | 8–9 |

---

### Task 1: `assistant/llm.rs`, klien OpenAI-compatible

- `stream_chat(cfg: &Endpoint, req: &ChatRequest, cancel: &AtomicBool, on_delta: impl FnMut(&str)) -> Result<ChatMessage, AppError>`.
- `Endpoint { base_url, api_key: Option<String> }`. Base dari `ANCHOA_AI_BASE`, untuk E2E, atau default `http://127.0.0.1:11434/v1`.
- SSE: baris `data: {...}` dan `data: [DONE]`. Gabungkan `delta.content` dan `delta.tool_calls` (argumen bisa datang terpotong).
- Timeout koneksi 5 detik dan timeout baca 60 detik. Pesan error dalam bahasa Indonesia, misalnya "Ollama belum berjalan di 127.0.0.1:11434".
- `list_models(base)`: `GET {root}/api/tags` (khusus Ollama), mengembalikan nama model.

**Test** (server palsu `TcpListener`):
- `streams_content_deltas`;
- `assembles_split_tool_call_arguments`;
- `reports_connection_refused_in_indonesian`;
- `http_error_status_is_an_error`;
- `cancel_stops_reading`.

**Commit:** `feat: add an OpenAI-compatible chat client`.

### Task 2: peran, konteks, dan tools

- `roles.rs`: `RoleConfig { provider: "ollama", model }` untuk `chat`, `journal`, dan `recap` dari tabel `settings`, dengan default `qwen2.5:3b`. `set_role` menolak penyedia non-lokal untuk `journal`.
- `context.rs`: `system_prompt(conn, now, tz) -> String` dalam bahasa Indonesia, dengan tanggal dan jam lokal, nama profil, serta tugas dan tagihan hari ini dan habit yang belum dicentang (pakai fungsi `dashboard`/`habits` yang sudah ada). Tanpa jurnal.
- `tools.rs`:
  - definisi JSON schema untuk tool di spec C3;
  - `run_read(conn, name, args)`;
  - `propose(name, args) -> Proposal { id, summary, name, args }` dengan ringkasan bahasa Indonesia, misalnya "Buat tugas “Beli teri” · tenggat besok";
  - `apply(conn, proposal, now, tz)` memanggil fungsi modul yang sudah ada (`tasks::create_task`, `finance` untuk transaksi, `journal::create_entry`, `habits` untuk check).

**Test:**
- `journal_role_rejects_remote_provider`;
- `prompt_has_local_date_and_no_journal`;
- `write_tool_becomes_a_proposal_without_db_change`;
- `apply_create_task_creates_it`;
- `unknown_tool_is_an_error`.

**Commit:** `feat: add assistant roles, context and tools`.

### Task 3: `AssistantState` dan command

- `AssistantState` di `app.manage`: riwayat pesan, usulan tertunda, dan flag batal.
- `assistant_send(text, on_event: Channel<AssistantEvent>)`. Event: `Delta(text)`, `Proposal(p)`, `Done(message)`, `Error(msg)`.
  - Alurnya: tambah pesan user, panggil LLM dengan tools, jalankan tool baca dan ulangi (maks 4 putaran), simpan tool tulis sebagai usulan, lalu kirim `Done`.
  - Jangan pegang `Db` saat HTTP.
- `assistant_decide(id, approve)`:
  - Setujui menjalankan `apply`, menambah pesan tool `{"ok":true,...}`, dan mengembalikan item yang dibuat.
  - Tolak menambah pesan tool `{"ok":false,"reason":"ditolak user"}`.
- `assistant_stop`, `assistant_reset`, `ai_status`, `ai_roles`, `set_ai_role`.
- Wrapper `src/api.ts`, dengan `Channel` dari `@tauri-apps/api/core`.

**Test:** satu putaran penuh melawan server palsu: tool baca lalu jawaban, dan tool tulis lalu usulan, lalu Setujui, lalu tugas ada.
**Commit:** `feat: wire the assistant commands`.
**Penutup PR 5-1:** `cargo test`, clippy, `bun run typecheck`, `bun run test`, dan E2E penuh `PASS`.

---

### Task 4: UI chat

- `src/assistant/useAssistant.ts`:
  - reducer state (`idle`/`listening`/`speaking`/`thinking`, pesan, stream, usulan, error);
  - memanggil `api.assistantSend` dengan Channel, dan buang event lama kalau ada permintaan baru.
- `AssistantStage` dan `AssistantMini`:
  - mode ketik mengirim;
  - caption stream;
  - daftar pesan ringkas;
  - kartu usulan Setujui dan Tolak;
  - Hentikan;
  - kartu "Ollama belum berjalan" dengan perintah dan tautan Pengaturan › Asisten & AI.
  - Setelah Setujui, panggil `onChanged` supaya Dashboard dimuat ulang.
- Hanya token tema, tanpa warna arbitrer. Aturan SonarCloud.

**Test:** reducer, dan bahwa kartu usulan memanggil `assistantDecide`.
**Commit:** `feat: chat with the assistant from the stage and mini panel`.

### Task 5: Pengaturan › Asisten & AI dan E2E (sesi Opus)

- `src/settings/AiSection.tsx` menggantikan ComingSection untuk `ai`, sesuai spec §4. Status kecil sub-nav: "Ollama · qwen2.5:3b" atau "Ollama mati".
- E2E `check_assistant_ai`:
  - tanpa server: kartu "Ollama belum berjalan";
  - dengan `ANCHOA_AI_BASE` ke server SSE palsu (`scripts/fake-llm.py`) yang membalas tool call `create_task("Beli teri")`: kartu usulan muncul, Setujui, lalu tugas "Beli teri" ada di DB.
- Versi 0.13.0 dan status di `CLAUDE.md`.

**Commit:** `test: cover the assistant end to end; bump version to 0.13.0`.
**Penutup PR 5-2**, lalu rilis.

---

### Task 6: rekam, STT, dan unduhan model

- `voice.rs`:
  - `Recorder`: `pw-record --rate 16000 --channels 1 --format s16 <tmp>.wav`, dengan stop lewat SIGINT, lalu kill setelah 2 detik, dan batas 60 detik;
  - `find_whisper()`: `whisper-cli`, lalu `whisper-cpp`, lalu `None`;
  - `transcribe(model, wav) -> String`: `-l id -nt -f`, lalu trim;
  - `Download { url, sha256, dest }`: berkas `.part`, cek SHA-256 (`sha2`), lalu rename, dengan event progres.
- URL dan SHA-256 tetap untuk `ggml-base.bin` diisi sesi Opus di konstanta. Jangan menebak hash.
- Command: `voice_status`, `voice_install("whisper-model")`, `voice_record_start`, `voice_record_stop`.

**Test:**
- binary palsu (skrip shell) untuk `pw-record` dan `whisper-cli`: argumen benar dan teks dikembalikan;
- hash salah menghapus `.part` dan menghasilkan error;
- `find_whisper` saat binary tidak ada.

**Commit:** `feat: record speech and transcribe it with whisper.cpp`.

### Task 7: Piper TTS

- Instal Piper: tarball resmi ke `<data>/piper/bin/`, dengan SHA-256 tetap (diisi sesi Opus).
- Katalog suara: konstanta `[{ id, label, url_onnx, sha_onnx, url_json, sha_json }]`, untuk `id_ID-news_tts-medium` dan 2–3 suara `en_US` medium/high.
- `voice_import(onnx_path)`: salin `.onnx` dan `.onnx.json` di sebelahnya ke `<data>/piper/voices/custom/`, validasi seperti di spec C9, lalu kembalikan id.
- `speak(text, voice, params)`:
  - pecah per kalimat;
  - `piper --model <onnx> --length_scale x --noise_scale y --noise_w z --output_file <tmp>.wav` dengan teks lewat stdin;
  - putar `pw-play` berurutan;
  - bisa dihentikan.
- `settings`: `voice.id`, `voice.length_scale`, `voice.noise_scale`, `voice.noise_w`, dengan rentang dan default seperti di spec C10, dijepit ke rentang itu.
- Command: `voice_voices`, `voice_import`, `set_voice`, `voice_speak`, `voice_stop`, `voice_install("piper"|"voice:<id>")`.

**Test:**
- pemecahan kalimat (titik, tanya, seru, singkatan "dll.", angka desimal);
- argumen piper dan penjepitan parameter;
- impor menolak `.onnx` tanpa json atau dengan json tanpa `audio.sample_rate`;
- `speak` memanggil binary palsu berurutan dan berhenti saat dihentikan.

**Commit:** `feat: speak with Piper voices that can be picked and imported`.
**Penutup PR 5-3.**

---

### Task 8: UI suara

- Mikrofon di Stage dan Mini:
  - tekan: `voice_record_start` dan mode `listening`;
  - tekan lagi: stop, lalu teks dikirim ke asisten, lalu jawaban di-`voice_speak` per kalimat saat mode `speaking`, lalu `idle`.
- Caption selalu tampil.
- Kalau suara belum dipasang, tampilkan state yang mengarah ke Pengaturan › Suara.
- `src/settings/VoiceSection.tsx` sesuai spec §4. `AvatarSection` berupa kartu informasi.

**Commit:** `feat: talk to the assistant and manage voices in settings`.

### Task 9: E2E dan versi 0.14.0 (sesi Opus)

- E2E `check_voice_settings`:
  - Pengaturan › Suara menampilkan status "belum dipasang" tanpa jaringan;
  - impor suara palsu (`.onnx` dummy dengan json valid) lalu muncul di daftar;
  - slider tersimpan di DB.
  - Unduhan nyata tidak dites di E2E.
- Versi 0.14.0, status di `CLAUDE.md`, dan checklist uji manual (mikrofon nyata, Piper nyata) di body PR untuk user.

**Commit:** `test: cover voice settings end to end; bump version to 0.14.0`.
**Penutup PR 5-4**, lalu rilis.

## Menjalankan task

- **Sol:** `codex exec -m gpt-6.1-sol -c model_reasoning_effort=xhigh -s workspace-write -C <worktree> "<task>" < /dev/null`. Sandbox Sol tidak bisa commit, jadi sesi Opus yang commit.
- **Gemini:** `agy-multi --model gemini-3.8-flash-high --dangerously-skip-permissions -p "<task>" < /dev/null`.
