# AI Kustom / 9router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Pengguna menghubungkan Anchoa ke 9router melalui Pengaturan tanpa mengirim jurnal/email ke provider Kustom.

**Architecture:** Reuse klien OpenAI-compatible dan shared keystore. Rust menjadi pemilik konfigurasi, secret, routing role dan privasi. UI hanya mengelola metadata/input secret sekali; AssistantState generation existing mencegah history/proposal lama kembali setelah perubahan konfigurasi.

**Tech Stack:** Tauri 2, Rust/ureq/rusqlite/keyring/zeroize, React/TypeScript/Bun. Tidak menambah SDK provider.

**Spec:** `docs/superpowers/specs/2026-10-04-anchoa-ai-provider-design.md`

**Issue/PR:** #177, satu PR `feat/177-ai-custom-provider` dari main. Dokumentasi planning dibawa ke branch implementasi; jangan kehilangan commit docs.

## Global Constraints

- Default URL Kustom `http://127.0.0.1:20128/v1`; HTTPS atau HTTP loopback saja, redirect dimatikan.
- Ollama dan Kustom saja aktif; provider resmi ditunda.
- Key hanya keyring, tidak DB/IPC hasil/log/backup/sync; error provider tidak membocorkan secret.
- journal/email lokal, ringkasan jurnal memakai journal bukan recap; tidak membuat fitur rekap harian baru (saat ini bukan jalur LLM).
- Remote chat tidak memiliki add_journal_entry; enforce definitions/propose/apply.
- Konfigurasi chat berubah: cancel/reset generation/history/pending sebelum konfigurasi berlaku; race stale request dilarang.
- Model manual tersedia bila listing tidak didukung; jangan fallback otomatis.
- Semua invoke lewat src/api.ts; command baru didaftarkan di lib.rs dengan PIN guard existing.
- Agen melewati build/test/formatter di tengah edit; integrator menjalankan verifikasi setelah wave terintegrasi.

## File map dan kontrak

- Create `src-tauri/src/assistant/providers.rs`: metadata/config URL validation, shared keystore entry `ai.custom`, endpoint resolution dan listing model.
- Modify `assistant/mod.rs`, `roles.rs`, `llm.rs`, `email.rs`, `commands.rs`, `journal.rs`, `lib.rs`: routing dan lifecycle; jangan ubah parser SSE tanpa kebutuhan kontrak nyata.
- Modify `assistant/tools.rs`, `context.rs`, `search.rs` dan query task existing jika diperlukan: batas privasi semua hasil chat.
- Modify `src/api.ts`, `src/settings/AiSection.tsx` dan test behavior existing: UI konfigurasi dan role.
- Reuse `src-tauri/src/keystore.rs`, tidak membuat store secret kedua.

Kontrak IPC (camelCase payload/fields sesuai pola existing):

```ts
interface CustomAiConfig { name: string; baseUrl: string; hasKey: boolean }
interface AiProviderStatus { available: boolean; models: string[]; error: string | null }
// ai_custom_config() -> CustomAiConfig
// save_ai_custom(name, baseUrl) -> CustomAiConfig
// set_ai_custom_key(key) -> CustomAiConfig
// delete_ai_custom_key() -> CustomAiConfig
// ai_provider_status(provider: 'ollama' | 'custom') -> AiProviderStatus
// ai_roles / set_ai_role existing tetap kontrak role, tambah custom sebagai provider valid.
```

Kontrak Rust endpoint: `providers::endpoint(conn: &Connection, store: &KeyringStore, provider: &str) -> Result<Endpoint, AppError>`; pemanggil mengambil metadata di DB kemudian melepas guard sebelum keyring/network. Sesuaikan menjadi dua langkah config snapshot + endpoint jika diperlukan untuk memenuhi mutex rule, bukan memegang guard selama keyring. Secret pada endpoint menggunakan zeroize existing untuk lifetime request, tidak Debug/Serialize.

## Task 1: Provider, keyring, routing dan lifecycle

- [ ] Tambah kasus regresi Rust untuk URL, secret failure, role privat tampered, routing aktual dan switch history. Gunakan keystore credential builder existing dan server TcpListener existing. Assert HTTP non-loopback/userinfo/query/fragment ditolak; HTTP loopback diterima; URL change tidak membawa key lama.
- [ ] Implement metadata dan key commands; nama trim/nonempty maksimal 100 karakter tanpa control; key nonempty maksimal 8192 byte tanpa control; URL maksimal 2048 byte. Tidak mengembalikan key. Mengubah URL hapus key dahulu; failure tidak commit URL baru. Metadata saja mempertahankan key jika URL sama.
- [ ] Reuse GET /models parser untuk Kustom dengan Bearer opsional; tolak model rows invalid dan respons terlalu besar mengikuti batas existing. Listing failure tetap memungkinkan model manual.
- [ ] Routing chat membaca konfigurasi provider dan model yang sama dalam snapshot. Reset/cancel conversation melalui generation sebelum konfigurasi chat/custom/key berubah, serialisasi mutation terhadap start request agar request tidak menangkap konfigurasi lama setelah reset.
- [ ] Perluas roles validation hanya ollama/custom dan journal/email tetap ollama; pindah journal_weekly_summary ke journal model/endpoint. Email menggunakan local endpoint resolver. Semua Endpoint::default produksi diperiksa, tidak mengganti dependency injection test secara buta.
- [ ] Daftarkan IPC baru di lib.rs. Pertahankan PIN guard wrapper. Error sanitization, redirect off, credential zeroization diuji.

