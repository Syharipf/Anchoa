# Anchoa — Referensi Desain Dashboard (arah D: Studio Malam + Avatar suara)

Referensi visual untuk implementasi dashboard Anchoa. File pendamping:

- `anchoa-dashboard-d.dc.html` — sumber markup artboard D. Pakai sebagai referensi **struktur, inline style, dan logika state**.
  Sintaks `{{...}}`, `<sc-for>`, `<sc-if>`, `<x-dc>`, `<helmet>`, dan `class Component extends DCLogic` adalah format tool desain,
  **bukan** kode yang disalin mentah. Terjemahkan ke stack proyek.
- `anchoa-dashboard-d.png` (ekspor dari canvas) — acuan tampilan akhir.

Semua angka di desain (saldo, tugas, kontribusi) adalah **data contoh**.

---

## 1. Layout (acuan desktop 1280×800)

```
┌──────┬──────────────────────────────────────┬──────────────────────┐
│ Nav  │ Main                                 │ Aside 380px          │
│ 72px │ - Command bar (Ctrl K) + jam         │ ┌──────────────────┐ │
│      │ - H1 sapaan                          │ │ Kontribusi kode  │ │ ~120px
│ logo │ - 3 kartu KPI (grid 3 kolom)         │ ├──────────────────┤ │
│ ikon │ - 2 panel: Hari ini | Item terbaru   │ │ Stage avatar     │ │ flex-grow
│  …   │                                      │ │ (Live2D) +caption│ │
│ set. │                                      │ │ chips aksi       │ │
│      │                                      │ │ [⌨] [🎤] [≡]     │ │
└──────┴──────────────────────────────────────┴──────────────────────┘
```

- Nav: ikon saja 48×48, radius 12. Item aktif pakai bg `surface-2` dan warna `accent`. Slot logo 40×40 di atas (**pakai logo Anchoa asli**).
- Main: padding 24/28, gap 18.
- Aside: bg `sidebar`, border kiri. Avatar harus jadi elemen paling dominan di aside.

## 2. Design tokens

### Warna
| Token | Hex | Pemakaian |
|---|---|---|
| `bg` | `#0F1115` | latar halaman |
| `sidebar` | `#0B0D10` | nav & aside |
| `surface` | `#171A21` | kartu, input |
| `surface-2` | `#1D2129` | hover, nav aktif, tile ikon |
| `stage` | `#12151B` | latar stage avatar |
| `stage-disc` | `#171B22` | lingkaran di belakang avatar |
| `border` | `#262B35` | semua garis/border 1px |
| `text` | `#E7E9EE` | teks utama |
| `muted` | `#9AA3B2` | label, meta, waktu |
| `text-done` | `#8A93A3` | tugas selesai (dicoret) |
| `disabled` | `#3A4150` | tombol nonaktif |
| `accent` | `#C6F36B` | lime: aksi utama, fokus, sukses |
| `accent-hover` | `#DDFA9E` | hover link |
| `danger` | `#FF8A7A` | coral: terlambat, pengeluaran, mikrofon aktif |
| `danger-row` | `#221A1C` | latar baris tugas terlambat |

Heatmap (5 level, gelap → terang): `#1A1E25` · `#2F3B1E` · `#4E6A26` · `#86B33A` · `#C6F36B`.

### Tipografi (Google Fonts)
- **Space Grotesk** 600: H1 28px (letter-spacing −0.01em), judul panel 15–16px.
- **IBM Plex Sans** 400/500/600: body 14px, label 12px, meta 11px.
- **JetBrains Mono** 400/500: angka, uang, tanggal, jam. KPI 26px, total kontribusi 22px.
- Label kecil: 11–12px, UPPERCASE, letter-spacing 0.08em, warna `muted`.

### Radius & spacing
- Radius: kartu 14 · input 10 · baris list 8 · stage 18 · caption 14 · chip/pill 999 · tombol bulat 50%.
- Gap umum: 4 / 8 / 12 / 14 / 18 / 24. Border selalu 1px `border`.

## 3. Komponen

**KPI cards** (3): Saldo total · Pengeluaran bulan ini (angka coral) · Tugas hari ini.
Tugas hari ini = jumlah tersisa + "· N terlambat" (coral, hanya jika ada) + **bar progres bersegmen** (1 segmen per tugas: selesai = accent, terlambat = danger, belum = border) + "x dari y selesai · Inbox n catatan".

**Hari ini (tugas)**: baris = `<label>` + checkbox asli (`accent-color: #C6F36B`) + judul + due (mono). Terlambat: bg `danger-row`, due coral. Selesai: teks dicoret + `text-done`. Mencentang langsung meng-update KPI.

