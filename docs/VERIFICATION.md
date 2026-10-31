# Verification record — 20 Oktober 2026 (WIB)

Pekerjaan hanya lokal. Tidak ada deployment, push GitHub, resource berbayar, credential asli atau perubahan aplikasi existing.

## Hasil yang telah dijalankan

- Source/syntax serta referensi UI: PASS. Semua ID HTML unik dan selector literal JavaScript mengacu ke elemen yang tersedia. Tidak ada innerHTML/localStorage/sessionStorage di frontend.
- Unit/HTTP baseline: 67 PASS pada Node 24.20.0; pengujian final termasuk outbox dan DB gate: **71 PASS, 0 fail, 0 skip pada Node 22.23.3**. Pemeriksaan awal terhalang sandbox spawn EPERM; retry dengan izin yang sesuai lulus. Script packaging menjalankan ulang pemeriksaan dan seluruh unit test sebelum membuat arsip.
- `pnpm@11.19.0 install --frozen-lockfile --ignore-scripts`: PASS. Dependency dipin: pg 8.23.0, @nats-io/jetstream dan transport-node 3.4.0. Instalasi host awal menggunakan pnpm 11.25.0; tool yang dipin juga telah dijalankan tanpa mengubah instalasi global.
- Integration command: **1 SKIP, 0 live test executed** karena RUN_INTEGRATION tidak diaktifkan dan tidak ada dependency terisolasi yang disediakan.
- Browser lokal: login fixture, tiga tab, preset fail-first, empty state, penolakan submit read-only, navigasi keyboard Left, logout, serta reload yang menghapus sesi sudah diperiksa. Fixture berlabel UI PREVIEW dan bukan DB/Queue runtime.
- Reflow Overview, Jobs, Test Scenarios diperiksa pada 375, 768, 1024 dan 1280 px: setelah perbaikan grid, tidak ada page-level horizontal overflow pada seluruh 12 kombinasi. Pemeriksaan geometri/reflow, bukan sertifikasi aksesibilitas lengkap.
- Tag image publik resmi diperiksa di registry: node 22.23.3-alpine dan postgres 16.13-alpine ada; daftar tag resmi NATS menyediakan 2.12.11-alpine, yang kemudian dipin pada Compose. Pembacaan metadata image bukan build/container smoke test.

## Batas verifikasi

Docker/Compose tidak ditemukan pada PATH; container build, healthcheck container, PostgreSQL SQL live, JetStream persistence/redelivery, test dua replica/restart serta NEO App ingress/binding/billing belum dieksekusi. Tidak ada pengujian production atau secret asli. Unit repository menggunakan scripted SQL client, bukan database sungguhan. Dashboard detail hasil dan retry live masih perlu integration/operator acceptance.

## Arsip

Script packaging menjalankan pemeriksaan source dan unit test lagi, memakai allowlist, menolak link/secret-file paths, menaruh Dockerfile/manifest/lockfile di root ZIP dan membandingkan SHA-256 setiap decompressed entry dengan source. Hasil ukuran, jumlah entry dan hash ZIP dilaporkan setelah script selesai. Hash ZIP tidak ditulis di dalam ZIP agar tidak menimbulkan referensi checksum rekursif. Arsip existing disimpan sebagai backup bertimestamp jika script diulang.
