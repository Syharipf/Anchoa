# Anchoa Browser Extension

Ekstensi browser untuk mengintegrasikan pengunduhan web secara langsung ke pengelola unduhan desktop Anchoa.

## Fitur
- Context Menu: Klik kanan pada tautan apa pun dan pilih **Unduh dengan Anchoa**.
- Interception (Opt-in): Opsi pengalihan otomatis unduhan HTTP(S) GET dari browser ke Anchoa.
- Jaminan Keamanan:
  - Hanya mendukung permintaan HTTP(S) GET publik.
  - Unduhan sesi/cookie privat, `POST`, `blob:`, dan `data:` tetap diproses browser.
  - Komunikasi terlindungi melalui host pesan lokal (`io.github.syharipf.anchoa.downloads`).

## Pemasangan

### Google Chrome / Chromium / Brave
1. Buka `chrome://extensions/` dan aktifkan **Developer mode**.
2. Klik **Load unpacked** dan pilih folder `browser-extension/`.
3. Salin Extension ID yang terbentuk (32 karakter huruf a-p).
4. Buka **Anchoa > Pengaturan > Integrasi > Browser**, masukkan Extension ID, lalu klik **Pasang Manifest**.

### Mozilla Firefox
1. Buka `about:debugging#/runtime/this-firefox`.
2. Klik **Load Temporary Add-on...** dan pilih file `manifest-firefox.json`.
3. Buka **Anchoa > Pengaturan > Integrasi > Browser** dan klik **Pasang Manifest Firefox**.