**Item terbaru**: baris link dengan tile ikon 28×28 (bg `surface-2`, ikon 15px stroke): ide (bohlam, lime), catatan (dokumen), daftar (list).

**Kontribusi kode (ringkas, bukan detail)**:
- Heatmap 1 bulan ala GitHub: 7 baris (Sen–Min) × 5–6 kolom minggu, sel 10×10, gap 3, radius 2.
- Level: 0 → L0, 1–3 → L1, 4–6 → L2, 7–9 → L3, ≥10 → L4. Hari ini diberi border `text`. Hari mendatang = kosong dengan border `#2A303B`.
- Teks: total bulan · persen vs bulan lalu (lime naik / coral turun) · streak terpanjang.
- Riwayat: tombol ‹ › untuk pindah bulan (6 bulan terakhir). Tooltip per sel: "17 Sep: 12 kontribusi".
- Data asli dari GitHub GraphQL: `user { contributionsCollection { contributionCalendar { weeks { contributionDays { date contributionCount } } } } }` (butuh token). Cache per hari, jangan fetch tiap render.

**Asisten suara (voice-first: STT + TTS, mengetik jarang)**:
- Stage: avatar Live2D di tengah bawah, lingkaran `stage-disc` di belakang kepala.
- Kiri atas: chip status (4 batang gelombang + teks). Kanan atas: label kecil.
- Caption di bawah stage (bg `#0B0D10` alpha ~92%, border): baris 1 = transkrip STT pengguna (12px muted), baris 2 = balasan TTS (14px).
- Chips aksi cepat di bawah stage (pill, tinggi min 40): primer lime, sekunder outline.
- Kontrol: [Keyboard 48] [Mikrofon 64, primer] [Riwayat obrolan 48]. Input teks **tersembunyi** sampai tombol keyboard ditekan.

| State | Status | Warna | Kawanan teri & gelombang | Caption |
|---|---|---|---|---|
| `speaking` | Berbicara | accent | berputar / bergerak | transkrip + balasan |
| `listening` | Mendengarkan… | danger | berputar, mic berdenyut | "Mikrofon aktif · Silakan bicara…" |
| `idle` | Siap | muted | **pause**, opacity 0.45 | balasan terakhir |

Mic: tap saat `listening` → `idle`; tap saat lainnya → `listening`.

## 4. Identitas Anchoa (ikan teri)
- Logo tetap logo asli. Motif teri **hanya** di stage avatar: ±26 ikan kecil (badan lensa + ekor bercabang) membentuk cincin kawanan mengelilingi avatar, arah searah jarum jam. Bagian depan kawanan lebih rapat, lebih besar, dan lebih terang.
- Warna kawanan = warna state (`currentColor`), opacity per ikan 0.15–0.6.
- Satu SVG statis, diputar sebagai satu elemen. Bentuk path ada di file `.dc.html` (`<svg data-school>`).

## 5. Motion
```css
@keyframes anchoa-school { to { transform: rotate(360deg) } }            /* 48s linear infinite */
@keyframes anchoa-wave   { 0%,100% { transform: scaleY(.35) } 50% { transform: scaleY(1) } } /* 0.9s, delay berbeda per batang */
@keyframes anchoa-pulse  { 0% { transform: scale(1); opacity: .45 } 100% { transform: scale(1.7); opacity: 0 } } /* 1.6s, hanya saat listening */
```
- Hover: bg → `surface-2` (150ms). Tombol: hover `scale(1.05)`, active `scale(.95)`.
- Fokus: `:focus-visible` outline 2px accent, offset 2px. Field: border → `#4E6A26` saat `:focus-within`.
- Transisi warna state 400ms.

## 6. Aturan performa (wajib)
1. Animasi hanya `transform` dan `opacity`. Jangan animasikan width/height/top/left/box-shadow.
2. Semua animasi `animation-play-state: paused` saat `idle`. **Render loop Live2D juga dihentikan/diturunkan FPS-nya saat idle** (ini beban terbesar).
3. `@media (prefers-reduced-motion: reduce)` → matikan semua animasi.
4. Tanpa `backdrop-filter`/blur, partikel, atau animasi hitung-naik angka.
5. Pause animasi saat tab tidak terlihat (`document.visibilityState`).

## 7. Aksesibilitas
- Elemen interaktif pakai `<button>`, `<a href>`, `<input>` asli. Tombol ikon wajib `aria-label`.
- Status asisten dan label bulan pakai `aria-live="polite"`.
- Kontras teks ≥ 4.5:1 (sudah dipenuhi palet di atas pada `bg`/`surface`).
- Warna bukan satu-satunya penanda: terlambat juga ditandai teks "terlambat".
