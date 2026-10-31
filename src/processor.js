import { AppError, executeJob, isUuid } from './domain.js';
import { log } from './log.js';

export async function processMessage(message, repository, broker, workerId, handler = executeJob) {
  let id;
  try {
    const input = JSON.parse(new TextDecoder().decode(message.data));
    if (!input || !isUuid(input.jobId) || Object.keys(input).length !== 1) throw new Error('Invalid envelope');
    id = input.jobId;
  } catch {
    try { await broker.quarantine(message, 'INVALID_ENVELOPE'); message.ack(); }
    catch { message.nak(5000); }
    return;
  }
  try {
    const claim = await repository.claim(id, workerId);
    if (claim.outcome === 'terminal') { message.ack(); return; }
    if (claim.outcome === 'missing') { await broker.quarantine(message, 'UNKNOWN_JOB'); message.ack(); return; }
    if (claim.outcome === 'busy') { message.nak(claim.delay); return; }
    log('job_started', { jobId: id, workerId, attempt: claim.attempt });
    let result, code;
    try { result = await handler(claim.job, claim.attempt); }
    catch (error) { code = error instanceof AppError ? error.code : 'HANDLER_ERROR'; }
    const finished = await repository.finish(id, claim.token, result ?? null, code || null);
    if (finished.outcome === 'completed' || finished.outcome === 'failed') message.ack();
    else message.nak(finished.delay || 5000);
    log('job_outcome', { jobId: id, workerId, attempt: claim.attempt, code: finished.outcome.toUpperCase() });
  } catch { message.nak(5000); log('job_dependency_retry', { jobId: id, code: 'DEPENDENCY_UNAVAILABLE' }); }
}
