import { setTimeout as sleep } from 'node:timers/promises';
import { log } from './log.js';

export function startPublisher(repository, broker) {
  const controller = new AbortController();
  const done = (async () => {
    while (!controller.signal.aborted) {
      try {
        for (const row of await repository.claimOutbox()) {
          try { await broker.publish(row); await repository.delivered(row); }
          catch { await repository.releaseOutbox(row); log('outbox_retry', { code: 'PUBLISH_UNAVAILABLE' }); }
        }
      } catch { log('outbox_waiting', { code: 'DEPENDENCY_UNAVAILABLE' }); }
      await sleep(500, undefined, { signal: controller.signal }).catch(() => {});
    }
  })();
  return { async stop() { controller.abort(); await done; } };
}
