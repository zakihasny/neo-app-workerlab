# Runbook NEO App — belum dieksekusi

Target contoh: **portal staging** `https://portal.neoapp.biznetgio.dev`, environment project **Staging**. Portal/control-plane dan environment project adalah dua hal berbeda. Jangan memakai resource existing atau mengganti koneksi CLI default tanpa permintaan user. Tidak ada resource dibuat pada pengiriman source ini.

## Empat resource terpisah

| Nama contoh | Tipe | Konfigurasi awal |
|---|---|---|
| workerlab-db | NEO DB | PostgreSQL 16, single instance, Micro, 10 GiB, private |
| workerlab-queue | NEO Queue | NATS JetStream, Micro, 1 GiB, private |
| workerlab-web | Web Service | Dockerfile source ZIP, Micro 0.5 vCPU / 0.5 GB, 1 replica |
| workerlab-worker | Worker | Dockerfile source ZIP yang sama, Micro, 1 replica |

Tidak membutuhkan Cron, Object Storage, persistent disk aplikasi atau domain Worker. Persetujuan biaya dan harga terkini harus diperiksa sebelum provisioning. Tarif message Queue, build, egress, storage dan pajak bisa menjadi tambahan. Jangan memakai estimasi source sebagai quotation final.

## Urutan dashboard

1. Pilih organisasi/project khusus pengujian dan environment Staging. Buat NEO DB PostgreSQL **16** dan NEO Queue; tunggu siap. Jangan membuka akses publik.
2. Add service → Web Service → Local source → pilih `worker-validation-lab.zip`. Build dengan Dockerfile root, bukan static site. Jika builder meminta start command: `node src/start.js`.
3. Sebelum startup, pasang binding DB sebagai `DATABASE_URL` dan Queue sebagai `NATS_URL`. Jangan menyalin credential ke kode/ZIP/browser. Binding harus berasal dari project/environment yang sama.
4. Atur variabel Web pada tabel di bawah. Untuk bootstrap pertama pada DB/namespace **baru**, aktifkan `RUN_MIGRATIONS_ON_START=true` dan `QUEUE_AUTO_SETUP=true` pada Web saja. Credential bootstrap perlu izin DDL PostgreSQL dan manajemen stream/consumer. Kedua flag hanya opt-in; startup gagal jika inisialisasi tidak berhasil.
5. Deploy Web. Periksa log terstruktur `migration_applied` dan `web_ready`. Setelah berhasil, ubah kedua flag menjadi false lalu restart/redeploy sesuai kemampuan dashboard. Jangan menyebut migration berhasil hanya karena build image sukses. Bootstrap yang diulang bersifat idempotent; jangan mengganti namespace untuk menyembunyikan error koneksi.
6. Add service → **Worker** → Local source → ZIP yang sama → Dockerfile root. Start command `node src/start.js` (atau `node src/worker.js`); set `APP_ROLE=worker` dan pasang kedua binding yang sama. Jangan memilih tipe Web atau memasang domain/port untuk Worker.
7. Isi concurrency aplikasi secara eksplisit melalui `WORKER_CONCURRENCY=1`. Field concurrency dashboard tidak diasumsikan otomatis menjadi env yang dibaca aplikasi; jangan menyamakan concurrency dengan replicas. Autoscaling off, replicas 1.
8. Deploy Worker. Periksa `worker_ready`, lalu buka URL HTTPS **Web** dan masuk dengan API_TOKEN aplikasi. Worker harus muncul online setelah heartbeat. Tidak ada URL Worker yang perlu dibuka.
9. Submit Echo; pastikan completed, result benar, worker_id ada, effectCount=1. Ulangi key identik untuk membuktikan deduplikasi. Jalankan skenario pada docs/TESTING.md.

Jika tersedia fasilitas one-off command, gantikan langkah bootstrap startup dengan `node src/migrate.js`, lalu `node src/queue-setup.js` memakai image yang sama. Jangan memakai command tersebut sebagai proses Worker permanen: keduanya selesai setelah setup. Setelah bootstrap, runtime masih perlu akses metadata consumer + publish/consume yang digunakan library; uji izin sebelum mengurangi privilege, jangan mengklaim ACL least-privilege otomatis diterapkan.

## Variabel per service

| Variabel | Web | Worker |
|---|---|---|
| APP_ROLE | web | worker |
| DATABASE_URL | secret binding DB baru | secret binding DB yang sama |
| NATS_URL | secret binding Queue baru | secret binding Queue yang sama |
| QUEUE_NAMESPACE | workerlab_staging | workerlab_staging |
| API_TOKEN | secret acak ≥32 karakter | tidak diperlukan |
| NODE_ENV | production | production |
| HOST / PORT | 0.0.0.0 / 8080 | tidak diperlukan |
| WORKER_CONCURRENCY | tidak dipakai | 1 |
| RUN_MIGRATIONS_ON_START | true bootstrap saja, lalu false | false |
| QUEUE_AUTO_SETUP | true bootstrap saja, lalu false | false |

NATS_URL mendukung nats:// atau tls://, satu host, user/password URL-encoded atau token. Jangan menonaktifkan verifikasi TLS. URL multi-host tidak didukung oleh parser aplikasi ini; gunakan satu endpoint binding yang didukung.

## Health dan observabilitas

- Web liveness `/healthz`; readiness `/health/ready`. Readiness menguji DB dan Queue, bukan pekerjaan Worker. Tambahkan startup grace minimal 60 detik, lebih lama saat bootstrap jika platform memerlukannya.
- Tidak memasang HTTP probe Web pada Worker. Dockerfile menyediakan `node src/healthcheck.js` yang membaca heartbeat file untuk role worker; apakah NEO menjalankan HEALTHCHECK image/exec probe harus diperiksa di platform, bukan diasumsikan.
- Bukti Worker sehat adalah heartbeat **dan** job sintetis selesai. Dashboard/API mengambil data dari DB, bukan polling control-plane NEO.
- `neo_get_logs` dapat dipakai operator untuk log Worker; status configuration bukan bukti bahwa job sedang dikonsumsi. Worker tidak menyimpan token MCP/CLI.
- SIGTERM mencoba drain maksimal 20 detik sebelum exit; broker redelivery + DB lease memulihkan job yang terinterupsi. Timing shutdown grace platform belum divalidasi live.

## Batas pengiriman

ZIP ini source bundle untuk server-side build, bukan image registry. Dockerfile berisi EXPOSE 8080 agar image dapat dipakai Web; role Worker tetap tidak membuka listener. Belum ada deploy, billing approval, TLS ingress, live platform probe atau restart/scaling yang dieksekusi oleh pengiriman ZIP.
