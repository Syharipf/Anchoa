# Integrasi agen kode (opsional)

Tujuan: agen AI di terminal/IDE (Claude Code, Cursor, dll.) **mencatat** rencana, progres, dan hasil tes ke proyek di Anchoa, dan (opsional) Anchoa bisa **mengirim perintah** ke agen di laptop, termasuk dari HP, tanpa pindah aplikasi.

Desain: artboard `ProyekAgen`, `ProyekAgenHubungkan`, `HpAgen`. Kerjakan **setelah** fitur inti stabil (Fase 11 di ROADMAP). Bagian B boleh ditunda atau dibatalkan tanpa memengaruhi bagian A.

> ⚑ Semua flag/nama di bawah dicek terhadap dokumentasi Claude Code saat dokumen ini ditulis. Sebelum implementasi, cek ulang dengan `claude --help`, `claude mcp --help`, dan dokumentasi hooks/Agent SDK terbaru.

---

## A. Agen → Anchoa (mencatat) — risiko rendah, kerjakan dulu

### Komponen
1. **Edge Function `agent-mcp`** (repo `anchoa-supabase`): server MCP lewat HTTP (streamable HTTP). Satu URL untuk semua agen yang mendukung MCP.
2. **Token agen**: dibuat di Anchoa (Proyek › Hubungkan agen), ditampilkan sekali, disimpan sebagai hash. Terikat ke pengguna + daftar proyek + izin (scope). Bisa dicabut.
3. **`anchoa-hook`**: skrip kecil (shell + curl, atau subcommand CLI) yang dipanggil hooks agen untuk kejadian yang tidak boleh bergantung pada "ingatan" model (sesi mulai/selesai).

### Tool MCP
| Tool | Isi | Efek di Anchoa |
|---|---|---|
| `plan_create` | judul, langkah[] | Langkah jadi tugas `source='agent'` di kolom **Rencana** + event `plan` |
| `task_update` | id/judul tugas, status `plan/doing/done`, catatan singkat | Kartu Kanban pindah kolom + event `task` |
| `progress_log` | judul, isi ≤ 2 KB, daftar file (path + baris tambah/hapus) | Event `files`/`progress` |
| `test_report` | perintah, lulus, gagal, durasi, daftar gagal (nama + pesan ≤ 300 karakter) | Event `test` + lencana kesehatan proyek |
| `task_list` | — (baca) | Tugas terbuka proyek ini, agar agen tahu konteks |

Agen tidak otomatis memanggil tool ini; tambahkan ke `CLAUDE.md`/`AGENTS.md` di repo proyek:
```md
## Anchoa
- Setelah membuat rencana: panggil anchoa.plan_create (langkah-langkahnya).
- Saat mulai/selesai mengerjakan langkah: anchoa.task_update.
- Setelah menjalankan tes: anchoa.test_report (lulus, gagal, nama tes gagal).
- Jangan kirim isi file, rahasia, atau .env ke Anchoa.
```

### Menyambungkan Claude Code
```bash
export ANCHOA_TOKEN=anc_...    # simpan di keyring / .env lokal, jangan di-commit
claude mcp add --transport http anchoa \
  https://<ref>.supabase.co/functions/v1/agent-mcp \
  --header "Authorization: Bearer ${ANCHOA_TOKEN}" --scope project
```
`--scope project` menulis `.mcp.json` di repo (variabel `${ANCHOA_TOKEN}` diekspansi saat dipakai, jadi tokennya sendiri tidak ikut ter-commit).
Agen lain yang mendukung MCP (Cursor, Codex CLI, Gemini CLI, dll.) memakai URL + header yang sama; cara menambahkannya berbeda per agen.

### Hooks (opsional, Claude Code)
`.claude/settings.json` di repo:
```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "anchoa-hook session-start" }] }],
    "Stop":         [{ "hooks": [{ "type": "command", "command": "anchoa-hook stop" }] }],
    "SessionEnd":   [{ "hooks": [{ "type": "command", "command": "anchoa-hook session-end" }] }]
  }
}
```
`anchoa-hook` membaca JSON dari stdin (session_id, cwd, dll.) lalu POST ke `agent-mcp`. Commit bisa dicatat lewat git hook `post-commit` (hash + pesan saja).

### Batas data (penting untuk kuota 500 MB)
- Simpan **ringkasan dan metadata**, bukan transkrip, isi file, atau diff. Transkrip tetap di laptop.
- `body` event ≤ 2 KB; daftar file hanya path + jumlah baris.
- Filter di server: tolak isi yang tampak seperti rahasia (`sk-`, `-----BEGIN`, `AKIA`, isi `.env`).
- pg_cron: hapus `agent_events` > 90 hari.

