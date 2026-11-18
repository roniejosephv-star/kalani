import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { apiServer } from '../src/server.js';
import { openFarmRuntime } from '../src/runtime.js';
import { fixtures, owner } from './support/fixtures.js';

const tokenA='synthetic_farmer_a_session_0000000000000000';
const tokenB='synthetic_farmer_b_session_0000000000000000';
const hash=(token:string)=>createHash('sha256').update(token).digest('hex');

test('HTTP authentication, owner boundaries, conflicts, input validation and reconnectable filtered events',async()=>{
 const directory=await mkdtemp('/private/tmp/farm-http-test-');const runtime=await openFarmRuntime(fixtures(directory));
 const server=apiServer(runtime,[{tokenHash:hash(tokenA),owner},{tokenHash:hash(tokenB),owner:'another-farmer'}]);
 try{
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request=(path:string,init:RequestInit={},token=tokenA)=>fetch(base+path,{...init,headers:{Authorization:`Bearer ${token}`,...init.headers}});
  assert.equal((await fetch(base+'/v1/state')).status,401);
  assert.equal((await request('/v1/state',{},'invalid')).status,401);
  const body={requestId:'http-confirm-facts',expectedVersion:0,facts:{crop:'நெல்',village:'SYNTHETIC'},fieldId:'field-1',cycleId:'cycle-1',owner:'another-farmer'};
  const result=await request('/v1/facts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal(result.status,200);assert.equal((await result.json()).facts.crop,'நெல்');
  const other=await (await request('/v1/state',{},tokenB)).json();assert.deepEqual(other.facts,{});
  const first=await (await request('/v1/state')).json();assert.ok(!('traces'in first));assert.ok(!('requests'in first));assert.ok(!('media'in first));
  const conflict=await request('/v1/facts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,facts:{crop:'பருத்தி'}})});
  assert.equal(conflict.status,409);assert.equal((await conflict.json()).error.code,'idempotency_conflict');
  for(const malformed of ['null','[]','{broken'])assert.equal((await request('/v1/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:malformed})).status,400);
  assert.equal((await request('/v1/messages',{method:'POST',headers:{'Content-Type':'text/plain'},body:'hello'})).status,415);
  assert.equal((await request('/v1/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:'oversized-request',text:'a'.repeat(70000)})})).status,413);
  const recording=Buffer.from('SYNTHETIC HTTP AUDIO');
  const upload=await request('/v1/audio',{method:'POST',headers:{'Content-Type':'audio/wav','Idempotency-Key':'http-recording-001'},body:recording});assert.equal(upload.status,201);
  const {audioId}=await upload.json();
  assert.equal((await request(`/v1/audio/${audioId}`,{},tokenB)).status,404);
  assert.deepEqual(Buffer.from(await (await request(`/v1/audio/${audioId}`)).arrayBuffer()),recording);
  const cursor=(await runtime.state(owner)).sequence;
  await runtime.preferences(owner,{requestId:'http-preferences-event',quietStart:21});
  const controller=new AbortController();
  const stream=await request('/v1/events',{headers:{'Last-Event-ID':String(cursor)},signal:controller.signal});assert.equal(stream.status,200);assert.match(stream.headers.get('content-type')??'',/text\/event-stream/);
  const reader=stream.body!.getReader();const chunk=await reader.read();const text=Buffer.from(chunk.value!).toString();
  assert.match(text,/preferences.updated/);assert.ok(!text.includes('facts.corrected'));assert.ok(!text.includes('traces'));assert.ok(!text.includes('SYNTHETIC'));assert.ok(!text.includes(tokenA));assert.ok(!text.includes('another-farmer'));
  await reader.cancel();controller.abort();
  const future=await request('/v1/events?after=999999',{signal:AbortSignal.timeout(1000)});const futureReader=future.body!.getReader();assert.match(Buffer.from((await futureReader.read()).value!).toString(),/snapshot.required/);await futureReader.cancel();
  const invalid=await request('/v1/events?after=-1');assert.equal(invalid.status,400);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await runtime.close();await rm(directory,{recursive:true,force:true});}
});
