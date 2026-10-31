import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { startPublisher } from '../src/publisher.js';
import { assertDatabase } from '../src/db.js';

async function until(work) { const deadline=Date.now()+2000;while(Date.now()<deadline){if(work())return;await sleep(5);}throw Error('Publisher test timeout'); }
test('outbox is delivered only after broker publish acknowledgement',async()=>{
  const events=[];let claimed=false;
  const repository={async claimOutbox(){if(claimed)return [];claimed=true;return [{id:'outbox'}];},async delivered(){events.push('delivered');},async releaseOutbox(){events.push('released');}};
  const publisher=startPublisher(repository,{async publish(){await sleep(5);events.push('puback');}});
  try {await until(()=>events.includes('delivered'));assert.deepEqual(events,['puback','delivered']);}finally{await publisher.stop();}
});
test('publish failure leaves outbox pending for retry',async()=>{
  const events=[];let claimed=false;
  const repository={async claimOutbox(){if(claimed)return [];claimed=true;return [{}];},async delivered(){events.push('delivered');},async releaseOutbox(){events.push('released');}};
  const publisher=startPublisher(repository,{async publish(){throw Error('Unavailable');}});
  try {await until(()=>events.includes('released'));assert.deepEqual(events,['released']);}finally{await publisher.stop();}
});
test('database readiness enforces PostgreSQL 16',async()=>{
  await assert.rejects(assertDatabase({query:async()=>({rows:[{major:15}],rowCount:1})}),/PostgreSQL 16/);
});
test('database readiness requires migration marker',async()=>{
  let queries=0;
  await assert.rejects(assertDatabase({query:async()=>++queries===1?{rows:[{major:16}],rowCount:1}:{rows:[],rowCount:0}}),/Migration 001/);
});
