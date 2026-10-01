# Anchoa — Fase 4B: Catatan

Tanggal: 2026-10-01
Status: user memilih halaman Catatan baru di sidebar, terpisah dari Jurnal, dan editor blok Markdown buatan sendiri (bukan BlockNote). User menyetujui desain di bawah pada 2026-10-01. Keputusan detail di §2 diambil Claude dan bisa diubah nanti. Tidak ada artboard; tampilan mengikuti `docs/design/DESIGN.md`, `tokens.css`, dan pola halaman Jurnal serta Berkas.

## 1. Ringkasan

Isi Fase 4 lama yang menunggu keputusan user:
- **Pohon halaman:** halaman bersarang tanpa batas, dengan halaman baru, subhalaman, ganti nama, pindahkan, hapus, dan Sampah dengan Pulihkan;
- **Editor blok:** isi tetap Markdown, dengan satu blok per paragraf, judul, daftar, tugas, kutipan, atau kode;
- **`[[wikilink]]`:** tautan antar halaman dan item lain, saran saat mengetik `[[`, dan panel "Disebut di" (backlink);
- **Pencarian FTS5:** di halaman Catatan dan di command palette, untuk semua item;
- **Ekspor Markdown:** seluruh pohon menjadi folder dan file `.md` yang bisa dibuka Obsidian.

## 2. Keputusan

