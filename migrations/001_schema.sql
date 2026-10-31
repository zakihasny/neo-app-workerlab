BEGIN;
CREATE SCHEMA IF NOT EXISTS workerlab;
CREATE TABLE IF NOT EXISTS workerlab.schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS workerlab.jobs (
  id uuid PRIMARY KEY,
  idempotency_key varchar(128) NOT NULL UNIQUE,
  request_hash char(64) NOT NULL,
  type varchar(20) NOT NULL CHECK (type IN ('echo','sha256','delay','fail-first','always-fail')),
  payload jsonb NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','retrying','completed','failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  worker_id text,
  lease_token uuid,
  lease_until timestamptz,
  next_attempt_at timestamptz,
  result jsonb,
  error_code varchar(64),
  retry_of uuid REFERENCES workerlab.jobs(id),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);
CREATE TABLE IF NOT EXISTS workerlab.attempts (
  job_id uuid NOT NULL REFERENCES workerlab.jobs(id),
  number integer NOT NULL,
  worker_id text NOT NULL,
  status varchar(20) NOT NULL CHECK (status IN ('running','completed','failed','interrupted')),
  error_code varchar(64),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  PRIMARY KEY(job_id,number)
);
CREATE TABLE IF NOT EXISTS workerlab.effects (
  job_id uuid PRIMARY KEY REFERENCES workerlab.jobs(id),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workerlab.events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES workerlab.jobs(id),
  kind varchar(40) NOT NULL,
  code varchar(64),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workerlab.outbox (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES workerlab.jobs(id),
  kind varchar(10) NOT NULL CHECK (kind IN ('job','dead')),
  message_id text NOT NULL UNIQUE,
  body jsonb NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  lock_token uuid,
  locked_until timestamptz,
  delivered_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error varchar(64)
);
CREATE TABLE IF NOT EXISTS workerlab.workers (
  id text PRIMARY KEY,
  concurrency integer NOT NULL,
  status varchar(10) NOT NULL CHECK (status IN ('online','stopped')),
  started_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_created_idx ON workerlab.jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON workerlab.outbox(available_at) WHERE delivered_at IS NULL;
CREATE INDEX IF NOT EXISTS events_job_idx ON workerlab.events(job_id,id);
INSERT INTO workerlab.schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING;
COMMIT;
