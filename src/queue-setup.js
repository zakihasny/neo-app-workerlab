import { config } from './config.js';
import { Broker } from './queue.js';
import { log } from './log.js';
let broker;
try { broker = new Broker(config('queue')); await broker.open(); await broker.setup(); log('queue_setup_complete'); }
catch { log('queue_setup_failed', { code: 'QUEUE_SETUP_ERROR' }); process.exitCode = 1; }
finally { await broker?.close(); }
