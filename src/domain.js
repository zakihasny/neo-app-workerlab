import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

export const JOB_TYPES = ['echo', 'sha256', 'delay', 'fail-first', 'always-fail'];
export const JOB_STATUSES = ['queued', 'processing', 'retrying', 'completed', 'failed'];
export const MAX_ATTEMPTS = 3;
export const HEARTBEAT_MS = 5_000;
export const STALE_MS = 30_000;
export const LEASE_SECONDS = 30;
export const isUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export class AppError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

export function validateJob(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !JOB_TYPES.includes(body.type)) throw new AppError('INVALID_JOB_TYPE');
  if (Object.keys(body).some(key => !['type', 'payload'].includes(key))) throw new AppError('UNKNOWN_FIELD');
  const input = body.payload ?? {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('INVALID_PAYLOAD');
  const payload = {};
  const allowed = body.type === 'delay' ? ['seconds'] : body.type === 'fail-first' ? ['failures'] : body.type === 'always-fail' ? [] : ['text'];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new AppError('UNKNOWN_PAYLOAD_FIELD');
  if (body.type === 'echo' || body.type === 'sha256') {
    if (typeof input.text !== 'string' || Buffer.byteLength(input.text) > 4096) throw new AppError('TEXT_REQUIRED_MAX_4096_BYTES');
    payload.text = input.text;
  } else if (body.type === 'delay') {
    if (!Number.isInteger(input.seconds) || input.seconds < 1 || input.seconds > 10) throw new AppError('DELAY_MUST_BE_1_TO_10');
    payload.seconds = input.seconds;
  } else if (body.type === 'fail-first') {
    if (![1, 2].includes(input.failures)) throw new AppError('FAILURES_MUST_BE_1_OR_2');
    payload.failures = input.failures;
  }
  return { type: body.type, payload };
}

export function validateKey(key) {
  if (typeof key !== 'string' || !/^[a-zA-Z0-9:_-]{8,128}$/.test(key)) throw new AppError('IDEMPOTENCY_KEY_REQUIRED');
  return key;
}

export function requestHash(job, retryOf = null) {
  return createHash('sha256').update(JSON.stringify({ type: job.type, payload: job.payload, retryOf })).digest('hex');
}

export function retryDelay(attempt) { return attempt === 1 ? 5_000 : 15_000; }
export function instanceId() { return `${process.env.HOSTNAME || 'worker'}:${randomUUID()}`; }

export async function executeJob(job, attempt, wait = sleep) {
  switch (job.type) {
    case 'echo': return { text: job.payload.text };
    case 'sha256': return { algorithm: 'sha256', digest: createHash('sha256').update(job.payload.text).digest('hex') };
    case 'delay': await wait(job.payload.seconds * 1000); return { waitedSeconds: job.payload.seconds };
    case 'fail-first':
      if (attempt <= job.payload.failures) throw new AppError('SIMULATED_TRANSIENT_FAILURE');
      return { recoveredAtAttempt: attempt };
    case 'always-fail': throw new AppError('SIMULATED_PERMANENT_FAILURE');
    default: throw new AppError('UNSUPPORTED_JOB');
  }
}
