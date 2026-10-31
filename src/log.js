export function log(event, fields = {}) {
  const safe = {};
  for (const key of ['jobId', 'workerId', 'attempt', 'code', 'count', 'role', 'migration']) {
    if (fields[key] !== undefined) safe[key] = fields[key];
  }
  console.log(JSON.stringify({ time: new Date().toISOString(), event, ...safe }));
}

export function errorCode(error) {
  return /^[A-Z][A-Z0-9_]{2,60}$/.test(error?.code || '') ? error.code : 'DEPENDENCY_UNAVAILABLE';
}

export function installShutdown(close) {
  let stopping = false;
  const handler = async () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 20_000);
    deadline.unref();
    try { await close(); clearTimeout(deadline); } catch { log('shutdown_incomplete', { code: 'SHUTDOWN_ERROR' }); process.exitCode = 1; }
  };
  process.once('SIGTERM', handler);
  process.once('SIGINT', handler);
  return () => { process.off('SIGTERM', handler); process.off('SIGINT', handler); };
}
