# Anchoa Jurnal v2 — J-2 Menulis: Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementasi oleh task role `Coder` (satu task per run). Review oleh task role `reviewer`.

**Goal:** Menulis jurnal lebih cepat dan konsisten dengan dikte suara, 4 template entri bawaan, dan pengingat harian di panel notifikasi.

**Architecture:** `NotifyPrefs` mendapat `journal` dan `journalAt` (validasi `HH:MM`). `dashboard.rs` mendeteksi pengingat jurnal jika sudah lewat jam pengingat dan belum ada entri hari ini. Frontend `EntryEditor` mengintegrasikan STT `voice_record_start`/`voice_record_stop`. Menu "Entri baru ▾" di `JournalPage` menyediakan 4 template standar.

**Tech Stack:** Rust + rusqlite + jiff, React + TypeScript + Tailwind, bun test, Xvfb E2E.

**Spec:** `docs/superpowers/specs/2026-10-03-anchoa-jurnal-v2-design.md` (V5–V7, §3).

## Global Constraints

- Semua aturan di `CLAUDE.md` berlaku. Frontend hanya memanggil invoke lewat `src/api.ts`.
- Soft delete: setiap query menyaring `deleted_at IS NULL`.
- Batas hari dan waktu dihitung di Rust menggunakan zona waktu lokal pengguna (`jiff`).
- Command mengembalikan `Result<T, AppError>`, tanpa panic pada jalur user.
- SonarCloud: props `Readonly<...>`, elemen non-tombol dengan `onClick` butuh handler keyboard, tanpa `Math.random()`.
- Teks UI Bahasa Indonesia.
- Tanpa dependency crate/npm baru. Tanpa bump versi (rilis setelah J-4).

