import { randomUUID } from 'node:crypto';
import { transaction } from './db.js';
import { AppError, requestHash, retryDelay, MAX_ATTEMPTS, LEASE_SECONDS } from './domain.js';

async function event(client, id, kind, code = null) {
  await client.query('INSERT INTO workerlab.events(job_id,kind,code) VALUES ($1,$2,$3)', [id, kind, code]);
}

async function deadLetter(client, job, code) {
  await client.query(`INSERT INTO workerlab.outbox(id,job_id,kind,message_id,body) VALUES ($1,$2,'dead',$3,$4)
    ON CONFLICT(message_id) DO NOTHING`, [randomUUID(), job.id, `dead:${job.id}`, { jobId: job.id, type: job.type, code, attempts: job.attempt_count }]);
}

export class Repository {
  constructor(pool) { this.pool = pool; }

  async submit(job, key, retryOf = null) {
    return transaction(this.pool, async client => {
      if (retryOf) {
        const prior = await client.query('SELECT status FROM workerlab.jobs WHERE id=$1', [retryOf]);
        if (!prior.rows.length) throw new AppError('JOB_NOT_FOUND', 404);
        if (prior.rows[0].status !== 'failed') throw new AppError('ONLY_FAILED_JOBS_CAN_BE_RETRIED', 409);
      }
      const hash = requestHash(job, retryOf), id = randomUUID();
      const inserted = await client.query(`INSERT INTO workerlab.jobs(id,idempotency_key,request_hash,type,payload,retry_of)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(idempotency_key) DO NOTHING RETURNING *`, [id, key, hash, job.type, job.payload, retryOf]);
      if (!inserted.rowCount) {
        const existing = (await client.query('SELECT * FROM workerlab.jobs WHERE idempotency_key=$1', [key])).rows[0];
        if (existing.request_hash !== hash) throw new AppError('IDEMPOTENCY_KEY_CONFLICT', 409);
        return { job: existing, duplicate: true };
      }
      await client.query(`INSERT INTO workerlab.outbox(id,job_id,kind,message_id,body) VALUES($1,$2,'job',$3,$4)`, [randomUUID(), id, `job:${id}`, { jobId: id }]);
      await event(client, id, 'accepted');
      return { job: inserted.rows[0], duplicate: false };
    });
  }

  async list(status) {
    return (await this.pool.query(`SELECT id,type,status,attempt_count,worker_id,error_code,retry_of,created_at,started_at,finished_at,published_at
      FROM workerlab.jobs WHERE ($1::text IS NULL OR status=$1) ORDER BY created_at DESC,id DESC LIMIT 100`, [status || null])).rows;
  }

  async detail(id) {
    const job = (await this.pool.query('SELECT * FROM workerlab.jobs WHERE id=$1', [id])).rows[0];
    if (!job) throw new AppError('JOB_NOT_FOUND', 404);
    const attempts = (await this.pool.query('SELECT * FROM workerlab.attempts WHERE job_id=$1 ORDER BY number', [id])).rows;
    const events = (await this.pool.query('SELECT id,kind,code,created_at FROM workerlab.events WHERE job_id=$1 ORDER BY id LIMIT 100', [id])).rows;
    const dead = (await this.pool.query("SELECT delivered_at,last_error FROM workerlab.outbox WHERE job_id=$1 AND kind='dead'", [id])).rows[0];
    const effects = Number((await this.pool.query('SELECT count(*) AS count FROM workerlab.effects WHERE job_id=$1', [id])).rows[0].count);
    return { ...job, attempts, events, effectCount: effects, deadLetter: dead || null };
  }

  async summary() {
    const counts = (await this.pool.query('SELECT status,count(*)::int AS count FROM workerlab.jobs GROUP BY status')).rows;
    const totals = Object.fromEntries(['queued','processing','retrying','completed','failed'].map(status => [status, 0]));
    for (const row of counts) totals[row.status] = row.count;
    const timing = (await this.pool.query(`SELECT round(avg(extract(epoch FROM (finished_at-started_at))*1000))::bigint AS average_ms
      FROM workerlab.jobs WHERE status='completed'`)).rows[0];
    const pending = Number((await this.pool.query('SELECT count(*) AS count FROM workerlab.outbox WHERE delivered_at IS NULL')).rows[0].count);
    return { counts: totals, pendingOutbox: pending, averageDurationMs: timing.average_ms === null ? null : Number(timing.average_ms), observedAt: new Date().toISOString() };
  }

  async workers() {
    return (await this.pool.query(`SELECT id,concurrency,status,started_at,heartbeat_at,
      (status='online' AND heartbeat_at > now()-interval '30 seconds') AS fresh
      FROM workerlab.workers ORDER BY heartbeat_at DESC LIMIT 50`)).rows;
  }

  async heartbeat(id, concurrency, stopped = false) {
    await this.pool.query(`INSERT INTO workerlab.workers(id,concurrency,status) VALUES($1,$2,$3)
      ON CONFLICT(id) DO UPDATE SET heartbeat_at=now(),status=excluded.status,concurrency=excluded.concurrency`, [id, concurrency, stopped ? 'stopped' : 'online']);
  }

