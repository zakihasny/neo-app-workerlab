import { connect } from '@nats-io/transport-node';
import { jetstream, jetstreamManager } from '@nats-io/jetstream';
import { createHash } from 'node:crypto';

export function natsOptions(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid NATS_URL'); }
  if (!['nats:', 'tls:'].includes(url.protocol) || url.pathname.replaceAll('/', '') || url.search || url.hash) throw new Error('NATS_URL must be a nats:// or tls:// server URL');
  const server = `${url.protocol}//${url.host}`;
  const options = { servers: [server], timeout: 5000, maxReconnectAttempts: -1, reconnectTimeWait: 1000, name: 'worker-validation-lab' };
  if (url.username && url.password) { options.user = decodeURIComponent(url.username); options.pass = decodeURIComponent(url.password); }
  else if (url.username) options.token = decodeURIComponent(url.username);
  else if (url.password) throw new Error('Invalid NATS_URL credentials');
  if (url.protocol === 'tls:') options.tls = {};
  return options;
}

export class Broker {
  constructor(options) {
    this.options = options;
    this.names = { commands: `${options.namespace}_JOBS`, dead: `${options.namespace}_DLQ`, consumer: `${options.namespace}_workers`, subject: `${options.namespace}.jobs`, deadSubject: `${options.namespace}.dead` };
  }
  async open() {
    this.connection = await connect(natsOptions(this.options.natsUrl));
    this.disconnected = false;
    this.statusTask = (async () => {
      for await (const status of this.connection.status()) {
        if (status.type === 'disconnect') this.disconnected = true;
        if (status.type === 'reconnect') this.disconnected = false;
      }
    })().catch(() => { this.disconnected = true; });
    this.client = jetstream(this.connection, { timeout: 5000 });
    this.manager = await jetstreamManager(this.connection, { timeout: 5000 });
  }
  healthy() { return !!this.connection && !this.connection.isClosed() && !this.connection.isDraining() && !this.disconnected; }
  async health() { if (!this.healthy()) throw new Error('Queue unavailable'); await this.connection.flush(); }

  async setup() {
    for (const [name, subject, retention] of [[this.names.commands, this.names.subject, 'workqueue'], [this.names.dead, this.names.deadSubject, 'limits']]) {
      const desired = { name, subjects: [subject], retention, storage: 'file', max_bytes: 50 * 1024 * 1024, max_age: retention === 'limits' ? 7 * 86400 * 1e9 : 0, discard: retention === 'workqueue' ? 'new' : 'old', duplicate_window: 120 * 1e9 };
      let info;
      try { info = await this.manager.streams.info(name); }
      catch (error) {
        if (!['404', '10059'].includes(String(error.code)) && error.api_error?.err_code !== 10059) throw error;
        try { info = await this.manager.streams.add(desired); }
        catch (createError) { try { info = await this.manager.streams.info(name); } catch { throw createError; } }
      }
      if (info.config.retention !== desired.retention || info.config.storage !== 'file' || info.config.discard !== desired.discard ||
        info.config.max_age !== desired.max_age || info.config.max_bytes !== desired.max_bytes || JSON.stringify(info.config.subjects) !== JSON.stringify([subject])) {
        throw new Error('Incompatible existing stream; use a fresh QUEUE_NAMESPACE');
      }
    }
    try { await this.assertConsumer(); }
    catch (error) {
      if (!['404', '10014'].includes(String(error.code)) && error.api_error?.err_code !== 10014) throw error;
      try {
        await this.manager.consumers.add(this.names.commands, { durable_name: this.names.consumer, ack_policy: 'explicit', filter_subject: this.names.subject, deliver_policy: 'all', ack_wait: 45 * 1e9, max_deliver: -1, max_ack_pending: 20, replay_policy: 'instant' });
      } catch (createError) { try { await this.assertConsumer(); } catch { throw createError; } }
      await this.assertConsumer();
    }
  }
  async assertConsumer() {
    const info = await this.manager.consumers.info(this.names.commands, this.names.consumer);
    if (info.config.ack_policy !== 'explicit' || info.config.filter_subject !== this.names.subject || info.config.deliver_subject ||
      info.config.ack_wait !== 45 * 1e9 || info.config.max_deliver !== -1 || info.config.max_ack_pending !== 20 || info.config.deliver_policy !== 'all') throw new Error('Incompatible existing consumer');
    return info;
  }
  async ready() { await this.health(); await this.assertConsumer(); }
  async publish(row) {
    await this.client.publish(row.kind === 'dead' ? this.names.deadSubject : this.names.subject,
      new TextEncoder().encode(JSON.stringify(row.body)), { msgID: row.message_id, expect: { streamName: row.kind === 'dead' ? this.names.dead : this.names.commands } });
  }
  async quarantine(message, code) {
    const digest = createHash('sha256').update(message.data).digest('hex');
    await this.publish({ kind: 'dead', body: { code, streamSequence: message.info.streamSequence }, message_id: `invalid:${digest}` });
  }
  async close() { if (this.connection && !this.connection.isClosed()) await this.connection.drain(); }
}
