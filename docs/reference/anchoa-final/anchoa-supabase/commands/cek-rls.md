---
description: Audit Row Level Security & keamanan skema
---

Audit keamanan skema di `supabase/migrations/` dan fungsi di `supabase/functions/`.

Periksa dan laporkan dalam tabel (Tabel/Fungsi · Temuan · Tingkat · Perbaikan):
1. Setiap tabel di schema `public` punya `enable row level security`.
2. Setiap tabel data pengguna punya policy select/insert/update/delete yang membatasi `user_id = (select auth.uid())`, dengan `with check` pada insert/update. Tidak ada `using (true)` atau akses `anon` ke data pengguna.
3. Foreign key ke tabel lain tidak bisa dipakai untuk menautkan ke data milik pengguna lain.
4. Fungsi SQL `security definer` (jika ada) punya `set search_path` yang aman dan alasan yang jelas.
5. View tidak membocorkan data lintas pengguna (pakai `security_invoker`).
6. Setiap policy punya test pgTAP (pemilik boleh, pengguna lain ditolak, anon ditolak). Sebutkan tabel yang belum tercakup.
7. Edge Functions: `verify_jwt`, CORS terbatas, validasi input, rate limit, tidak ada service role yang bocor ke respons/log, rahasia tidak di-hardcode.
8. Jalankan `supabase db lint` dan laporkan hasilnya.

Jangan mengubah kode sebelum aku setuju.
