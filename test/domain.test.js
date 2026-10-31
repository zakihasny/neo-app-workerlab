import test from 'node:test';
import assert from 'node:assert/strict';
import { validateJob, validateKey, requestHash, executeJob, retryDelay, isUuid } from '../src/domain.js';
import { config, flag, integer } from '../src/config.js';
import { natsOptions, Broker } from '../src/queue.js';

for (const job of [{type:'echo',payload:{text:'hello'}},{type:'sha256',payload:{text:'abc'}},{type:'delay',payload:{seconds:5}},{type:'fail-first',payload:{failures:2}},{type:'always-fail'}]) {
  test(`accepts ${job.type}`, () => assert.equal(validateJob(job).type, job.type));
}
for (const job of [null,[],{}, {type:'shell'}, {type:'delay',payload:{seconds:0}}, {type:'delay',payload:{seconds:11}}, {type:'fail-first',payload:{failures:3}}, {type:'echo',payload:{text:'x'.repeat(4097)}}, {type:'echo',payload:{text:'x',extra:1}}, {type:'always-fail',extra:1}]) {
  test(`rejects invalid job ${JSON.stringify(job).slice(0,90)}`, () => assert.throws(() => validateJob(job)));
}
test('canonical job hash ignores incoming key ordering', () => assert.equal(requestHash(validateJob({type:'delay',payload:{seconds:1}})),requestHash(validateJob({payload:{seconds:1},type:'delay'}))));
test('retry parent is part of idempotency hash', () => assert.notEqual(requestHash({type:'echo',payload:{text:'a'}}),requestHash({type:'echo',payload:{text:'a'}},'parent')));
test('idempotency keys are bounded', () => { assert.equal(validateKey('example-key-123'),'example-key-123'); for (const value of [undefined,'short','a'.repeat(129),'invalid spaces']) assert.throws(() => validateKey(value)); });
test('UUID only accepts UUID v4', () => { assert.ok(isUuid('a7c7dfd3-c906-417e-b40e-b64464ac2d19')); assert.ok(!isUuid('../secret')); });
test('echo handler', async () => assert.deepEqual(await executeJob({type:'echo',payload:{text:'hi'}},1),{text:'hi'}));
test('checksum handler', async () => assert.equal((await executeJob({type:'sha256',payload:{text:'abc'}},1)).digest,'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'));
test('delay is bounded by validated seconds', async () => { let waited; await executeJob({type:'delay',payload:{seconds:2}},1,async ms => {waited=ms;}); assert.equal(waited,2000); });
test('fail first recovers only after configured attempts', async () => { const job={type:'fail-first',payload:{failures:2}}; await assert.rejects(executeJob(job,1)); await assert.rejects(executeJob(job,2)); assert.deepEqual(await executeJob(job,3),{recoveredAtAttempt:3}); });
test('permanent failure and backoff', async () => { await assert.rejects(executeJob({type:'always-fail',payload:{}},3)); assert.equal(retryDelay(1),5000); assert.equal(retryDelay(2),15000); });

const env = {DATABASE_URL:'postgresql://ci_user:ci_pass@localhost/workerlab_test',NATS_URL:'nats://ci_user:ci_pass@localhost:4222',API_TOKEN:'ci-only-api-token-for-unit-tests-123456789'};
test('role-specific config and safe defaults', () => { assert.equal(config('worker',env).concurrency,1); assert.equal(config('web',env).port,8080); assert.equal(config('migrate',{DATABASE_URL:env.DATABASE_URL}).natsUrl,undefined); assert.equal(config('queue',{NATS_URL:env.NATS_URL}).databaseUrl,undefined); });
test('config fails closed', () => { for (const values of [{}, {...env,API_TOKEN:'short'}, {...env,API_TOKEN:'replace-this-placeholder-value-000000000000'}, {...env,QUEUE_NAMESPACE:'bad.subject'}, {...env,WORKER_CONCURRENCY:'0'}, {...env,RUN_MIGRATIONS_ON_START:'yes'}]) assert.throws(() => config('web',values)); assert.throws(() => config('invalid',env)); });
test('strict scalar options', () => { assert.equal(flag('true','test'),true); assert.equal(flag(undefined,'test'),false); assert.equal(integer('2',1,1,4,'x'),2); assert.throws(() => integer('1.5',1,1,4,'x')); });
test('NATS auth parses encoded credentials without a URL in server options', () => { const value=natsOptions('nats://user:pa%3Ass@localhost:4222'); assert.equal(value.pass,'pa:ss'); assert.deepEqual(value.servers,['nats://localhost:4222']); });
test('NATS TLS keeps verification enabled, token and IPv6 supported', () => { assert.deepEqual(natsOptions('tls://token@[::1]:4222').tls,{}); assert.equal(natsOptions('nats://testtoken@localhost:4222').token,'testtoken'); for (const value of ['https://localhost','nats://localhost/path','nats://localhost?x=y']) assert.throws(() => natsOptions(value)); });
test('broker connection status is not reported healthy while disconnected', () => { const broker=new Broker({namespace:'test'}); assert.equal(broker.healthy(),false); broker.connection={isClosed:()=>false,isDraining:()=>false}; assert.equal(broker.healthy(),true); broker.disconnected=true; assert.equal(broker.healthy(),false); });

test('queue bootstrap creates streams and one durable, never updates resources', async () => {
  const broker=new Broker({namespace:'ci_test'}), streams=new Map(); let consumer;
  broker.manager={streams:{async info(name){if(!streams.has(name)) throw {code:10059};return streams.get(name);},async add(config){const info={config};streams.set(config.name,info);return info;}},consumers:{async info(){if(!consumer) throw {code:10014};return {config:consumer};},async add(stream,config){consumer=config;}}};
  await broker.setup(); await broker.setup(); assert.equal(streams.size,2); assert.equal(consumer.durable_name,'ci_test_workers'); assert.equal(streams.get('ci_test_JOBS').config.max_age,0);
});
test('queue bootstrap rejects incompatible streams instead of mutating them', async () => { const broker=new Broker({namespace:'ci_test'}); broker.manager={streams:{async info(){return {config:{retention:'limits'}};}}}; await assert.rejects(broker.setup(),/Incompatible/); });
