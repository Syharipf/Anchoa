# Anchoa Jurnal v2 — J-1 Dasar: Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementasi utama oleh Codex gpt-6.1-sol xhigh (`codex exec -s workspace-write`, satu task per run). Kalau kuotanya habis, pakai `agy-multi --model gemini-3.8-flash-high`. Review oleh agy dan Sol, lalu dicek sesi Opus.

**Goal:** entri Jurnal bisa dihapus (dengan Urungkan), disematkan, dan disaring per tag dan suasana hati.

**Architecture:** satu kolom baru `journal_entries.pinned`, dua command baru (`delete_entry`, `restore_entry`), dan `journal_list` mendapat filter `tag`/`mood` serta grup "Disematkan". Frontend memakai toast aksi yang sudah ada (`src/shell/toast.tsx`, 6 detik) untuk Urungkan.

**Tech Stack:** Rust + rusqlite, React + TypeScript, bun test, Xvfb E2E.

**Spec:** `docs/superpowers/specs/2026-10-03-anchoa-jurnal-v2-design.md` (V1–V4, V15, §3).

## Global Constraints

- Semua aturan di `CLAUDE.md` berlaku. Frontend hanya lewat `src/api.ts`. Delete = soft delete; setiap query menyaring `deleted_at IS NULL`.
- Batas hari dan pengelompokan di Rust. Command mengembalikan `Result<T, AppError>`, tanpa panic.
- SonarCloud: props `Readonly<...>`, elemen non-tombol dengan `onClick` butuh handler keyboard, tanpa `Math.random()`.
- Teks UI Bahasa Indonesia, tanpa kata "Fase".
- Tanpa dependency baru. Tanpa bump versi (rilis setelah J-4).
- Sesi ini hanya mengerjakan J-1. J-2..J-4 dikerjakan di sesi Claude Code lain, masing-masing menulis plan-nya sendiri dari spec.

