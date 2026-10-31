import { assertDatabase, migrate } from './db.js';
export async function prepare(options, pool, broker) {
  if (options.runMigrations) await migrate(pool);
  await assertDatabase(pool);
  await broker.open();
  if (options.queueAutoSetup) await broker.setup();
  await broker.ready();
}