  async claimOutbox() {
    return transaction(this.pool, async client => {
      const { rows } = await client.query(`SELECT * FROM workerlab.outbox WHERE delivered_at IS NULL AND available_at<=now()
        AND (locked_until IS NULL OR locked_until<now()) ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 10`);
      for (const row of rows) {
        row.lock_token = randomUUID();
        await client.query(`UPDATE workerlab.outbox SET lock_token=$2,locked_until=now()+interval '30 seconds',attempts=attempts+1 WHERE id=$1`, [row.id, row.lock_token]);
      }
      return rows;
    });
  }

  async delivered(row) {
    await transaction(this.pool, async client => {
      const result = await client.query(`UPDATE workerlab.outbox SET delivered_at=now(),locked_until=NULL,last_error=NULL
        WHERE id=$1 AND lock_token=$2 AND delivered_at IS NULL RETURNING job_id,kind`, [row.id, row.lock_token]);
      if (result.rowCount && row.kind === 'job') {
        await client.query('UPDATE workerlab.jobs SET published_at=coalesce(published_at,now()) WHERE id=$1', [row.job_id]);
        await event(client, row.job_id, 'published');
      }
    });
  }

  async releaseOutbox(row) {
    await this.pool.query(`UPDATE workerlab.outbox SET locked_until=NULL,available_at=now()+interval '5 seconds',last_error='PUBLISH_UNAVAILABLE'
      WHERE id=$1 AND lock_token=$2 AND delivered_at IS NULL`, [row.id, row.lock_token]);
  }

  async claim(id, workerId) {
    return transaction(this.pool, async client => {
      const job = (await client.query('SELECT *,now() AS db_now FROM workerlab.jobs WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!job) return { outcome: 'missing' };
      if (['completed', 'failed'].includes(job.status)) return { outcome: 'terminal' };
      const now = new Date(job.db_now).getTime();
      if (job.lease_until && new Date(job.lease_until).getTime() > now) return { outcome: 'busy', delay: 5000 };
      if (job.next_attempt_at && new Date(job.next_attempt_at).getTime() > now) return { outcome: 'busy', delay: Math.max(1000, new Date(job.next_attempt_at).getTime() - now) };
      await client.query("UPDATE workerlab.attempts SET status='interrupted',error_code='WORKER_INTERRUPTED',finished_at=now() WHERE job_id=$1 AND status='running'", [id]);
      if (job.attempt_count >= MAX_ATTEMPTS) {
        await client.query("UPDATE workerlab.jobs SET status='failed',error_code='ATTEMPTS_EXHAUSTED',finished_at=now(),lease_token=NULL,lease_until=NULL WHERE id=$1", [id]);
        await deadLetter(client, job, 'ATTEMPTS_EXHAUSTED');
        await event(client, id, 'failed', 'ATTEMPTS_EXHAUSTED');
        return { outcome: 'terminal' };
      }
      const token = randomUUID(), attempt = job.attempt_count + 1;
      await client.query(`UPDATE workerlab.jobs SET status='processing',attempt_count=$2,worker_id=$3,lease_token=$4,
        lease_until=now()+make_interval(secs=>$5),next_attempt_at=NULL,started_at=coalesce(started_at,now()),error_code=NULL WHERE id=$1`, [id, attempt, workerId, token, LEASE_SECONDS]);
      await client.query("INSERT INTO workerlab.attempts(job_id,number,worker_id,status) VALUES($1,$2,$3,'running')", [id, attempt, workerId]);
      await event(client, id, 'processing');
      return { outcome: 'claimed', job, token, attempt };
    });
  }

  async finish(id, token, result, code = null) {
    return transaction(this.pool, async client => {
      const job = (await client.query('SELECT * FROM workerlab.jobs WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!job || job.status !== 'processing' || job.lease_token !== token) return { outcome: 'stale' };
      if (!code) {
        await client.query('INSERT INTO workerlab.effects(job_id,result) VALUES($1,$2) ON CONFLICT(job_id) DO NOTHING', [id, result]);
        await client.query("UPDATE workerlab.jobs SET status='completed',result=$2,finished_at=now(),lease_token=NULL,lease_until=NULL,error_code=NULL WHERE id=$1", [id, result]);
        await client.query("UPDATE workerlab.attempts SET status='completed',finished_at=now() WHERE job_id=$1 AND number=$2", [id, job.attempt_count]);
        await event(client, id, 'completed');
        return { outcome: 'completed' };
      }
      const terminal = job.attempt_count >= MAX_ATTEMPTS;
      const delay = retryDelay(job.attempt_count);
      await client.query(`UPDATE workerlab.jobs SET status=$2,error_code=$3,lease_token=NULL,lease_until=NULL,
        next_attempt_at=CASE WHEN $4 THEN NULL ELSE now()+make_interval(secs=>$5) END,
        finished_at=CASE WHEN $4 THEN now() ELSE NULL END WHERE id=$1`, [id, terminal ? 'failed' : 'retrying', code, terminal, delay / 1000]);
      await client.query("UPDATE workerlab.attempts SET status='failed',error_code=$3,finished_at=now() WHERE job_id=$1 AND number=$2", [id, job.attempt_count, code]);
      await event(client, id, terminal ? 'failed' : 'retry_scheduled', code);
      if (terminal) await deadLetter(client, job, code);
      return { outcome: terminal ? 'failed' : 'retrying', delay };
    });
  }
}
