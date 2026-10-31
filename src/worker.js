import { writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { config } from './config.js';
import { createPool } from './db.js';
import { Broker } from './queue.js';
import { Repository } from './repository.js';
import { processMessage } from './processor.js';
import { HEARTBEAT_MS, instanceId } from './domain.js';
import { prepare } from './startup.js';
import { log, installShutdown } from './log.js';

let pool, broker, repository, heartbeat, heartbeatWork = Promise.resolve(), beating = false, stopping = false, workerConcurrency = 1;
const sources = [], tasks = [];
const id = instanceId();
const healthFile = process.env.WORKER_HEALTH_FILE || path.join(tmpdir(), 'workerlab-health.json');
async function close() {
  if (stopping) return;
  stopping = true;
  clearInterval(heartbeat);
  for (const source of sources) source.stop();
  await Promise.allSettled(tasks);
  await heartbeatWork;
  if (repository) await repository.heartbeat(id, workerConcurrency, true).catch(() => {});
  await broker?.close(); await pool?.end();
  log('worker_stopped', { workerId: id });
}
try {
  const options = config('worker');
  workerConcurrency = options.concurrency;
  pool = createPool(options); broker = new Broker(options); repository = new Repository(pool);
  await prepare(options, pool, broker);
  const beat = async () => {
    try {
      if (!broker.healthy()) throw new Error('Queue disconnected');
      await repository.heartbeat(id, options.concurrency);
      await writeFile(`${healthFile}.next`, JSON.stringify({ at: Date.now(), pid: process.pid }));
      await rename(`${healthFile}.next`, healthFile);
    } catch { log('heartbeat_unavailable', { workerId: id, code: 'DEPENDENCY_UNAVAILABLE' }); }
  };
  await beat();
  heartbeat = setInterval(() => {
    if (!beating && !stopping) {
      beating = true;
      heartbeatWork = beat().finally(() => { beating = false; });
    }
  }, HEARTBEAT_MS);
  const consumer = await broker.client.consumers.get(broker.names.commands, broker.names.consumer);
  for (let i = 0; i < options.concurrency; i++) {
    const source = await consumer.consume({ max_messages: 1 }); sources.push(source);
    tasks.push((async () => { for await (const message of source) { if (stopping) { message.nak(1000); break; } await processMessage(message, repository, broker, id); } })());
  }
  installShutdown(close);
  log('worker_ready', { workerId: id });
  await Promise.all(tasks);
  if (!stopping) throw new Error('Consumer ended unexpectedly');
} catch { log('startup_failed', { role: 'worker', code: 'CONFIG_OR_DEPENDENCY_ERROR' }); process.exitCode = 1; }
finally { await close().catch(() => {}); }
