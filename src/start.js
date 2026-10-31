const role = process.env.APP_ROLE || 'web';
if (!['web', 'worker'].includes(role)) throw new Error('APP_ROLE must be web or worker');
await import(`./${role}.js`);
