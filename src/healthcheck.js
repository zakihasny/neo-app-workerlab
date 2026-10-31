import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
try {
  if (process.env.APP_ROLE === 'worker') {
    const value = JSON.parse(await readFile(process.env.WORKER_HEALTH_FILE || path.join(tmpdir(), 'workerlab-health.json'), 'utf8'));
    if (!Number.isFinite(value.at) || Date.now()-value.at > 30_000) throw new Error('Stale');
  } else {
    const response = await fetch(`http://127.0.0.1:${process.env.PORT || 8080}/health/ready`, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error('Unready');
  }
} catch { process.exitCode = 1; }
