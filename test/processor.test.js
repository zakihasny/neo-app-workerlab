import test from 'node:test';
import assert from 'node:assert/strict';
import { processMessage } from '../src/processor.js';
import { AppError } from '../src/domain.js';

const id='a7c7dfd3-c906-417e-b40e-b64464ac2d19';
function fixture(outcome='claimed') {
  const events=[];
  const message={data:new TextEncoder().encode(JSON.stringify({jobId:id})),ack(){events.push('ack');},nak(delay){events.push(['nak',delay]);}};
  const repository={async claim(){events.push('claim');return {outcome,job:{type:'echo',payload:{text:'hello'}},token:'lease',attempt:1,delay:5000};},async finish(jobId,token,result,code){events.push(['finish',code]);return {outcome:code?'retrying':'completed',delay:5000};}};
  const broker={async quarantine(){events.push('quarantine');}};
  return {events,message,repository,broker};
}
test('ACK follows persisted result',async()=>{const f=fixture();await processMessage(f.message,f.repository,f.broker,'worker');assert.deepEqual(f.events,['claim',['finish',null],'ack']);});
test('completed duplicate is ACKed without running handler again',async()=>{const f=fixture('terminal');await processMessage(f.message,f.repository,f.broker,'worker',()=>{throw Error('must not run');});assert.deepEqual(f.events,['claim','ack']);});
test('another lease cannot be completed by duplicate delivery',async()=>{const f=fixture('busy');await processMessage(f.message,f.repository,f.broker,'worker');assert.deepEqual(f.events,['claim',['nak',5000]]);});
test('business error persists retry before NAK',async()=>{const f=fixture();await processMessage(f.message,f.repository,f.broker,'worker',async()=>{throw new AppError('SIMULATED_TRANSIENT_FAILURE');});assert.deepEqual(f.events,['claim',['finish','SIMULATED_TRANSIENT_FAILURE'],['nak',5000]]);});
test('terminal failure is ACKed only after failed state and dead-letter outbox commit',async()=>{const f=fixture();f.repository.finish=async()=>{f.events.push('terminal-commit');return {outcome:'failed'};};await processMessage(f.message,f.repository,f.broker,'worker');assert.deepEqual(f.events,['claim','terminal-commit','ack']);});
test('DB failure never ACKs',async()=>{const f=fixture();f.repository.finish=async()=>{throw Error('connection string must never be logged');};await processMessage(f.message,f.repository,f.broker,'worker');assert.deepEqual(f.events,['claim',['nak',5000]]);});
test('expired lease completion does not ACK current work',async()=>{const f=fixture();f.repository.finish=async()=>({outcome:'stale'});await processMessage(f.message,f.repository,f.broker,'worker');assert.deepEqual(f.events,['claim',['nak',5000]]);});
test('unknown message is quarantined before ACK',async()=>{const f=fixture('missing');await processMessage(f.message,f.repository,f.broker,'worker');assert.deepEqual(f.events,['claim','quarantine','ack']);});
test('invalid envelope cannot execute jobs',async()=>{const f=fixture();f.message.data=new TextEncoder().encode('{broken');await processMessage(f.message,f.repository,f.broker,'worker');assert.deepEqual(f.events,['quarantine','ack']);});
test('quarantine publish failure NAKs the invalid message',async()=>{const f=fixture();f.message.data=new TextEncoder().encode('{}');f.broker.quarantine=async()=>{throw Error();};await processMessage(f.message,f.repository,f.broker,'worker');assert.deepEqual(f.events,[['nak',5000]]);});