| PR | Task |
|---|---|
| J-2 (#141, milestone "Jurnal v2") | 1–5 |

---

### Task 1: Backend — NotifyPrefs (journal, journal_at) & Pengingat di Dashboard
**Files:**
- Modify: `src-tauri/src/profile.rs` (tambah field `journal`, `journal_at`, validator `valid_hhmm`, update `notify_prefs` & `set_notify_prefs`, unit tests)
- Modify: `src-tauri/src/journal.rs` (tambah fungsi `due_reminder` dan `dismiss_reminder`, unit tests deduplikasi tanggal, fetch berulang, restart, pergantian hari)
- Modify: `src-tauri/src/dashboard.rs` (tambah field `journal_reminder` di `Dashboard`, panggil `journal::due_reminder`, unit tests)
- Modify: `src-tauri/src/commands.rs` & `src-tauri/src/lib.rs` (tambah command `dismiss_journal_reminder`)

**Interfaces:**
- Produces (Rust):
  - `NotifyPrefs { task: bool, bill: bool, budget: bool, habit: bool, journal: bool, journal_at: String }`
  - `Dashboard.journal_reminder: bool`
  - `journal::due_reminder(conn: &Connection, now: i64, tz: &TimeZone) -> Result<bool, AppError>`
  - `journal::dismiss_reminder(conn: &Connection, now: i64, tz: &TimeZone) -> Result<(), AppError>`
  - Command: `dismiss_journal_reminder`
  - Penanda per tanggal lokal: key `notify.journal_dismissed` di tabel `settings` menyimpan string tanggal lokal `YYYY-MM-DD`.
  - Validasi: `journal_at` format `HH:MM` (00–23:00–59), tolak selain itu dengan `AppError::Invalid("Jam pengingat jurnal harus berformat JJ:MM".into())`.
  - Default: `journal: false`, `journal_at: "20:00"`.
  - Kondisi pengingat aktif: `prefs.journal == true`, waktu lokal saat ini `>= prefs.journal_at`, `notify.journal_dismissed != today_str`, dan belum ada entri bertipe `'note'` yang tidak terhapus hari ini (`day_bounds(now, tz)`).
- [ ] **Step 1: Tulis test failing di `profile.rs` untuk preferensi notifikasi jurnal**

Tambahkan pengujian preferensi notifikasi `journal` dan `journal_at`, serta validasi format jam:

```rust
#[test]
fn notify_prefs_supports_journal_and_validates_hhmm() {
    let conn = open_in_memory();
    let default_prefs = notify_prefs(&conn).unwrap();
    assert!(!default_prefs.journal);
    assert_eq!(default_prefs.journal_at, "20:00");

    let updated = NotifyPrefs {
        journal: true,
        journal_at: "21:30".into(),
        ..default_prefs
    };
    assert_eq!(set_notify_prefs(&conn, &updated).unwrap(), updated);
    assert_eq!(notify_prefs(&conn).unwrap(), updated);

    // Format tidak valid ditolak
    for bad in ["", "24:00", "12:60", "8:00", "ab:cd", "12-00"] {
        let invalid_prefs = NotifyPrefs {
            journal_at: bad.into(),
            ..updated
        };
        assert!(matches!(set_notify_prefs(&conn, &invalid_prefs), Err(AppError::Invalid(_))));
    }
}
```

- [ ] **Step 2: Jalankan test dan pastikan gagal**

Run: `cargo test --manifest-path src-tauri/Cargo.toml profile::tests::notify_prefs_supports_journal_and_validates_hhmm`
Expected: FAIL kompilasi (field belum ada).

- [ ] **Step 3: Implementasi field `journal` dan `journal_at` di `profile.rs`**

Update struct `NotifyPrefs`:
```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotifyPrefs {
    pub task: bool,
    pub bill: bool,
    pub budget: bool,
    pub habit: bool,
    pub journal: bool,
    pub journal_at: String,
}
```

Implementasikan validator dan parsing:
```rust
pub fn valid_hhmm(s: &str) -> bool {
    let bytes = s.as_bytes();
    if bytes.len() != 5 || bytes[2] != b':' {
        return false;
    }
    let h1 = bytes[0].wrapping_sub(b'0');
    let h2 = bytes[1].wrapping_sub(b'0');
    let m1 = bytes[3].wrapping_sub(b'0');
    let m2 = bytes[4].wrapping_sub(b'0');
    if h1 > 9 || h2 > 9 || m1 > 9 || m2 > 9 {
        return false;
    }
    let hour = h1 * 10 + h2;
    let minute = m1 * 10 + m2;
    hour <= 23 && minute <= 59
}
```

Di `notify_prefs`:
```rust
pub fn notify_prefs(conn: &Connection) -> Result<NotifyPrefs, AppError> {
    Ok(NotifyPrefs {
        task: setting(conn, "notify.task")?.as_deref() != Some("0"),
        bill: setting(conn, "notify.bill")?.as_deref() != Some("0"),
        budget: setting(conn, "notify.budget")?.as_deref() != Some("0"),
        habit: setting(conn, "notify.habit")?.as_deref() != Some("0"),
        journal: setting(conn, "notify.journal")?.as_deref() == Some("1"),
        journal_at: setting(conn, "notify.journal_at")?.unwrap_or_else(|| "20:00".into()),
    })
}
```

Di `set_notify_prefs`:
Validasi `valid_hhmm(&prefs.journal_at)` sebelum transaksi:
```rust
if !valid_hhmm(&prefs.journal_at) {
    return Err(AppError::Invalid("Jam pengingat jurnal harus berformat JJ:MM".into()));
}
```
Simpan `notify.journal` dan `notify.journal_at` ke settings.

- [ ] **Step 4: Tulis test failing di `journal.rs` untuk pengingat jurnal, deduplikasi tanggal, fetch berulang, restart, dan pergantian hari**

```rust
#[test]
fn journal_reminder_deduplication_and_day_rollover() {
    let conn = open_in_memory();
    let tz = jakarta();
    let t_day1_11 = ms("2026-09-29T11:00:00+07:00");
    let t_day1_20 = ms("2026-09-29T20:30:00+07:00");
    let t_day2_08 = ms("2026-09-30T08:00:00+07:00");
    let t_day2_21 = ms("2026-09-30T21:00:00+07:00");

    // Default: mati
    assert!(!due_reminder(&conn, t_day1_20, &tz).unwrap());

    // Aktifkan pengingat jam 20:00
    crate::profile::set_notify_prefs(&conn, &crate::profile::NotifyPrefs {
        task: true, bill: true, budget: true, habit: true,
        journal: true, journal_at: "20:00".into(),
    }).unwrap();

    // Sebelum jam 20:00 -> false
    assert!(!due_reminder(&conn, t_day1_11, &tz).unwrap());

    // Setelah jam 20:00 -> true
    assert!(due_reminder(&conn, t_day1_20, &tz).unwrap());

    // Fetch berulang pada hari yang sama tetap true sebelum ditutup / ditulis
    assert!(due_reminder(&conn, t_day1_20 + 1000, &tz).unwrap());
    assert!(due_reminder(&conn, t_day1_20 + 2000, &tz).unwrap());

    // Pengguna menutup / dismiss pengingat hari ini
    dismiss_reminder(&conn, t_day1_20 + 3000, &tz).unwrap();

    // Fetch berulang setelah dismiss di hari yang sama -> false
    assert!(!due_reminder(&conn, t_day1_20 + 4000, &tz).unwrap());

    // Simulasi restart / pembukaan koneksi: penanda tanggal di DB settings tetap ada
    let dismissed: Option<String> = conn.query_row(
        "SELECT value FROM settings WHERE key = 'notify.journal_dismissed'",
        [],
        |r| r.get(0),
    ).optional().unwrap();
    assert_eq!(dismissed.as_deref(), Some("2026-09-29"));
    assert!(!due_reminder(&conn, t_day1_20 + 5000, &tz).unwrap());

    // Pergantian hari ke 30 Sep:
    // Pagi jam 08:00 (sebelum jam 20:00) -> false
    assert!(!due_reminder(&conn, t_day2_08, &tz).unwrap());

    // Malam jam 21:00 (setelah jam 20:00) -> true lagi untuk hari baru
    assert!(due_reminder(&conn, t_day2_21, &tz).unwrap());

    // Tulis entri jurnal di hari kedua -> pengingat hilang
    create_entry(&conn, EntryKind::Note, Some("Refleksi"), t_day2_21 + 100, &tz).unwrap();
    assert!(!due_reminder(&conn, t_day2_21 + 200, &tz).unwrap());
}
```

- [ ] **Step 5: Implementasi `due_reminder` dan `dismiss_reminder` di `journal.rs`**

```rust
const JOURNAL_DISMISSED_KEY: &str = "notify.journal_dismissed";

pub fn due_reminder(conn: &Connection, now: i64, tz: &TimeZone) -> Result<bool, AppError> {
    let prefs = crate::profile::notify_prefs(conn)?;
    if !prefs.journal {
        return Ok(false);
    }
    let zoned = Timestamp::from_millisecond(now)?.to_zoned(tz.clone());
    let current_time = zoned.strftime("%H:%M").to_string();
    if current_time < prefs.journal_at {
        return Ok(false);
    }
    let today_str = local_date(now, tz)?.to_string();
    let dismissed: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            [JOURNAL_DISMISSED_KEY],
            |r| r.get(0),
        )
        .optional()?;
    if dismissed.as_deref() == Some(today_str.as_str()) {
        return Ok(false);
    }
    let (start_of_today, end_of_today) = time::day_bounds(now, tz)?;
    let written: bool = conn.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM items
            WHERE type = 'note'
              AND deleted_at IS NULL
              AND created_at >= ?1
              AND created_at < ?2
        )",
        params![start_of_today, end_of_today],
        |r| r.get(0),
    )?;
    Ok(!written)
}

pub fn dismiss_reminder(conn: &Connection, now: i64, tz: &TimeZone) -> Result<(), AppError> {
    let today_str = local_date(now, tz)?.to_string();
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![JOURNAL_DISMISSED_KEY, today_str],
    )?;
    Ok(())
}
```

- [ ] **Step 6: Panggil `journal::due_reminder` di `dashboard.rs` dan buat command `dismiss_journal_reminder`**

Di `dashboard.rs`:
```rust
pub struct Dashboard {
    ...
    pub journal_reminder: bool,
}

journal_reminder: journal::due_reminder(conn, now, tz)?,
```

Di `commands.rs`:
```rust
#[tauri::command]
pub fn dismiss_journal_reminder(db: State<'_, Db>) -> Result<(), AppError> {
    journal::dismiss_reminder(&*db.conn()?, time::now_ms(), &TimeZone::system())
}
```
Daftarkan command di `lib.rs` `invoke_handler`.

- [ ] **Step 7: Jalankan seluruh test cargo dan clippy**

Run: `cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings`
Expected: Semua test pass dan clippy bersih.

- [ ] **Step 8: Commit backend**

```bash
git add src-tauri/src/profile.rs src-tauri/src/journal.rs src-tauri/src/dashboard.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(journal): add journal notify prefs, reminder deduplication, and dismiss command"
```

---

### Task 2: Frontend — Pengaturan Notifikasi Jurnal & Panel Notifikasi

**Files:**
- Modify: `src/api.ts` (update `NotifyPrefs` dan `Dashboard`)
- Modify: `src/api.test.ts` (sesuaikan mock `setNotifyPrefs`)
- Modify: `src/notifications/reminders.ts` & `src/notifications/reminders.test.ts` (tambah jenis reminder `journal`, pesan "Belum menulis jurnal hari ini")
- Modify: `src/notifications/NotifPanel.tsx` (tambah handler navigasi jurnal)
- Modify: `src/profile/view.ts` (tambah opsi `journal` di `NOTIFY_PREF_OPTIONS`)
- Modify: `src/profile/ProfilePage.tsx` & `src/profile/ProfilePage.test.tsx` (switch jurnal dan input waktu `journalAt`)
- Modify: `src/App.tsx` & `src/App.test.tsx` (pass `onOpenJournal` ke `NotifPanel`)

**Interfaces:**
  - `NotifyPrefs { task: boolean; bill: boolean; budget: boolean; habit: boolean; journal: boolean; journalAt: string; }`
  - `Dashboard.journalReminder: boolean`
  - `api.dismissJournalReminder(): Promise<void>`
  - `Reminder = ... | { kind: "journal"; id: "journal" }`
  - `reminders(today, finance, habitReminders, prefs, journalReminder)` menghasilkan kartu di "Hari ini": title "Jurnal harian", detail "Belum menulis jurnal hari ini".
- [ ] **Step 1: Update tipe di `src/api.ts` dan test di `src/api.test.ts`**

Update `NotifyPrefs` di `src/api.ts`:
```typescript
export interface NotifyPrefs {
  task: boolean;
  bill: boolean;
  budget: boolean;
  habit: boolean;
  journal: boolean;
  journalAt: string;
}
```
Update `Dashboard`:
  journalReminder: boolean;
```
Tambah method di `api.ts`:
```typescript
  dismissJournalReminder: () => invoke<void>("dismiss_journal_reminder"),
```
Perbarui mock `DEFAULT_PREFS` di `src/profile/ProfilePage.tsx`, `ProfilePage.test.tsx`, `App.test.tsx`, `src/notifications/reminders.ts`.

- [ ] **Step 2: Update `src/notifications/reminders.ts` dan tulis unit test di `reminders.test.ts`**

Tambah jenis reminder:
```typescript
export type Reminder =
  | { kind: "task"; id: string; task: DayTask }
  | { kind: "bill"; id: string; bill: BillView }
  | { kind: "budget"; id: string; percent: number; over: boolean }
  | { kind: "habit"; id: string; habit: HabitReminder }
  | { kind: "journal"; id: "journal" };
```

Di `reminders()`:
Jika `p.journal && journalReminder`:
Tambahkan `{ kind: "journal", id: "journal" }` ke dalam grup "Hari ini".

Di `reminderText()`:
```typescript
if (r.kind === "journal") {
  return {
    title: "Jurnal harian",
    detail: "Belum menulis jurnal hari ini",
    tone: "muted",
  };
}
```

Tulis unit test di `reminders.test.ts` untuk memastikan kartu jurnal muncul saat `journalReminder` bernilai true dan `p.journal` aktif, serta tidak muncul jika dimatikan.

- [ ] **Step 3: Update `NotifPanel.tsx` dan `App.tsx`**

Di `NotifPanel.tsx`:
Tambah prop `onOpenJournal: () => void` dan `onDismissJournal?: () => void`.
Saat reminder `journal` diklik:
```typescript
} else if (r.kind === "journal") {
  onOpenJournal();
}
```
Sediakan tombol dismiss (×) pada kartu reminder `journal` untuk memanggil `api.dismissJournalReminder()`.
Di `App.tsx`:
Pass `journalReminder={data?.journalReminder ?? false}` dan `onOpenJournal={() => go("jurnal")}` ke `NotifPanel`.

- [ ] **Step 4: Update UI di `ProfilePage.tsx` dan `src/profile/view.ts`**

Di `src/profile/view.ts`:
```typescript
export const NOTIFY_PREF_OPTIONS: readonly NotifyPrefOption[] = [
  ...
  {
    key: "journal",
    label: "Jurnal",
    description: "Pengingat menulis jurnal harian",
  },
];
```

Di `ProfilePage.tsx`:
Di bawah switch jurnal, jika `prefs.journal` bernilai true:
Tampilkan input jam pengingat (`<input type="time" aria-label="Jam pengingat jurnal" value={prefs.journalAt} ...>`).
Saat jam diubah, validasi format `HH:MM` lalu panggil `setNotifyPrefs`.
Update `ProfilePage.test.tsx` untuk memverifikasi toggle jurnal dan perubahan jam pengingat.

- [ ] **Step 5: Jalankan frontend tests**

Run: `TZ=Asia/Jakarta bun test src/notifications/reminders.test.ts src/profile/ProfilePage.test.tsx src/api.test.ts`
Expected: Semua test pass.

- [ ] **Step 6: Commit frontend notifikasi**

```bash
git add src/api.ts src/api.test.ts src/notifications/ src/profile/ src/App.tsx src/App.test.tsx
git commit -m "feat(notifications): add journal reminder preference and panel item"
```

---

### Task 3: Frontend Jurnal — Dikte Suara (V5) di EntryEditor

**Files:**
- Modify: `src/journal/EntryEditor.tsx` (tambah tombol Dikte, integrasi `voiceRecordStart`/`voiceRecordStop`, penanganan kursor textarea)
- Modify: `src/journal/EntryEditor.test.tsx` / `JournalPage.test.tsx` (unit test dikte suara)

**Interfaces:**
- Produces:
  - Tombol "Dikte" di editor:
    - Status idle: icon mic + label "Dikte".
    - Status merekam: icon stop + label "Merekam…" (warna aktif/merah).
    - Status transkripsi: label "Memproses…".
  - Saat diklik:
    - Jika belum merekam: cek `await api.voiceStatus()`. Jika `!status.whisper || !status.whisperModel`, tampilkan toast pesan dengan opsi/tautan Pengaturan Suara: `toast("Model Whisper belum terpasang", "error", { label: "Pengaturan", run: () => onOpenSettings?.("suara") })`.
    - Jika siap: panggil `api.voiceRecordStart()`, set mode "recording".
    - Jika sedang merekam: panggil `api.voiceRecordStop()`, set mode "transcribing".
    - Teks hasil transkripsi disisipkan di posisi kursor textarea `body` (`selectionStart`..`selectionEnd`), atau ditambahkan di akhir jika tidak ada kursor.
    - Simpan teks yang diperbarui dengan memanggil `handleBodyChange(newBody)`.
    - Cleanup: jika komponen unmount saat merekam, panggil `api.voiceRecordStop().catch(() => {})`.

- [ ] **Step 1: Tulis unit test untuk aksi Dikte di `EntryEditor`**

Uji alur:
1. Klik dikte saat model Whisper belum terpasang → menampilkan pesan toast dan tidak memulai rekaman.
2. Klik dikte saat Whisper siap → memanggil `voiceRecordStart`.
3. Klik kedua kali untuk berhenti → memanggil `voiceRecordStop` dan menyisipkan teks ke textarea di posisi kursor.

- [ ] **Step 2: Implementasi dikte di `EntryEditor.tsx`**

Tambahkan ref untuk `textarea`:
```typescript
const textareaRef = useRef<HTMLTextAreaElement>(null);
const [recordingMode, setRecordingMode] = useState<"idle" | "recording" | "transcribing">("idle");
```

Logika sisipkan teks di kursor:
```typescript
function insertTextAtCursor(textToInsert: string) {
  const textarea = textareaRef.current;
  if (!textarea) {
    handleBodyChange(body ? `${body} ${textToInsert}` : textToInsert);
    return;
  }
  const start = textarea.selectionStart ?? body.length;
  const end = textarea.selectionEnd ?? body.length;
  const before = body.slice(0, start);
  const after = body.slice(end);
  const nextBody = `${before}${before && !before.endsWith(" ") && !before.endsWith("\n") ? " " : ""}${textToInsert}${after}`;
  handleBodyChange(nextBody);
}
```

Implementasi tombol "Dikte":
```typescript
async function handleToggleDictation() {
  if (recordingMode === "recording") {
    setRecordingMode("transcribing");
    try {
      const text = await api.voiceRecordStop();
      if (text.trim()) {
        insertTextAtCursor(text.trim());
      }
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setRecordingMode("idle");
    }
    return;
  }

  try {
    const status = await api.voiceStatus();
    if (!status.whisper || !status.whisperModel) {
      toast("Model Whisper belum terpasang untuk dikte suara", "error", {
        label: "Pengaturan",
        run: () => onOpenSettings?.("suara"),
      });
      return;
    }
    await api.voiceRecordStart();
    setRecordingMode("recording");
  } catch (e) {
    toast(errorMessage(e), "error");
  }
}
```

Tombol dikte di footer/toolbar `EntryEditor`.

- [ ] **Step 3: Jalankan frontend test**

Run: `TZ=Asia/Jakarta bun test src/journal/`
Expected: Semua test pass.

- [ ] **Step 4: Commit dikte suara**

```bash
git add src/journal/EntryEditor.tsx src/journal/EntryEditor.test.tsx src/journal/JournalPage.tsx
git commit -m "feat(journal): add voice dictation to entry editor"
```

---

### Task 4: Frontend Jurnal — Template Entri Bawaan (V6)

**Files:**
- Modify: `src/journal/view.ts` (tambah 4 template bawaan `JOURNAL_TEMPLATES`)
- Modify: `src/journal/view.test.ts` (unit test daftar dan struktur template)
- Modify: `src/journal/JournalPage.tsx` (dropdown menu "Entri baru ▾" dengan opsi template)
- Modify: `src/journal/JournalPage.test.tsx` (unit test pemilihan template)

**Interfaces:**
- Produces:
  - `JournalTemplate { id: string, label: string, description: string, kind: EntryKind, title: string, body: string }`
  - 4 template standar:
    1. `Refleksi harian` (`note`): pertanyaan refleksi hari ini
    2. `3 hal yang disyukuri` (`note`): daftar 3 hal bersyukur
    3. `Review mingguan` (`note`): pencapaian, evaluasi, fokus minggu depan
    4. `Curhat terarah` (`vent`): eksplorasi emosi dan hal dalam kendali
  - Di `JournalPage`: tombol "Entri baru ▾" / "Tulis" dengan menu dropdown template. Memilih template akan memanggil `api.createEntry(template.kind, template.title)`, lalu mengupdate body dengan `template.body` via `api.updateItem(id, { body: template.body })`, dan langsung membuka entri di editor.

- [ ] **Step 1: Tulis definisi dan test template di `view.ts` dan `view.test.ts`**

Tambahkan 4 template ke `src/journal/view.ts`:
```typescript
export interface JournalTemplate {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly kind: EntryKind;
  readonly title: string;
  readonly body: string;
}

