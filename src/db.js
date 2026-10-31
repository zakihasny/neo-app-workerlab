import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { log } from './log.js';

export function createPool(options) {
  const pool = new pg.Pool({ connectionString: options.databaseUrl, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, statement_timeout: 15000, query_timeout: 17000, application_name: `workerlab-${options.role}` });
  pool.on('error', () => log('database_pool_error', { code: 'DATABASE_CONNECTION_ERROR' }));
  return pool;
}

export async function transaction(pool, work) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const value = await work(client); await client.query('COMMIT'); return value; }
  catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}

export async function assertDatabase(pool, schema = true) {
  const { rows } = await pool.query("SELECT current_setting('server_version_num')::int / 10000 AS major");
  if (rows[0]?.major !== 16) throw new Error('PostgreSQL 16 is required');
  if (schema) {
    const applied = await pool.query('SELECT version FROM workerlab.schema_migrations WHERE version = 1');
    if (!applied.rowCount) throw new Error('Migration 001 has not been applied');
  }
}

export async function migrate(pool) {
  await assertDatabase(pool, false);
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('workerlab_migrations'))");
    const directory = fileURLToPath(new URL('../migrations/', import.meta.url));
    for (const name of (await readdir(directory)).filter(name => /^\d+_.+\.sql$/.test(name)).sort()) {
      await client.query(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
      log('migration_applied', { migration: name });
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('workerlab_migrations'))").catch(() => {});
    client.release();
  }
}