---

## B. Anchoa → agen (memerintah) — opsional, risiko tinggi

Ini menjalankan agen yang bisa mengubah kode dan menjalankan perintah di laptopmu dari jarak jauh. Perlakukan sebagai fitur keamanan, bukan sekadar fitur UI.

### Alur
1. Di Anchoa (laptop atau HP) pengguna menulis/mendikte perintah + memilih mode → baris `agent_commands` (status `queued`).
2. **Runner** di Anchoa laptop (berlangganan Realtime) mengambil perintah untuk proyek yang punya **pemetaan folder lokal** (disimpan hanya di laptop, tidak di Supabase).
3. Runner menjalankan agen di folder itu, mengalirkan event ringkas ke `agent_events`.
4. Setiap izin (edit file / perintah terminal) → baris `agent_approvals` (`pending`) → muncul di Anchoa + notifikasi HP → keputusan dikirim balik → agen lanjut atau berhenti.
5. *Hentikan* membatalkan proses (abort) dan menandai sesi `stopped`.

### Implementasi runner (usulan)
- Sidecar Node kecil memakai **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`): `query({ prompt, options })` dengan `cwd`, `permissionMode`, dan callback **`canUseTool`** → buat `agent_approvals`, tunggu keputusan lewat Realtime (batas 10 menit → tolak), kembalikan `{ behavior: 'allow' }` atau `{ behavior: 'deny', message }`.
- Alternatif tanpa SDK: `claude -p "<perintah>" --output-format stream-json --verbose --permission-mode plan` (hanya untuk mode Rencana saja).
- Agen lain: adapter belakangan (⚑), jika CLI-nya punya mode headless.

### Mode (sesuai desain)
| Mode | Claude Code | Keterangan |
|---|---|---|
| Rencana saja (bawaan, satu-satunya bawaan dari HP) | `plan` | Membaca kode, menulis rencana, tidak mengubah apa pun |
| Minta izin | `default` + `canUseTool` | Setiap edit & perintah menunggu izin |
| Edit otomatis | `acceptEdits` + `canUseTool` untuk Bash | Edit file langsung; perintah terminal tetap minta izin |
| Tanpa izin | — | **Tidak tersedia dari Anchoa** |

### Aturan keamanan (wajib)
- Scope token `cmd` (Terima perintah dari Anchoa) **mati secara default**; runner hanya jalan bila scope aktif **dan** aplikasi desktop terbuka.
- Daftar izin repo di laptop; perintah untuk proyek tanpa pemetaan ditolak.
- Perintah dari HP selalu tampil ulang untuk konfirmasi sebelum masuk antrean.
- Setiap perintah, izin, dan keputusan dicatat (audit) dengan perangkat asalnya.
- Batas: 1 sesi berjalan per proyek, batas waktu sesi (mis. 60 menit), batas giliran.
- Prompt injection: isi repo bisa menyuruh agen memanggil tool Anchoa secara aneh — karena itu tool MCP hanya bisa menulis ke proyek yang tercakup token dan tidak bisa membaca data Anchoa lain (keuangan, jurnal, email).
- Biaya: sesi headless memakai kuota langganan/API Claude milikmu.

---

## Skema (repo `anchoa-supabase`, Fase G)
| Tabel | Kolom penting |
|---|---|
| `agent_tokens` | user_id, nama, `token_hash`, `prefix`, `project_ids uuid[]`, `scopes text[]` (`plan`,`test`,`read`,`cmd`), `last_used_at`, `revoked_at`, `expires_at` |
| `agent_sessions` | project_id, agen (`claude-code`, …), mesin, folder (opsional), mulai/selesai, status, ringkasan, file_diubah |
| `agent_events` | session_id, project_id, jenis (`plan`,`task`,`files`,`test`,`commit`,`approval`,`note`,`start`,`stop`), judul, isi ≤ 2 KB, `data jsonb` |
| `agent_commands` | project_id, mode, perintah, status (`queued`,`running`,`done`,`failed`,`cancelled`,`expired`), asal perangkat |
| `agent_approvals` | session_id, alat, ringkasan input, status (`pending`,`allowed`,`denied`,`expired`), diputuskan dari perangkat |
| `tasks` (+kolom) | `source` (`user`/`agent`), `external_ref` |

RLS seperti tabel lain (pemilik saja). `agent-mcp` memverifikasi token → `user_id` + scope → menulis lewat fungsi SQL yang **memeriksa proyek ada di `project_ids` token**. Test pgTAP: token proyek A tidak bisa menulis ke proyek B; token dicabut ditolak; scope `test` saja tidak bisa `plan_create`.
