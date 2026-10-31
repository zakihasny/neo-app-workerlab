# Testing dan bukti kelulusan

## Unit/source

`pnpm check`, `pnpm test`, `pnpm build`. Unit menggunakan fake/scripted repository, transaction client dan broker. Lulus unit tidak membuktikan SQL atau NATS hidup. HTTP unit benar-benar membuka listener loopback ephemeral; dependency bisnisnya fake. Tidak ada data runtime palsu pada dashboard produksi.

## Integration terisolasi

```sh
docker compose -f compose.test.yaml up --build --abort-on-container-exit --exit-code-from integration
```

Test stack memakai tmpfs dan credential **CI-only** yang sengaja non-rahasia. Tidak memakai .env aplikasi atau volume local development. Seusai pemeriksaan: `docker compose -f compose.test.yaml down` untuk membersihkan container test, bukan volume/source aplikasi lain. Jangan menjalankan terhadap service aplikasi existing.

Tanpa Compose, set `RUN_INTEGRATION=1`, `TEST_DATABASE_URL` dan `TEST_NATS_URL` pada terminal lalu jalankan `pnpm test:integration`. Database harus khusus disposable bernama `workerlab_test` atau `workerlab_test_<suffix>`; setiap run memakai namespace Queue unik. Suite tidak menghapus schema, message atau fixture. Pengujian dapat meninggalkan data untuk inspeksi; cleanup manual hanya pada resource test yang telah dipastikan miliknya.

Suite menyiapkan migration idempotent + stream, menjalankan Web dan Worker sebagai child process terpisah, memeriksa job/duplicate effect, retry attempt 3, dead letter sungguhan, backlog saat Worker stop, dua replica, dan SIGKILL pada **child test-only** di tengah Delay. Ini bukan fault-injection endpoint aplikasi. Timeout suite 240 detik; suite diulang memerlukan resource test baru atau namespace baru. Default tanpa opt-in adalah SKIP, bukan PASS.

## Checklist operator lokal / NEO App

Gunakan hanya data dummy, namespace dan DB khusus lab. Batas 20 job per skenario, concurrency 1 awal, maksimal 2 replica saat uji. Jangan menjalankan stress test atau menonaktifkan resource orang lain.

1. **Sukses:** Echo berisi teks yang dipilih; SHA-256 cocok hasil independen; completed dengan worker_id dan satu effect.
2. **Idempotency:** key/payload sama → ID sama; key sama/payload berbeda → 409. Duplicated broker delivery tidak menambah effect.
3. **Retry:** fail-first=2 → attempt 1/2 failed, attempt 3 completed; jeda minimal 5/15 detik. Durasi total dapat lebih panjang karena polling/platform.
4. **Dead letter:** always-fail → failed setelah 3 attempt, effectCount=0, detail.deadLetter.delivered_at terisi; konfirmasi message pada stream `<namespace>_DLQ`. Status failed saja belum membuktikan DLQ terkirim.
5. **Retry manual:** job failed lama tetap failed; retry menghasilkan ID baru dengan retry_of menunjuk ID lama.
6. **Backlog:** operator `docker compose stop worker`, submit maksimal 5 job, periksa queued; `docker compose up -d worker` lalu tunggu completed. Di NEO gunakan kontrol replica/stop yang tersedia hanya pada Worker lab.
7. **Graceful restart:** kirim Delay 10 detik, restart Worker lab melalui Compose/dashboard; hasil harus satu kali. SIGTERM dapat menyelesaikan job tanpa redelivery, dan itu valid.
8. **Interupsi mendadak:** lokal saja, kirim Delay 10 detik lalu `docker compose kill -s SIGKILL worker` ketika status processing; start kembali. Tunggu sampai 120 detik untuk AckWait 45s/lease 30s dan startup; interrupted attempt tercatat, effect akhir tetap satu. Jangan melakukan SIGKILL ke service existing di platform.
9. **Dua replica:** `docker compose up -d --scale worker=2 worker` atau scale Worker lab dari dashboard setelah approval biaya. Kirim hingga 20 Delay 1 detik; kedua worker_id harus terlihat pada job selesai dan tidak ada effect ganda. Scheduling bisa tidak merata, bukan janji pembagian 50:50. Kembalikan ke 1 replica setelah uji.
10. **Gangguan Queue/DB:** lokal saja, stop satu dependency lab dari Compose, amati API/readiness/degraded/unknown; kirim job saat DB masih tersedia untuk menguji outbox Queue. Pulihkan dependency dan pastikan job/outbox akhirnya diproses. Tidak ada ACK saat commit gagal. Jangan menafsirkan monitoring gagal sebagai angka nol.
11. **Persistensi:** restart Web, Worker dan dependency tanpa menghapus volume; job, migration dan hasil tetap ada. Run migration/bootstrap kedua kali tidak menghapus data.
12. **Browser:** Overview/Jobs/Test Scenarios, login salah/benar, refresh, error dependency, empty state, detail, retry, logout, keyboard tab/arrow/Escape, 375/768/1024/1280 px. Pastikan token tidak tersimpan setelah reload dan response lama tidak menampilkan data setelah logout. Teks HTML pada Echo ditampilkan sebagai teks inert.

Tandai PASS hanya dengan job ID, observed timestamp, attempts/effectCount dan log aman. Skenario platform yang belum dijalankan tetap NOT RUN; UI tidak memberikan PASS otomatis atas tindakan operator.
