import test from 'node:test';
import assert from 'node:assert/strict';
import { Repository } from '../src/repository.js';
import { transaction } from '../src/db.js';
import { requestHash } from '../src/domain.js';

function fixture(handler) {
  const queries=[];
  const client={async query(text,values){queries.push({text,values});return await handler(text,values)||{rows:[],rowCount:0};},release(){queries.push({text:'RELEASE'});}};
  return {repository:new Repository({connect:async()=>client}),queries,pool:{connect:async()=>client}};
}
const job={type:'echo',payload:{text:'hi'}};
test('submit writes job, outbox and event in one transaction',async()=>{const f=fixture(text=>text.includes('RETURNING *')?{rows:[{id:'created'}],rowCount:1}:null);const r=await f.repository.submit(job,'unit-key-123');assert.equal(r.duplicate,false);assert.match(f.queries[2].text,/outbox/);assert.equal(f.queries.at(-2).text,'COMMIT');});
test('duplicate idempotency key creates no additional outbox',async()=>{const f=fixture(text=>text.includes('WHERE idempotency_key')?{rows:[{id:'original',request_hash:requestHash(job)}]}:null);const r=await f.repository.submit(job,'unit-key-123');assert.equal(r.duplicate,true);assert.ok(!f.queries.some(q=>q.text.includes('INSERT INTO workerlab.outbox')));});
test('idempotency payload conflict rolls back',async()=>{const f=fixture(text=>text.includes('WHERE idempotency_key')?{rows:[{request_hash:'different'}]}:null);await assert.rejects(f.repository.submit(job,'unit-key-123'),error=>error.code==='IDEMPOTENCY_KEY_CONFLICT');assert.equal(f.queries.at(-2).text,'ROLLBACK');});
test('transaction always releases client on error',async()=>{const f=fixture(()=>null);await assert.rejects(transaction(f.pool,()=>{throw Error('failure');}));assert.equal(f.queries.at(-1).text,'RELEASE');});
test('existing terminal job is not claimed again',async()=>{const f=fixture(text=>text.startsWith('SELECT *')?{rows:[{status:'completed'}]}:null);assert.equal((await f.repository.claim('id','worker')).outcome,'terminal');});
test('active lease causes delivery backoff',async()=>{const f=fixture(text=>text.startsWith('SELECT *')?{rows:[{status:'processing',db_now:new Date(1000),lease_until:new Date(999999),attempt_count:1}]}:null);assert.equal((await f.repository.claim('id','worker')).outcome,'busy');});
test('stale lease cannot insert an effect',async()=>{const f=fixture(text=>text.startsWith('SELECT *')?{rows:[{status:'processing',lease_token:'new-lease'}]}:null);assert.equal((await f.repository.finish('id','old-lease',{})).outcome,'stale');assert.ok(!f.queries.some(q=>q.text.includes('INSERT INTO workerlab.effects')));});
test('third failure atomically creates failed state and dead-letter outbox',async()=>{const f=fixture(text=>text.startsWith('SELECT *')?{rows:[{id:'id',type:'always-fail',status:'processing',lease_token:'lease',attempt_count:3}]}:null);assert.equal((await f.repository.finish('id','lease',null,'SIMULATED_PERMANENT_FAILURE')).outcome,'failed');assert.ok(f.queries.some(q=>q.text.includes("'dead'")));assert.equal(f.queries.at(-2).text,'COMMIT');});
