export function flag(value, name) {
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return true;
  throw new Error(`Invalid boolean: ${name}`);
}

export function integer(value, fallback, min, max, name) {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) throw new Error(`Invalid integer: ${name}`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`Invalid integer: ${name}`);
  return number;
}

function required(env, key) {
  const value = env[key]?.trim();
  if (!value || /replace|placeholder|<|>/i.test(value)) throw new Error(`Missing or placeholder configuration: ${key}`);
  return value;
}

export function config(role = 'web', env = process.env) {
  if (!['web', 'worker', 'migrate', 'queue'].includes(role)) throw new Error('Invalid APP_ROLE');
  const namespace = env.QUEUE_NAMESPACE || 'workerlab_local';
  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,47}$/.test(namespace)) throw new Error('Invalid QUEUE_NAMESPACE');
  const options = {
    role, namespace,
    databaseUrl: role === 'queue' ? undefined : required(env, 'DATABASE_URL'),
    natsUrl: role === 'migrate' ? undefined : required(env, 'NATS_URL'),
    host: env.HOST || '0.0.0.0',
    port: integer(env.PORT, 8080, 1, 65535, 'PORT'),
    concurrency: integer(env.WORKER_CONCURRENCY, 1, 1, 4, 'WORKER_CONCURRENCY'),
    runMigrations: flag(env.RUN_MIGRATIONS_ON_START, 'RUN_MIGRATIONS_ON_START'),
    queueAutoSetup: flag(env.QUEUE_AUTO_SETUP, 'QUEUE_AUTO_SETUP')
  };
  if (role === 'web') {
    options.apiToken = required(env, 'API_TOKEN');
    if (options.apiToken.length < 32 || options.apiToken.length > 512) throw new Error('API_TOKEN must contain 32–512 characters');
  }
  return options;
}
