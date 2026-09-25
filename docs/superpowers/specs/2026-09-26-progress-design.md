# Progress, Batal, dan Kegagalan di Tengah Batch — Desain

Tanggal: 2026-09-26. PRD: §4.8 ("eksekusi di worker dengan progress dan tombol batal"), §6.4.

## Perilaku

- Selama sebuah plan dieksekusi (`Msg::Run`, semua job), bar di bawah list menampilkan `gtk::ProgressBar` dengan teks `N of M` dan tombol **Cancel**. Bar muncul hanya bila eksekusi belum selesai setelah 300 ms, jadi operasi kecil tidak berkedip.
- Cancel menghentikan batch sebelum item berikutnya (`executor::execute` sudah mendukung `keep_going`); item yang sedang berjalan diselesaikan dulu. Sisanya `Pending`.
- Setelah selesai, bila hasilnya **parsial** (`Tally::is_partial`: ada yang selesai dan ada yang gagal/belum diproses), muncul dialog: heading `Stopped partway`, isi `D done, F failed, P not processed` plus pesan error pertama bila ada. Tombol **Keep** (default, Esc) dan **Roll Back**. Roll Back = `Msg::Undo` (jalur undo yang sudah ada, dengan preview-nya). Operasi sudah tercatat `partial` di history, jadi Keep tetap bisa di-undo nanti.
- Tidak parsial: perilaku sekarang (toast ringkasan + Undo).
- Satu eksekusi dalam satu waktu: selama berjalan, `Msg::Run` baru ditolak dengan toast `Another operation is still running`.

## Unit

- `executor::Tally { done, skipped, failed, pending: usize }` (Debug, Clone, Copy, PartialEq, Eq), `Tally::of(&[ItemStatus])`, `Tally::is_partial()` = `done > 0 && (failed > 0 || pending > 0)`.
- Binary: progress dikirim dari worker lewat `keep_going(i)` (dipanggil sebelum item `i`) ke UI thread; batal lewat `Arc<AtomicBool>` yang dibaca di `keep_going`. `file_ops::run` menerima callback/flag itu; `file_ops::summary` memakai `Tally`.

## Test (ditulis dulu, pelaksana tidak boleh mengubah)

`tests/executor.rs`: `tally_counts_each_outcome`, `partial_means_something_done_and_something_not`. Pembatalan di executor sudah dites (`cancelling_leaves_the_rest_pending`).

UI (bar progress, Cancel, dialog parsial, penolakan run kedua) diuji manual.