| PR | Task |
|---|---|
| J-1 (#140, milestone "Jurnal v2") | 1–3 |

---

### Task 1: Backend — pinned, hapus/pulihkan, filter

**Files:**
- Create: `src-tauri/migrations/013_journal_pinned.sql` (pakai nomor berikutnya kalau `013` sudah dipakai di `main`)
- Modify: `src-tauri/src/db.rs` (daftar `include_str!` migrasi)
- Modify: `src-tauri/src/journal.rs` (struct `Entry`, `EntryPatch`, `ListQuery`, `journal_entry`, `update_entry`, `journal_list`, fungsi baru, tests)
- Modify: `src-tauri/src/sync/record.rs:46-51` (kolom `pinned`) dan test di sekitar baris 477 yang memakai `INSERT INTO journal_entries VALUES (...)` posisional
- Modify: `src-tauri/src/commands.rs` (command `delete_entry`, `restore_entry`), `src-tauri/src/lib.rs` (daftar `invoke_handler`)

**Interfaces:**
- Produces (Rust): `pub fn delete_entry(conn, id: &str, now: i64) -> Result<(), AppError>`, `pub fn restore_entry(conn, id: &str, now: i64) -> Result<(), AppError>`; `Entry.pinned: bool`; `EntryPatch.pinned: Option<bool>`; `ListQuery { query, kind, tag: Option<String>, mood: Option<i8> }`; grup pertama `key = "pinned"`, `label = "Disematkan"`.
- Produces (command): `delete_entry { id }`, `restore_entry { id }`, `journal_list { query, kind, tag, mood }`.

- [ ] **Step 1: Migrasi**

```sql
-- 013_journal_pinned.sql
ALTER TABLE journal_entries ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
```

Tambahkan `include_str!("../migrations/013_journal_pinned.sql"),` setelah baris 012 di `db.rs`. Di `sync/record.rs` ubah kolom extension note menjadi `&["item_id", "kind", "mood", "tags", "task_id", "pinned"]`, lalu ubah test yang menyisipkan `journal_entries` secara posisional agar menyebut kolomnya: `INSERT INTO journal_entries (item_id, kind, mood, tags, task_id) VALUES ('note', 'idea', 4, 'tag', 'task')`.

- [ ] **Step 2: Tulis test yang gagal** (di `mod tests` `journal.rs`)

```rust
#[test]
fn delete_hides_entry_and_restore_brings_it_back() {
    let conn = open_in_memory();
    let tz = jakarta();
    let t = now();
    let e = create_entry(&conn, EntryKind::Note, Some("Hapus aku"), t, &tz).unwrap();

    delete_entry(&conn, &e.id, t + 1).unwrap();
    assert!(matches!(journal_entry(&conn, &e.id, t, &tz), Err(AppError::NotFound)));
    let groups = journal_list(&conn, &ListQuery::default(), t, &tz).unwrap();
    assert!(groups.iter().all(|g| g.entries.iter().all(|x| x.id != e.id)));
    let deleted_at: Option<i64> = conn
        .query_row("SELECT deleted_at FROM items WHERE id = ?1", [&e.id], |r| r.get(0))
        .unwrap();
    assert_eq!(deleted_at, Some(t + 1));

    restore_entry(&conn, &e.id, t + 2).unwrap();
    assert_eq!(journal_entry(&conn, &e.id, t, &tz).unwrap().title, "Hapus aku");
    restore_entry(&conn, &e.id, t + 3).unwrap(); // no-op on a live entry
}

#[test]
fn delete_rejects_unknown_and_non_note_items() {
    let conn = open_in_memory();
    let t = now();
    assert!(matches!(delete_entry(&conn, "missing", t), Err(AppError::NotFound)));
    let task = items::insert(&conn, "task", "Tugas", "", t).unwrap();
    assert!(matches!(delete_entry(&conn, &task, t), Err(AppError::NotFound)));
    assert!(matches!(restore_entry(&conn, &task, t), Err(AppError::NotFound)));
}

#[test]
fn delete_keeps_task_made_from_idea() {
    let conn = open_in_memory();
    let tz = jakarta();
    let t = now();
    let idea = create_entry(&conn, EntryKind::Idea, Some("Ide"), t, &tz).unwrap();
    let task_id = entry_to_task(&conn, &idea.id, t, &tz).unwrap().task_id.unwrap();
    delete_entry(&conn, &idea.id, t + 1).unwrap();
    let task_deleted: Option<i64> = conn
        .query_row("SELECT deleted_at FROM items WHERE id = ?1", [&task_id], |r| r.get(0))
        .unwrap();
    assert_eq!(task_deleted, None);
}

#[test]
fn pinned_entries_come_first_in_their_own_group() {
    let conn = open_in_memory();
    let tz = jakarta();
    let t = now();
    let a = create_entry(&conn, EntryKind::Note, Some("Lama"), t - 3 * 86_400_000, &tz).unwrap();
    let b = create_entry(&conn, EntryKind::Note, Some("Baru"), t, &tz).unwrap();
    let patch = EntryPatch { pinned: Some(true), ..Default::default() };
    assert!(update_entry(&conn, &a.id, &patch, t, &tz).unwrap().pinned);

    let groups = journal_list(&conn, &ListQuery::default(), t, &tz).unwrap();
    assert_eq!(groups[0].key, "pinned");
    assert_eq!(groups[0].label, "Disematkan");
    assert_eq!(groups[0].entries.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(), vec![a.id.as_str()]);
    assert!(groups[1..].iter().all(|g| g.entries.iter().all(|e| e.id != a.id)));
    assert!(groups[1..].iter().any(|g| g.entries.iter().any(|e| e.id == b.id)));
}

#[test]
fn list_filters_by_tag_and_mood() {
    let conn = open_in_memory();
    let tz = jakarta();
    let t = now();
    let a = create_entry(&conn, EntryKind::Note, Some("A"), t, &tz).unwrap();
    let b = create_entry(&conn, EntryKind::Note, Some("B"), t, &tz).unwrap();
    let c = create_entry(&conn, EntryKind::Note, Some("C"), t, &tz).unwrap();
    let tag = |s: &str, m: i8| EntryPatch { tags: Some(s.into()), mood: Some(Some(m)), ..Default::default() };
    update_entry(&conn, &a.id, &tag("kerja rumah", 4), t, &tz).unwrap();
    update_entry(&conn, &b.id, &tag("kerjaan", 4), t, &tz).unwrap(); // must not match "kerja"
    update_entry(&conn, &c.id, &tag("kerja", 2), t, &tz).unwrap();

    let ids = |q: ListQuery| -> Vec<String> {
        let mut v: Vec<String> = journal_list(&conn, &q, t, &tz).unwrap()
            .into_iter().flat_map(|g| g.entries).map(|e| e.id).collect();
        v.sort();
        v
    };
    let mut want = vec![a.id.clone(), c.id.clone()];
    want.sort();
    assert_eq!(ids(ListQuery { tag: Some("#Kerja".into()), ..Default::default() }), want);
    assert_eq!(ids(ListQuery { tag: Some("kerja".into()), mood: Some(4), ..Default::default() }), vec![a.id.clone()]);
    assert!(journal_list(&conn, &ListQuery { mood: Some(9), ..Default::default() }, t, &tz).is_err());
    assert!(journal_list(&conn, &ListQuery { tag: Some("dua kata".into()), ..Default::default() }, t, &tz).is_err());
}
```

- [ ] **Step 3: Jalankan, pastikan gagal**

Run: `cd src-tauri && cargo test journal::tests`
Expected: gagal kompilasi (`delete_entry`, `pinned`, `tag` belum ada).

- [ ] **Step 4: Implementasi**

Struct:

```rust
// Entry: tambah field
pub pinned: bool,
// EntryPatch: tambah field
pub pinned: Option<bool>,
// ListQuery
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListQuery {
    pub query: Option<String>,
    pub kind: Option<EntryKind>,
    pub tag: Option<String>,
    pub mood: Option<i8>,
}
```

`journal_entry`: tambah `COALESCE(j.pinned, 0)` ke SELECT dan isi `pinned: pinned != 0`.

`update_entry`, setelah blok tags:

```rust
if let Some(p) = patch.pinned {
    conn.execute("UPDATE journal_entries SET pinned = ?1 WHERE item_id = ?2", params![p, id])?;
}
```

Fungsi baru:

```rust
fn note_exists(conn: &Connection, id: &str, deleted: bool) -> Result<bool, AppError> {
    let sql = if deleted {
        "SELECT 1 FROM items WHERE id = ?1 AND type = 'note'"
    } else {
        "SELECT 1 FROM items WHERE id = ?1 AND type = 'note' AND deleted_at IS NULL"
    };
    Ok(conn.query_row(sql, [id], |_| Ok(())).optional()?.is_some())
}

/// Soft delete (spec V1). The task made from an idea stays (V2).
pub fn delete_entry(conn: &Connection, id: &str, now: i64) -> Result<(), AppError> {
    if !note_exists(conn, id, false)? {
        return Err(AppError::NotFound);
    }
    conn.execute(
        "UPDATE items SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1",
        params![id, now],
    )?;
    Ok(())
}

/// Undo for `delete_entry`; a live entry is left alone.
pub fn restore_entry(conn: &Connection, id: &str, now: i64) -> Result<(), AppError> {
    if !note_exists(conn, id, true)? {
        return Err(AppError::NotFound);
    }
    conn.execute(
        "UPDATE items SET deleted_at = NULL, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NOT NULL",
        params![id, now],
    )?;
    Ok(())
}
```

`journal_list`:
- SELECT tambah `COALESCE(j.pinned, 0)` sebagai kolom ke-7.
- Setelah filter `kind`:

```rust
if let Some(m) = query.mood {
    if !(1..=5).contains(&m) {
        return Err(AppError::Invalid(format!("Suasana hati harus antara 1 dan 5: {m}")));
    }
    sql.push_str(" AND j.mood = ?");
    params_vec.push(i64::from(m).into());
}
if let Some(raw) = &query.tag {
    let tag = normalize_tags(raw)?;
    if tag.is_empty() || tag.contains(' ') {
        return Err(AppError::Invalid("Saring satu tag saja".into()));
    }
    // Tags are stored space-separated (N3); pad so "kerja" does not match "kerjaan".
    sql.push_str(" AND (' ' || COALESCE(j.tags, '') || ' ') LIKE ?");
    params_vec.push(format!("% {tag} %").into());
}
```

- Ubah `ORDER BY` menjadi `ORDER BY COALESCE(j.pinned, 0) DESC, i.created_at DESC, i.id DESC`.
- Di loop, kalau `pinned != 0` pakai `("pinned".to_string(), "Disematkan".to_string())` sebagai grup, selain itu logika grup waktu yang ada.

Command di `commands.rs` (pola sama dengan `entry_to_task`):

```rust
#[tauri::command]
pub fn delete_entry(db: State<'_, Db>, id: String) -> Result<(), AppError> {
    journal::delete_entry(&*db.conn()?, &id, time::now_ms())
}

#[tauri::command]
pub fn restore_entry(db: State<'_, Db>, id: String) -> Result<(), AppError> {
    journal::restore_entry(&*db.conn()?, &id, time::now_ms())
}
```

Ubah command `journal_list` agar menerima `tag: Option<String>, mood: Option<i8>` dan meneruskannya ke `ListQuery`. Daftarkan dua command baru di `lib.rs`. Kalau command dibungkus guard PIN seperti command lain, ikuti pola itu.

- [ ] **Step 5: Jalankan test**

Run: `cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings`
Expected: semua lulus, termasuk test sync record.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/migrations/013_journal_pinned.sql src-tauri/src/db.rs src-tauri/src/journal.rs src-tauri/src/sync/record.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(journal): delete with restore, pinned entries, tag and mood filters"
```

---

### Task 2: Frontend — Hapus + Urungkan, Sematkan, chip filter

**Files:**
- Modify: `src/api.ts` (tipe `Entry.pinned`, `EntryPatch.pinned`, `journalList`, `deleteEntry`, `restoreEntry`)
- Modify: `src/journal/JournalPage.tsx`, `src/journal/EntryList.tsx`, `src/journal/EntryEditor.tsx`, `src/journal/TagInput.tsx`
- Create: `src/journal/JournalPage.test.tsx` (pola mock `api` seperti `src/notes/NotesPage.test.tsx`)

**Interfaces:**
- Consumes: command dari Task 1.
- Produces (TS):

```ts
export interface JournalFilter { query?: string; kind?: EntryKind; tag?: string; mood?: number }
journalList: (f: JournalFilter = {}) =>
  invoke<JournalList>("journal_list", { query: f.query, kind: f.kind, tag: f.tag, mood: f.mood }),
deleteEntry: (id: string) => invoke<void>("delete_entry", { id }),
restoreEntry: (id: string) => invoke<void>("restore_entry", { id }),
```

Perbarui semua pemanggil `api.journalList(q, kind)` (cari dengan `grep -rn journalList src`) ke bentuk objek.

- [ ] **Step 1: Tulis test komponen yang gagal** (`JournalPage.test.tsx`)

Kasus yang wajib:
1. Tombol "Hapus entri" di editor memanggil `api.deleteEntry(id)`, entri hilang dari daftar, dan toast "Entri dihapus" tampil dengan tombol "Urungkan".
2. Klik "Urungkan" memanggil `api.restoreEntry(id)` dan memuat ulang daftar.
3. Tombol "Sematkan" memanggil `api.updateEntry(id, { pinned: true })`; label berubah menjadi "Lepas sematan" saat `entry.pinned`.
4. Klik tag `kerja` di editor memanggil `api.journalList({ tag: "kerja", ... })` dan menampilkan chip "#kerja ×"; klik × menghapus filter.
5. Memilih suasana hati di filter memanggil `api.journalList` dengan `mood`, dan menampilkan chip-nya.
6. Grup `key = "pinned"` dirender dengan judul "Disematkan".

Bungkus render dengan `ToastProvider` dari `src/shell/toast.tsx`.

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `TZ=Asia/Jakarta bun test src/journal/JournalPage.test.tsx`
Expected: FAIL (tombol dan fungsi belum ada).

- [ ] **Step 3: Implementasi**

- `JournalPage`: state filter tunggal `const [filter, setFilter] = useState<JournalFilter>({})` menggantikan `query` + `kindFilter`. Handler:

```tsx
const toast = useToast();
async function handleDelete(id: string) {
  try {
    await api.deleteEntry(id);
    setSelectedId(null);
    setCurrentEntry(null);
    await loadList(filter);
    void loadSide();
    toast("Entri dihapus", "info", {
      label: "Urungkan",
      run: () => {
        void api.restoreEntry(id).then(async () => {
          await loadList(filter);
          void loadSide();
          setSelectedId(id);
        }, (e) => toast(errorMessage(e), "error"));
      },
    });
  } catch (e) {
    toast(errorMessage(e), "error");
  }
}
```

- `EntryEditor`: dua tombol baru di baris aksi bawah, gaya sama dengan "Bacakan": "Sematkan"/"Lepas sematan" (`aria-pressed={entry.pinned}`) dan "Hapus entri" (teks warna `text-danger` atau token bahaya yang ada di `tokens.css`). Hapus langsung tanpa dialog konfirmasi; Urungkan adalah jaring pengamannya. Props baru: `onDelete: (id: string) => void`, `onTagClick: (tag: string) => void`.
- `TagInput`: tag menjadi `<button type="button">` yang memanggil `onTagClick(tag)` (tombol × hapus tag tetap terpisah).
- `EntryList`: di bawah filter jenis, baris chip filter aktif: `#tag ×` dan `Suasana <n> ×`, plus pemilih suasana hati kecil (5 tombol `aria-pressed`, label "Saring suasana hati"). Pesan kosong saat filter aktif: "Tidak ada entri yang cocok dengan saringan."
- Grup `pinned` dirender seperti grup lain, judul "Disematkan".

- [ ] **Step 4: Jalankan test**

Run: `bun run typecheck && TZ=Asia/Jakarta bun test`
Expected: semua lulus.

- [ ] **Step 5: Commit**

```bash
git add src/api.ts src/journal/
git commit -m "feat(journal): delete with undo, pin, and tag/mood filter chips"
```

---

### Task 3: E2E dan PR (sesi Opus)

**Files:**
- Modify: `scripts/e2e-smoke.sh` (fungsi baru `check_journal_v2`, dipanggil setelah `check_journal`)

- [ ] **Step 1: Tambah `check_journal_v2`** mengikuti gaya `check_journal` (xdotool, `sql_becomes`, `shot`):
  1. Buat entri "Entri e2e hapus", tekan "Hapus entri". `sql_becomes "SELECT deleted_at IS NOT NULL FROM items WHERE title='Entri e2e hapus'" 1`.
  2. Klik "Urungkan" di toast. `sql_becomes ... 0`.
  3. Tekan "Sematkan". `sql_becomes "SELECT pinned FROM journal_entries j JOIN items i ON i.id=j.item_id WHERE i.title='Entri e2e hapus'" 1`. `shot 12-journal-pinned` (grup "Disematkan" di atas).
  4. Beri tag `e2e`, klik tag itu. `shot 12-journal-tag-filter` (chip "#e2e ×" tampil, hanya entri itu di daftar).
  Pakai `[[ ... ]]`, bukan `[ ... ]`.
- [ ] **Step 2:** `bun tauri build --debug --no-bundle && scripts/e2e-smoke.sh src-tauri/target/debug/anchoa`. Cek screenshot di `~/.cache/anchoa-e2e/`.
- [ ] **Step 3:** Commit, push branch `feat/140-jurnal-dasar`, buka PR dengan bukti test dan `Closes #140`. Review Sol + agy paralel, verifikasi temuan, perbaiki, merge saat semua hijau (`gh pr merge --squash --delete-branch`). Tanpa rilis.
- [ ] **Step 4:** Tulis handoff ke `.remember/now.md`: J-1 selesai, J-2 berikutnya di sesi baru (sesi itu menulis `docs/superpowers/plans/2026-10-0x-anchoa-jurnal-v2-j2.md` dari spec V5–V7 sebelum kode).
