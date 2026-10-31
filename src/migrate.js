import { config } from './config.js';
import { createPool, migrate } from './db.js';
import { log } from './log.js';
let pool;
try { pool = createPool(config('migrate')); await migrate(pool); }
catch { log('migration_failed', { code: 'MIGRATION_ERROR' }); process.exitCode = 1; }
finally { await pool?.end(); }
