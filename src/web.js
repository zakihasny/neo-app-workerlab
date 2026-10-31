import { config } from './config.js';
import { createPool } from './db.js';
import { Broker } from './queue.js';
import { Repository } from './repository.js';
import { startPublisher } from './publisher.js';
import { createHttpServer } from './http.js';
import { prepare } from './startup.js';
import { log, installShutdown } from './log.js';

let pool, broker, publisher, server;
async function close() {
  if (server?.listening) await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });
  await publisher?.stop();
  await broker?.close();
  await pool?.end();
  log('web_stopped');
}
try {
  const options = config('web');
  pool = createPool(options); broker = new Broker(options);
  await prepare(options, pool, broker);
  const repository = new Repository(pool);
  publisher = startPublisher(repository, broker);
  server = createHttpServer({ repository, apiToken: options.apiToken, health: async () => {
    const statuses = await Promise.allSettled([pool.query('SELECT 1'), broker.health()]);
    return { database: statuses[0].status === 'fulfilled' ? 'connected' : 'unavailable', queue: statuses[1].status === 'fulfilled' ? 'connected' : 'unavailable' };
  } });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(options.port, options.host, resolve); });
  installShutdown(close);
  log('web_ready', { role: 'web' });
} catch { log('startup_failed', { role: 'web', code: 'CONFIG_OR_DEPENDENCY_ERROR' }); await close().catch(() => {}); process.exitCode = 1; }