export const JOURNAL_TEMPLATES: readonly JournalTemplate[] = [
  {
    id: "daily-reflection",
    label: "Refleksi harian",
    description: "Evaluasi hari ini dan apa yang dipelajari",
    kind: "note",
    title: "Refleksi harian",
    body: "### Apa yang berjalan baik hari ini?\n\n\n### Apa tantangan yang dihadapi?\n\n\n### Apa pelajaran untuk besok?\n",
  },
  {
    id: "gratitude",
    label: "3 hal yang disyukuri",
    description: "Latihan bersyukur untuk hal-hal bermakna",
    kind: "note",
    title: "3 hal yang disyukuri",
    body: "1. \n2. \n3. \n",
  },
  {
    id: "weekly-review",
    label: "Review mingguan",
    description: "Kilas balik pencapaian dan arah minggu depan",
    kind: "note",
    title: "Review mingguan",
    body: "### Pencapaian terbesar minggu ini\n\n\n### Hal yang belum selesai atau tertunda\n\n\n### Fokus utama minggu depan\n",
  },
  {
    id: "guided-vent",
    label: "Curhat terarah",
    description: "Uraikan emosi dan cari titik kendali",
    kind: "vent",
    title: "Curhat terarah",
    body: "### Apa yang sedang kurasakan?\n\n\n### Mengapa hal ini menggangguku?\n\n\n### Apa yang berada dalam kendaliku?\n",
  },
];
```

Test di `view.test.ts` memastikan ada 4 template dan masing-masing memiliki title, body, dan kind yang sesuai.

- [ ] **Step 2: Implementasi menu dropdown di `JournalPage.tsx`**

Tambahkan state dropdown template di header `JournalPage.tsx`:
```typescript
const [templatesOpen, setTemplatesOpen] = useState(false);
```

Fungsi pembuat entri dari template:
```typescript
async function handleTemplateSelect(template: JournalTemplate) {
  setTemplatesOpen(false);
  try {
    const created = await api.createEntry(template.kind, template.title);
    if (template.body) {
      await api.updateItem(created.id, { body: template.body });
      created.body = template.body;
    }
    await openCreated(created);
  } catch (e) {
    toast(errorMessage(e), "error");
  }
}
```

Render tombol "Entri baru ▾" dengan menu dropdown template di header. Dukung aksesibilitas keyboard: Escape untuk menutup menu, panah / Tab untuk navigasi.

- [ ] **Step 3: Tulis unit test di `JournalPage.test.tsx`**

Pastikan menu template dapat dibuka, menampilkan 4 template, dan memilih salah satu template memanggil `api.createEntry` serta `api.updateItem` dengan template body.

- [ ] **Step 4: Jalankan frontend test**

Run: `TZ=Asia/Jakarta bun test src/journal/`
Expected: Semua test pass.

- [ ] **Step 5: Commit template jurnal**

```bash
git add src/journal/view.ts src/journal/view.test.ts src/journal/JournalPage.tsx src/journal/JournalPage.test.tsx
git commit -m "feat(journal): add built-in entry templates"
```

---

### Task 5: Smoke Test E2E, Review, dan Finalisasi PR

**Files:**
- Modify: `scripts/e2e-smoke.sh` (tambah verifikasi elemen template dan dialog pengingat di Xvfb)

**Interfaces:**
- Produces:
  - Full check suite pass: `bun run typecheck`, `bun run test`, `cargo test`, `cargo clippy`.
  - E2E smoke test pass di Xvfb.
  - Review clean dari task reviewer.
  - PR dibuka dengan `Closes #141` dan bukti test.

- [ ] **Step 1: Jalankan full test suite dan clippy lokal**

Run:
```bash
bun run typecheck
TZ=Asia/Jakarta bun run test
cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings
```
Pastikan 100% hijau.

- [ ] **Step 2: Update dan jalankan E2E smoke test**

Di `scripts/e2e-smoke.sh`, tambahkan pengecekan menu Entri Baru dan Template di Jurnal.
Jalankan:
```bash
bun tauri build --debug --no-bundle && scripts/e2e-smoke.sh src-tauri/target/debug/anchoa
```
Pastikan lulus dan screenshot tersimpan.

- [ ] **Step 3: Review temuan dan fix**

Lakukan review (role `reviewer`), perbaiki setiap temuan nyata.

- [ ] **Step 4: Buka PR dan Merge**

Buka branch `feat/141-jurnal-menulis`, push, buat PR dengan `Closes #141` dan lampiran screenshot/test output.
Merge dengan `gh pr merge --squash --delete-branch` setelah CI dan SonarCloud hijau.

- [ ] **Step 5: Handoff ke `.remember/now.md`**

Update `.remember/now.md`: J-2 selesai, J-3 (Refleksi) berikutnya.
