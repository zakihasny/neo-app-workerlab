# Worker Validation Lab

Dashboard dan API untuk memeriksa **Worker terpisah**, PostgreSQL 16 dan NATS JetStream. Source ini bukan static site murni dan bukan browser Service Worker.

```text
Browser → Web/API → PostgreSQL: job + transactional outbox
              └→ JetStream → Worker → PostgreSQL: result, attempts, events, heartbeat
```

Web hanya menjadi producer/outbox publisher; consumer hanya dijalankan oleh `APP_ROLE=worker`. Job: echo, SHA-256, delay 1–10 detik, fail-first, always-fail. Maksimal tiga attempt, jeda retry 5/15 detik, dead-letter outbox, idempotency key dan satu effect per job. Pengiriman transport tetap at-least-once.

## Local setup dengan Docker Compose

Prasyarat: Docker Engine/Desktop + Compose v2. Untuk Node langsung: Node 22+, pnpm 11.19.0, PostgreSQL 16 dan NATS JetStream.

1. Salin `.env.example` ke `.env` secara lokal. Ganti `POSTGRES_PASSWORD`, `NATS_PASSWORD`, dan `API_TOKEN` dengan **tiga nilai acak berbeda**, URL-safe (misalnya hex). API token minimal 32 karakter. Jangan memakai placeholder. Contoh perintah membuat satu nilai acak: `node --input-type=module -e "import {randomBytes} from 'node:crypto'; console.log(randomBytes(32).toString('hex'))"`. Jalankan sendiri; jangan simpan hasil dalam source.
2. Untuk Compose, URL internal disusun dari password di atas. Jika menjalankan Node langsung, isi juga `DATABASE_URL` dan `NATS_URL` secara lengkap pada `.env`; tidak ada interpolasi variabel dalam file env Node.
3. Jalankan:

```sh
docker compose up -d db queue
docker compose build
docker compose run --rm migrate
docker compose run --rm queue-setup
docker compose up -d web worker
```

4. Buka `http://127.0.0.1:8080`, masukkan API_TOKEN aplikasi. Jangan memasukkan API key akun NEO App.
5. Submit Echo melalui tab Jobs. Periksa Detail: completed, result benar, effectCount=1, worker_id terisi. Key yang sama + payload sama mengembalikan job yang sama. Ganti key untuk job baru.
6. `docker compose stop` menghentikan service tanpa menghapus data. Jangan memakai `down -v` jika ingin mempertahankan volume.

DB dan NATS hanya dipublikasikan pada loopback untuk development. Jangan menyalin konfigurasi ini menjadi endpoint database/broker publik. HTTP di loopback hanya untuk lokal; dashboard cloud harus HTTPS.

### Node langsung (bukan Compose)

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm migrate
pnpm queue:setup
pnpm web
# Terminal kedua, dengan .env yang sama:
pnpm worker
```

Port host DB/Queue pada Compose adalah 55432 dan 14222. Container memakai db:5432 dan queue:4222. Di NEO App pakai binding private platform, bukan salah satu alamat lokal ini.

## Pemeriksaan dan packaging

```sh
pnpm check
pnpm test
pnpm test:integration
```

Integration secara default **SKIP**, bukan PASS. Lihat [panduan pengujian](docs/TESTING.md) untuk isolated test stack. `pnpm build` adalah validasi source, bukan bundler atau container build.

`pnpm preview:ui` menjalankan fixture UI read-only pada loopback/port acak, tanpa DB/Queue. Token CI-only dicetak oleh script. Header menampilkan UI PREVIEW, angka adalah fixture kosong, bukan hasil runtime. Script ini tidak dipakai oleh Docker CMD atau deployment.

PowerShell 7:

```powershell
pwsh -NoProfile -File ./scripts/package-local.ps1
```

Script menjalankan source check dan unit test, menggunakan allowlist, memverifikasi semua hash entry ZIP, dan menaruh `Dockerfile`, `package.json`, `pnpm-lock.yaml` di root arsip. ZIP existing dipindahkan ke backup bertimestamp setelah arsip baru lolos verifikasi. Arsip tidak memuat `.env` aktual, node_modules, log atau ZIP lain.

## Deployment

**ZIP yang sama** di-upload dua kali sebagai dua tipe service:

- Web Service: `APP_ROLE=web`, `PORT=8080`, bind `0.0.0.0`.
- Worker Service: `APP_ROLE=worker`, `WORKER_CONCURRENCY=1`, tanpa HTTP/domain publik.

DB/Queue dibuat terpisah. Lihat [runbook NEO App](docs/DEPLOY_NEO_APP.md), [kontrak aplikasi](PROJECT.md) dan [hasil verifikasi aktual](docs/VERIFICATION.md). Jangan menganggap arsip source sebagai prebuilt image atau bukti deployment berhasil.

## Batasan

- Single operator bearer token, bukan SSO/RBAC. Token hanya dalam memori tab, tidak localStorage/sessionStorage.
- Hanya data sintetis; tidak ada salary/HR, upload, shell command, email atau akses token control-plane.
- Maksimal 100 job dan 50 Worker terakhir per daftar; tidak ada search/export/pagination.
- Dashboard membaca heartbeat tiap 5 detik, stale setelah 30 detik; worker stopped terdeteksi saat graceful shutdown. Tidak ada grafik CPU/RAM atau data runtime simulasi.
- Restart/scaling, pengujian gangguan DB/Queue dan cleanup dilakukan operator. Tidak ada endpoint crash/restart.
- Web/Worker harus tetap berjalan untuk memproses job/outbox. Dead-letter outbox yang tersimpan belum tentu sudah terkirim: periksa `delivered_at`.
- `fail-first` menghitung attempt handler yang dipersist; crash juga dapat menghabiskan satu attempt. Maksimal tiga attempt termasuk interrupted attempt.
- Source tidak mengonfigurasi ingress, persetujuan provisioning, TLS atau tarif platform secara otomatis.