Test penerimaan konkret menggunakan pola fixture existing:

```rust
// Assertions dalam tests providers/assistant menggunakan mock keyring dan HTTP server.
assert!(validate_base_url("http://example.com/v1").is_err());
assert!(validate_base_url("http://127.0.0.1:20128/v1").is_ok());
assert!(validate_base_url("https://user:secret@example.com/v1").is_err());
// Server tujuan menerima Authorization hanya bila key tersimpan; URL baru tidak menerima key lama.
// AssistantState snapshot sebelum switch memiliki history/proposal;
// sesudah switch history/pending kosong dan stale generation tidak dapat publish.
```

## Task 2: Batas data privat

- [ ] Test sentinels jurnal/email/tugas turunan jurnal terhadap payload HTTP chat, today_overview, search_items dan list_tasks. Jangan hanya assert string prompt; capture request nyata di fake server.
- [ ] Filter data task turunan jurnal di overview/list_tasks, tidak sekadar search yang sudah memfilter. Periksa email-derived task body: tidak memasukkan body email otomatis ke chat/tools. Jangan memfilter task biasa yang dibuat pengguna sendiri tanpa bukti hubungan privat.
- [ ] definitions menerima kebijakan local/custom; propose/apply memeriksa kebijakan sama. Remote request add_journal_entry dipaksa oleh server tetap ditolak di Rust. Proposal lokal lama invalid setelah switch.
- [ ] Ringkasan jurnal dengan recap=custom tetap hanya menghubungi endpoint journal lokal. Hasil apply tidak mengembalikan isi jurnal/email ke remote history. Tool baca memakai projection data yang diizinkan, bukan serialization seluruh row.

Contoh assertion behavior:

```rust
assert!(remote_definitions.iter().all(|v| v["function"]["name"] != "add_journal_entry"));
assert!(propose_remote("add_journal_entry", &args).is_err());
// Capture body cloud request: !contains("PRIVATE_JOURNAL_SENTINEL")
// !contains("PRIVATE_EMAIL_SENTINEL"), termasuk task hasil konversi jurnal.
```

Nama helper akhir mengikuti existing signatures; jangan memperkenalkan lapisan tool terpisah hanya demi test.

## Task 3: Pengaturan dan end-to-end

- [ ] Tambah types/methods kontrak IPC di api.ts; tidak ada invoke lain.
- [ ] Kustom card aktif membuka form metadata/key. Form secret tidak diisi dari server; simpan metadata, ganti key, hapus key terpisah, state loading/error jelas. Remote disclosure tampil sebelum role dipilih; journal/email provider tidak dapat diubah.
- [ ] Role picker memilih ollama/custom dan model list provider sesuai selection; input model manual custom tersedia. Status Ollama tidak menutup akses Kustom saat Ollama offline.
- [ ] Test perilaku consumer: metadata save tidak overwrite key, failure feedback, custom available tanpa Ollama, role privat locked, pemilihan provider/model benar. Hapus assertion incidental source/CSS/wording existing yang terkait perubahan, bukan re-pin string.
- [ ] Jalankan smoke nyata melalui Xvfb: konfigurasi endpoint 9router, daftar model, kirim chat, paksa/use tool baca dan proposal tulis, reject/approve, switch/reset. Pilih model yang mendukung tools dari daftar aktual; jangan mengasumsikan model tertentu. Jangan membaca key 9router dari disk. Bila auth diperlukan, user memasukkan key di UI.
- [ ] Periksa DB hanya metadata dan hasKey status keystore; capture UI screenshots dan catat hasil actual model/endpoint tanpa secret. Update docs/changelog existing setelah proof; hapus script throwaway.

## Integrasi, review, delivery

- [ ] Jalankan `bun run typecheck`, `bun run test`, `cargo test`, `cargo clippy --all-targets -- -D warnings` sekali setelah edit terintegrasi.
- [ ] `bun tauri build --debug --no-bundle` dan full `scripts/e2e-smoke.sh src-tauri/target/debug/anchoa` pada display Xvfb terpisah; smoke custom actual path wajib.
- [ ] Review diff oleh reviewer; periksa dan perbaiki temuan nyata dengan regression/smoke sesuai dampak.
- [ ] Commit Conventional Commits, push branch, PR body `Closes #177` dengan evidence hanya yang dijalankan. CI/SonarCloud/review/E2E hijau sebelum squash merge.
- [ ] Rilis versi baru hanya setelah implementasi dan verifikasi selesai sesuai workflow repo; jangan klaim API aktif dari docs/settings saja.
