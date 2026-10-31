# Kontrak Worker Validation Lab

Source independen. Jangan membaca credential atau mengubah aplikasi sibling. Tidak ada izin deployment atau push GitHub dalam pengiriman ZIP ini.

- Node.js 22 / pnpm 11.19.0. Satu lockfile. Start dispatcher hanya menerima role web/worker.
- PostgreSQL major 16 wajib; migration idempotent menggunakan advisory lock. Schema `workerlab` milik aplikasi ini. Jangan gunakan DB produksi existing untuk pengujian.
- Web menerima job + outbox dalam satu transaksi, menerbitkan setelah PubAck; Worker tidak berjalan di Web. Outbox claim memakai lease + SKIP LOCKED untuk lebih dari satu Web replica.
- Worker berbagi satu durable pull consumer per namespace. ACK explicit, AckWait 45 detik, lease job 30 detik, concurrency 1 default (1–4), job handler maksimal delay 10 detik.
- Lease token memagari completion lama. Expired lease menandai attempt interrupted; attempt ketiga yang interrupted menjadi failed + dead-letter outbox pada redelivery. Efek/result tidak boleh digandakan.
- Job idempotency hash mencakup type, payload canonical dan retry parent. Key sama dengan payload berbeda harus 409. Retry manual membuat job baru, bukan mengubah job failed lama.
- Retry handler 5/15 detik, maksimal 3 attempt. Gangguan transport/DB sebelum claim tidak menambah business attempt. Setelah claim yang terputus, satu attempt menjadi interrupted.
- Command stream file-backed WorkQueue, 50 MiB, no TTL, discard-new. DLQ terpisah 50 MiB/7 hari, discard-old; aplikasi yang menerbitkan dead letter, bukan janji fitur broker otomatis. Bootstrap tidak mengubah stream/consumer existing yang tidak kompatibel.
- Heartbeat DB setiap 5 detik, stale 30 detik. Local temp health file hanya untuk Docker HEALTHCHECK; bukan penyimpanan durable atau jaminan platform menjalankan probe tersebut.
- Token hanya di server env dan memori tab operator; jangan cetak credential, URL berpassword atau payload di log. SQL terparameterisasi, JSON body 8 KiB, teks 4 KiB, list capped, API request rate capped.
- Unit test tidak membuktikan SQL/JetStream live. Integration memerlukan opt-in dan database bernama workerlab_test atau workerlab_test_*. Catat SKIP/unverified secara jujur.
- Package allowlist wajib. Jangan memasukkan file env aktual, node_modules, credential, log, hasil ZIP, atau link filesystem. Simpan backup arsip existing sebelum penggantian.