| Kode | Keputusan | Alasan |
|---|---|---|
| C1 | Halaman adalah item `type = 'page'`. Pohon memakai `items.parent_id`, dan induk sebuah halaman harus halaman juga. Tanpa tabel ekstensi. | Prinsip "semua hal adalah item". Kolom `parent_id` dan indeksnya sudah ada. |
| C2 | Urutan saudara: judul, tanpa membedakan huruf besar dan kecil. Urutan manual (seret) menyusul. | YAGNI. Kolom urutan bisa ditambah nanti tanpa memecah data. |
| C3 | Isi halaman adalah Markdown di `items.body`, tanpa judul di dalamnya (judul ada di `items.title`). | Ekspor dan sync tidak perlu konversi. |
| C4 | Editor blok buatan sendiri, tanpa dependency baru. Blok dipisah baris kosong, dan blok kode (```) tidak pernah dipecah. Satu daftar (beberapa baris `- `) adalah satu blok. | Dipilih user. Satu daftar satu blok membuat Markdown tetap utuh. |
| C5 | Pratinjau Markdown dirender menjadi elemen React, tanpa `dangerouslySetInnerHTML`. Yang didukung: judul `#`–`###`, daftar `-`/`*`, daftar bernomor, tugas `- [ ]`/`- [x]`, kutipan `>`, blok kode, serta inline `**tebal**`, `*miring*`/`_miring_`, `` `kode` ``, `[teks](https://…)`, dan `[[wikilink]]`. Sisanya tampil sebagai teks biasa. | Aman dari XSS, dan cukup untuk catatan pribadi. |
| C6 | `[[Judul]]` dan `[[Judul\|alias]]`. Tautan dicari: halaman dengan judul sama (tanpa membedakan huruf besar dan kecil), lalu item lain yang tidak terhapus dengan judul sama, yang terbaru diperbarui dulu. Isi blok kode dan kode inline diabaikan. | Sama dengan Obsidian, dan halaman diutamakan. |
| C7 | Tabel `links (from_id, to_id)` diisi ulang dari isi item setiap kali isinya disimpan: `save_page_body`, `update_item`, dan simpan entri Jurnal. Tautan yang belum ada tujuannya tidak disimpan; UI mengenalinya dari teks. | Backlink cepat tanpa mem-parse semua isi. |
| C8 | Ganti nama halaman menulis ulang `[[Lama]]` dan `[[Lama\|…` menjadi `[[Baru]]` dan `[[Baru\|…` di semua item yang menautkannya (dari `links`), dalam satu transaksi. | Tautan tidak pernah putus. |
| C9 | Hapus halaman melakukan soft delete pada halaman itu dan semua turunannya dengan `deleted_at` yang sama. Sampah menampilkan akar setiap penghapusan. Pulihkan mengembalikan baris dengan `deleted_at` itu di subpohonnya. Kalau induknya masih terhapus, halaman kembali ke akar. Tidak ada hapus permanen. | Bisa dibatalkan, dan aman untuk sync Fase 9. |
| C10 | Pindahkan memakai dialog "Pindahkan ke…" yang berisi daftar halaman dan "Akar". Memindahkan ke diri sendiri atau ke turunan sendiri ditolak di Rust. | Seret-lepas menyusul. |
| C11 | FTS5 berupa tabel berisi sendiri `items_fts(item_id UNINDEXED, title, body)` dengan tokenizer `unicode61 remove_diacritics 2`, dijaga trigger `items` (insert, delete, dan update `title`/`body`). Tidak memakai `content='items'`, karena `rowid` tabel `items` (kunci TEXT) bisa berubah saat `VACUUM` atau backup. | Indeks tetap benar setelah backup dan restore. `ponytail:` hapus lewat `item_id` memindai tabel; cukup untuk ribuan item. |
| C12 | Kueri pencarian: tiap kata dikutip, dan kata terakhir diberi `*` (awalan). Peringkat memakai `bm25` dengan bobot judul 5 dan isi 1. Cuplikan memakai `snippet()` dengan penanda `\u0002…\u0003`, yang dirender sebagai `<mark>`. Item terhapus disaring. | Hasil muncul sambil mengetik, dan judul diutamakan. |
| C13 | Pencarian di halaman Catatan hanya mencari halaman. Command palette mencari semua item (halaman, entri Jurnal, tugas, dan lainnya), maksimal 8 hasil. Pencarian Jurnal tetap memakai `LIKE` (N5). | Ruang lingkup jelas. Jurnal bisa pindah ke FTS nanti. |
| C14 | Ekspor menulis ke `<XDG Dokumen>/Anchoa Catatan/`. Setiap halaman menjadi `<Judul>.md`. Halaman yang punya turunan juga mendapat folder `<Judul>/` di sebelahnya, berisi turunannya (gaya folder note Obsidian). Nama disanitasi dengan `safe_name` dan dibuat unik untuk judul kembar. File lain di folder itu tidak dihapus. | Data bisa dibawa keluar dan dibuka di Obsidian. |
| C15 | Item `type = 'page'` selalu dibuka di halaman Catatan, termasuk dari command palette, Catatan terbaru, dan klik wikilink. Item lain dibuka seperti biasa. | Satu editor untuk halaman. |
| C16 | Simpan otomatis 600 ms setelah ketikan terakhir, dan juga saat blur, pindah halaman, atau unmount. | Tidak ada tombol Simpan, seperti Jurnal. |
| C17 | Tautan luar hanya `http` dan `https`, dibuka di browser lewat command `open_link` yang memvalidasi skema. | Tidak membuka skema berbahaya. |
| C18 | Nav: "Catatan" tepat di bawah Jurnal. | Dipilih user: halaman baru, terpisah dari Jurnal. |

## 3. Model data

### Migrasi `009_notes.sql`

```sql
CREATE TABLE links (
  from_id TEXT NOT NULL REFERENCES items(id),
  to_id   TEXT NOT NULL REFERENCES items(id),
  PRIMARY KEY (from_id, to_id)
);
CREATE INDEX links_to ON links(to_id);

CREATE VIRTUAL TABLE items_fts USING fts5(
  item_id UNINDEXED, title, body,
  tokenize = 'unicode61 remove_diacritics 2'
);
INSERT INTO items_fts (item_id, title, body) SELECT id, title, body FROM items;

CREATE TRIGGER items_fts_insert AFTER INSERT ON items BEGIN
  INSERT INTO items_fts (item_id, title, body) VALUES (new.id, new.title, new.body);
END;
CREATE TRIGGER items_fts_delete AFTER DELETE ON items BEGIN
  DELETE FROM items_fts WHERE item_id = old.id;
END;
CREATE TRIGGER items_fts_update AFTER UPDATE OF title, body ON items BEGIN
  DELETE FROM items_fts WHERE item_id = old.id;
  INSERT INTO items_fts (item_id, title, body) VALUES (new.id, new.title, new.body);
END;
```

Item terhapus (soft delete) tetap ada di indeks. Kueri menyaring lewat `JOIN items ... WHERE deleted_at IS NULL`.

## 4. Backend

- **`notes.rs`:** fungsi murni di atas `Connection`.
  - `tree(conn) -> Vec<PageNode { id, title, parent_id, updated_at }>`: semua halaman yang tidak terhapus, urut judul. Frontend menyusun pohonnya.
  - `create(conn, parent_id: Option<&str>, title, now) -> PageNode`: judul kosong menjadi "Tanpa judul", dan induk harus halaman yang tidak terhapus.
  - `rename(conn, id, title, now)`: menulis ulang tautan (C8).
  - `move_page(conn, id, parent_id: Option<&str>, now)`: menolak siklus (C10).
  - `save_body(conn, id, body, now)`: menyimpan isi dan mengisi ulang `links` (C7).
  - `delete(conn, id, now)`, `trash(conn)`, `restore(conn, id, now)` (C9).
  - `export(conn, root_dir) -> PathBuf` (C14).
- **`links.rs`:**
  - `parse(body) -> Vec<String>`: judul unik, tanpa alias, dan tanpa isi kode (C6);
  - `resolve(conn, title) -> Option<ItemSummary>`;
  - `refresh(conn, from_id, body)`: dipakai `save_body`, `items::update`, dan simpan entri Jurnal;
  - `backlinks(conn, id) -> Vec<ItemSummary>`: item yang tidak terhapus, terbaru dulu;
  - `rewrite(body, old, new) -> String`.
- **`search.rs`:** `search(conn, query, pages_only, limit) -> Vec<SearchHit { item: ItemSummary, snippet }>` (C12). Kueri kosong menghasilkan daftar kosong.
- **Command:**
  - `pages_tree`, `create_page`, `rename_page`, `move_page`, `save_page_body`;
  - `delete_page`, `pages_trash`, `restore_page`;
  - `page_backlinks`, `resolve_link`, `search_items`;
  - `export_pages`: mengembalikan path folder;
  - `open_link` (C17).
  - `get_item` yang sudah ada dipakai untuk membuka halaman.
- **Validasi:** judul dipangkas dan maksimal 200 karakter, induk harus halaman, id harus ada dan tidak terhapus.

## 5. UI

Halaman `src/notes/` dengan tiga kolom:
- **Kolom kiri (260px):**
  - kotak cari: hasil FTS halaman dengan cuplikan, dan klik membuka halamannya;
  - tombol "+ Halaman baru";
  - pohon dengan panah buka/tutup per simpul, yang diingat di `localStorage`;
  - menu "⋯" per simpul: Subhalaman baru, Ganti nama, Pindahkan ke…, Hapus;
  - di bawah: "Sampah (n)" dan "Ekspor Markdown".
- **Tengah:**
  - breadcrumb induk (bisa diklik);
  - judul yang bisa diedit (H1, Enter pindah ke blok pertama);
  - editor blok;
  - waktu "Diperbarui …".
  - Halaman kosong menampilkan petunjuk "Ketik / untuk jenis blok, [[ untuk menautkan".
- **Kolom kanan (280px):** "Disebut di" berisi daftar backlink (judul, jenis, cuplikan baris yang menautkan), atau "Belum ada yang menautkan halaman ini."
- **Tanpa halaman terpilih:** daftar halaman yang terakhir diperbarui, atau keadaan kosong "Belum ada halaman" dengan tombol "Buat halaman pertama".
- **Sampah:** dialog berisi daftar akar penghapusan (judul, waktu dihapus, jumlah subhalaman) dengan tombol "Pulihkan".
- **Ekspor:** toast "Diekspor ke …" dengan aksi "Buka di Berkas".

### Editor blok

- **Model:** `splitBlocks(body) -> Block[]` dan `joinBlocks(blocks) -> string`, keduanya fungsi murni di `src/notes/blocks.ts`. `joinBlocks(splitBlocks(x))` hanya merapikan baris kosong berlebih. `splitBlocks(joinBlocks(b))` sama dengan `b`.
- **Jenis blok** dibaca dari baris pertama: `heading1`–`heading3`, `todo`, `bullet`, `numbered`, `quote`, `code`, dan `paragraph`.
- **Mode:**
  - satu blok aktif tampil sebagai `textarea` dengan tinggi otomatis, berisi Markdown mentah blok itu;
  - blok lain tampil sebagai pratinjau;
  - klik pratinjau mengaktifkan blok itu;
  - klik link atau checkbox di pratinjau tidak mengaktifkan blok.
- **Tombol:**
  - Enter di paragraf, judul, atau kutipan memecah blok di posisi kursor. Shift+Enter menambah baris baru di blok yang sama.
  - Enter di daftar menambah baris dengan penanda yang sama (nomor bertambah, dan tugas baru belum dicentang). Enter di baris daftar yang kosong menghapus baris itu dan membuat paragraf baru setelahnya.
  - Enter di kode menambah baris baru. Esc atau Ctrl+Enter keluar.
  - Backspace di awal blok kosong menghapus blok itu dan pindah ke akhir blok sebelumnya. Backspace di awal blok berisi menggabungkannya ke blok sebelumnya.
  - Panah atas di baris pertama dan panah bawah di baris terakhir pindah ke blok sebelumnya atau berikutnya.
  - Esc keluar dari mode edit.
- **Menu `/`:** muncul saat blok kosong diketik `/`. Pilihannya Teks, Judul 1, Judul 2, Judul 3, Daftar, Daftar bernomor, Tugas, Kutipan, dan Kode. Menu disaring sambil mengetik, dan dipilih dengan Enter atau panah.
- **Saran `[[`:**
  - saat mengetik `[[` di textarea, muncul daftar judul halaman yang cocok dengan teks setelah `[[`;
  - baris terakhir: "Buat halaman \"…\"";
  - memilih menyisipkan `[[Judul]]`; pilihan "Buat" juga membuat halamannya di akar, seperti Obsidian.
- **Pratinjau:**
  - wikilink yang punya tujuan tampil berwarna aksen, dan yang belum punya tujuan tampil dengan garis putus;
  - klik wikilink membuka item tujuannya, atau membuat halaman di akar lalu membukanya (C15);
  - checkbox tugas langsung mengubah `[ ]` dan `[x]`, lalu menyimpan.
- **Aksesibilitas:** setiap pratinjau blok adalah elemen dengan `role="button"`, `tabIndex=0`, dan Enter untuk mengedit (aturan Sonar S1082).

### Command palette

Teks yang diketik juga dicari lewat `search_items` (semua jenis, maksimal 8, debounce 150 ms). Hasilnya tampil di grup "Item" di bawah perintah. Halaman dibuka di Catatan (C15).

## 6. Testing

- **Rust:**
  - migrasi v8→v9: FTS terisi dari item lama;
  - pohon dan urutan judul;
  - induk harus halaman;
  - siklus ditolak saat pindah;
  - hapus dan pulihkan subpohon, termasuk induk yang masih terhapus;
  - Sampah hanya berisi akar;
  - ganti nama menulis ulang tautan, termasuk alias, tanpa menyentuh judul yang hanya mirip;
  - `parse` mengabaikan kode dan alias, dan judulnya unik;
  - `resolve` mendahulukan halaman;
  - backlink tidak berisi item terhapus;
  - FTS: awalan, diakritik, bobot judul, item terhapus disaring, dan indeks benar setelah ganti judul atau isi;
  - ekspor: susunan folder, judul kembar, dan nama berbahaya.
- **Frontend (`bun test`):**
  - `splitBlocks` dan `joinBlocks` bolak-balik, termasuk blok kode berisi baris kosong;
  - deteksi jenis blok;
  - transformasi Enter dan Backspace sebagai fungsi murni;
  - menu `/` mengubah penanda;
  - renderer inline: tebal, miring, kode, tautan http saja, wikilink dan alias;
  - kueri saran `[[`.
- **E2E (`check_notes`):**
  - buat halaman "Rencana", ketik paragraf dan daftar tugas, lalu cek `items.body` di DB;
  - ketik `[[Ide baru]]`, klik tautannya, dan halaman "Ide baru" terbuat; panel "Disebut di" di halaman itu menampilkan "Rencana";
  - ganti nama "Ide baru" menjadi "Ide besar", lalu cek isi "Rencana" berisi `[[Ide besar]]`;
  - cari "renc" dan "Rencana" muncul;
  - hapus "Rencana", pulihkan dari Sampah, dan halamannya kembali;
  - ekspor, lalu cek `Rencana.md` ada di folder ekspor (HOME sementara);
  - screenshot.

## 7. Rencana PR

| PR | Isi |
|---|---|
| 4B-1 | Migrasi 009, `notes.rs`, `links.rs`, `search.rs`, command, tipe API |
| 4B-2 | `blocks.ts`, `markdown.tsx` (renderer), `BlockEditor.tsx`, dan test-nya |
| 4B-3 | Halaman Catatan (pohon, Sampah, ekspor, backlink), nav, palette, E2E, versi 0.9.0, rilis "Anchoa v0.9.0 — Catatan" |
