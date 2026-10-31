import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpServer, authorized, sameOrigin } from '../src/http.js';
import { AppError } from '../src/domain.js';

const token='ci-only-operator-token-not-for-production-123456';
const id='a7c7dfd3-c906-417e-b40e-b64464ac2d19';
test('auth constant length digest and origin policy',()=>{assert.ok(authorized(`Bearer ${token}`,token));assert.ok(!authorized('Bearer wrong',token));assert.ok(!authorized(undefined,token));assert.ok(sameOrigin({headers:{host:'localhost:8080',origin:'http://localhost:8080'}}));assert.ok(!sameOrigin({headers:{host:'localhost',origin:'https://evil.example'}}));});

test('HTTP contract, auth, validation, health and assets',async t=>{
  const submissions=[];
  const repository={summary:async()=>({counts:{}}),workers:async()=>[],list:async()=>[],detail:async()=>({id,status:'failed',type:'echo',payload:{text:'original'}}),submit:async(job,key,retryOf)=>{submissions.push({job,key,retryOf});return {job:{id},duplicate:false};}};
  let unhealthy=false;
  const server=createHttpServer({repository,apiToken:token,health:async()=>{if(unhealthy)throw Error('sensitive postgres://must-not-appear');return {database:'connected',queue:'connected'};}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json','Idempotency-Key':'ci-test-key-123'};
  const request=(path,options={})=>fetch(base+path,{...options,headers:{...headers,...options.headers}});
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  await t.test('public HTML and CSP',async()=>{const r=await fetch(base);assert.equal(r.status,200);assert.match(await r.text(),/Worker Validation Lab/);assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);});
  for(const asset of ['/app.js','/styles.css'])await t.test(`asset ${asset}`,async()=>assert.equal((await fetch(base+asset)).status,200));
  await t.test('liveness and readiness',async()=>{assert.equal((await fetch(base+'/healthz')).status,200);assert.equal((await fetch(base+'/health/ready')).status,200);});
  await t.test('API is private',async()=>assert.equal((await fetch(base+'/api/jobs')).status,401));
  await t.test('summary/workers/list',async()=>{for(const path of ['/api/summary','/api/workers','/api/jobs'])assert.equal((await request(path)).status,200);});
  await t.test('job accepted without executing it',async()=>{const r=await request('/api/jobs',{method:'POST',body:JSON.stringify({type:'echo',payload:{text:'hi'}})});assert.equal(r.status,202);assert.equal(submissions.length,1);});
  await t.test('no idempotency key',async()=>assert.equal((await request('/api/jobs',{method:'POST',headers:{'Idempotency-Key':''},body:'{}'})).status,400));
  await t.test('invalid job / invalid JSON / oversized body',async()=>{for(const body of ['{}','broken',JSON.stringify({text:'x'.repeat(9000)})])assert.ok([400,413].includes((await request('/api/jobs',{method:'POST',body})).status));});
  await t.test('content type and cross-origin',async()=>{assert.equal((await request('/api/jobs',{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'})).status,415);assert.equal((await request('/api/jobs',{method:'POST',headers:{Origin:'https://untrusted.example'},body:'{}'})).status,403);});
  await t.test('detail ID and status filter validated',async()=>{assert.equal((await request('/api/jobs/not-uuid')).status,400);assert.equal((await request('/api/jobs?status=bad')).status,400);});
  await t.test('retry preserves parent',async()=>{assert.equal((await request(`/api/jobs/${id}/retry`,{method:'POST',body:'{}'})).status,202);assert.equal(submissions.at(-1).retryOf,id);});
  await t.test('retry refuses unexpected payload',async()=>assert.equal((await request(`/api/jobs/${id}/retry`,{method:'POST',body:'{"extra":true}'})).status,400));
  await t.test('safe application errors',async()=>{repository.detail=async()=>{throw new AppError('JOB_NOT_FOUND',404);};assert.equal((await request(`/api/jobs/${id}`)).status,404);});
  await t.test('dependency errors sanitized',async()=>{unhealthy=true;const r=await request('/api/summary');assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'DEPENDENCY_UNAVAILABLE'});});
});
