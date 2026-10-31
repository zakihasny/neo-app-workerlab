// Explicit, loopback-only UI fixture. No PostgreSQL, NATS or production secrets.
import { createHttpServer } from '../src/http.js';
import { AppError } from '../src/domain.js';
const repository = {
  async summary() { return { preview: true, counts: { queued:0,processing:0,retrying:0,completed:0,failed:0 },pendingOutbox:0,averageDurationMs:null }; },
  async workers() { return []; },
  async list() { return []; },
  async detail() { throw new AppError('PREVIEW_READ_ONLY',409); },
  async submit() { throw new AppError('PREVIEW_READ_ONLY',409); }
};
const server = createHttpServer({ repository, apiToken:'ci-only-ui-preview-token-not-for-production', health:async()=>({database:'preview',queue:'preview'}) });
server.listen(0,'127.0.0.1',()=>console.log(`UI fixture only: http://127.0.0.1:${server.address().port}/\nToken: ci-only-ui-preview-token-not-for-production\nNot an actual DB/Queue/Worker verification.`));
process.on('SIGINT',()=>server.close());
process.on('SIGTERM',()=>server.close());
