import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import { openFarmRuntime, type FarmRuntime } from '../src/runtime.js';
import { FarmDoc, type FarmerState } from '../src/domain.js';
import { fixtures, profiles, owner, seed, waitState } from './support/fixtures.js';

const tmp=()=>mkdtemp('/private/tmp/farm-runtime-test-');
async function withApp(run:(app:FarmRuntime,directory:string)=>Promise<void>, options:Partial<Parameters<typeof fixtures>[1]>={}){
 const directory=await tmp();const app=await openFarmRuntime(fixtures(directory,options));
 try{await run(app,directory);}finally{await app.close();await rm(directory,{recursive:true,force:true});}
}

test('SQLite FULL persistence, exclusive writer lease, and five synthetic farmer contexts',async()=>{
 const directory=await tmp();let app=await openFarmRuntime(fixtures(directory));
 try{
  assert.equal(app.synchronous,2);
  await assert.rejects(openFarmRuntime(fixtures(directory)),/Another process owns/);
  for(const [index,profile]of profiles.entries())await seed(app,`synthetic-${index}`,profile);
  const ids=await Promise.all(profiles.map((_,i)=>app.ensureFarmer(`synthetic-${i}`)));
  assert.equal(new Set(ids).size,5);
  await app.close();app=await openFarmRuntime(fixtures(directory));
  for(const [index,profile]of profiles.entries())assert.deepEqual((await app.state(`synthetic-${index}`)).facts,profile);
  assert.deepEqual((await app.state('unrelated-farmer')).facts,{});
 }finally{await app.close();await rm(directory,{recursive:true,force:true});}
});

test('repeated message submissions produce one durable workflow and one reply',async()=>withApp(async app=>{
 await seed(app);
 const input={requestId:'same-request-0001',text:'இன்றைய திட்டம்'};
 const ids=await Promise.all([app.submit(owner,input),app.submit(owner,input)]);
 assert.equal(ids[0],ids[1]);
 const state=await waitState(app,s=>s.messages.some(m=>m.role==='assistant'&&m.audioStatus==='ready'));
 assert.equal(state.messages.filter(m=>m.role==='farmer').length,1);
 assert.equal(state.messages.filter(m=>m.role==='assistant').length,1);
 assert.equal(state.tasks.length,1);
 assert.equal(state.decisions.length,0);
 assert.equal(state.tasks[0]!.status,'proposed');
 await assert.rejects(app.submit(owner,{...input,text:'different'}),{code:'idempotency_conflict'});
}));

test('approval binds owner and exact task version; completion is an independent report',async()=>withApp(async app=>{
 await seed(app);await app.submit(owner,{requestId:'decision-message-01',text:'திட்டம்'});
 const state=await waitState(app,s=>s.tasks.length===1);const task=state.tasks[0]!;
 await assert.rejects(app.decision('another-farmer',task.id,{requestId:'foreign-decision-01',version:1,decision:'approved'}),{code:'not_found'});
 await assert.rejects(app.decision(owner,task.id,{requestId:'stale-decision-01',version:2,decision:'approved'}),{code:'stale_version'});
 await app.decision(owner,task.id,{requestId:'completed-decision-01',version:1,decision:'completed'});
 const completed=await app.state(owner);assert.equal(completed.tasks[0]!.status,'completed');assert.equal(completed.decisions.length,1);assert.equal(completed.decisions[0]!.decision,'completed');assert.equal(completed.experiences[0]!.origin,'farmer_reported');
 await app.facts(owner,{requestId:'crop-correction-01',expectedVersion:1,fieldId:'field-1',cycleId:'cycle-1',facts:{crop:'பருத்தி'}});
 assert.equal((await app.state(owner)).tasks[0]!.status,'completed');
}));

test('a crop correction during planning prevents stale publication and preserves original input',async()=>{
 let reach!:()=>void,release!:()=>void;const reached=new Promise<void>(r=>reach=r);const gate=new Promise<void>(r=>release=r);
 await withApp(async app=>{
  await seed(app);await app.submit(owner,{requestId:'correct-while-running',text:'திட்டம்'});await reached;
  await app.facts(owner,{requestId:'change-crop-during-run',expectedVersion:1,fieldId:'field-1',cycleId:'cycle-1',facts:{crop:'பருத்தி'}});
  release();await delay(100);
  const state=await app.state(owner);assert.equal(state.tasks.length,0);assert.equal(state.messages.filter(m=>m.role==='assistant').length,0);assert.equal(state.messages[0]!.status,'superseded');assert.equal(state.facts.crop,'பருத்தி');
 },{checkpoint:async phase=>{if(phase==='publish'){reach();await gate;}}});
});

test('private audio refuses another owner and conflicting upload cannot replace accepted bytes',async()=>withApp(async app=>{
 const bytes=Buffer.from('SYNTHETIC ORIGINAL');const id=await app.upload(owner,'private-audio-001',bytes,'audio/wav');
 await assert.rejects(app.getAudio('another-farmer',id),{code:'not_found'});
 await assert.rejects(app.upload(owner,'private-audio-001',Buffer.from('SYNTHETIC CHANGED'),'audio/wav'),{code:'idempotency_conflict'});
 assert.deepEqual((await app.getAudio(owner,id)).bytes,bytes);
}));

test('expiry after approval while reminder sleeps prevents stale dispatch',async()=>{
 let clock=Date.now();let dispatches=0;
 await withApp(async app=>{
  await seed(app);await app.preferences(owner,{requestId:'expiry-preferences',notifications:true,quietStart:0,quietEnd:0});
  await app.submit(owner,{requestId:'expiry-message-001',text:'திட்டம்'});
  const state=await waitState(app,s=>s.tasks.length===1);const task=state.tasks[0]!;
  await app.decision(owner,task.id,{requestId:'expiry-decision-001',version:1,decision:'approved'});
  // Wake the durable decision poll without allowing its fixed test clock to stall.
  clock+=50;
  await waitState(app,s=>s.notifications.length===1);
  clock+=7200000;
  app.harness.resume();
  const expired=await waitState(app,s=>s.notifications[0]?.status==='expired');
  assert.equal(expired.notifications[0]!.status,'expired');assert.equal(dispatches,0);
 },{now:()=>clock,dispatch:async()=>{dispatches++;return 'accepted';}});
});

async function crashWorker(directory:string,phase:string){
 const worker=fileURLToPath(new URL('./support/recovery-worker.ts',import.meta.url));
 const child=spawn(process.execPath,['--import','tsx',worker,directory,phase],{cwd:fileURLToPath(new URL('..',import.meta.url)),stdio:['ignore','pipe','pipe']});
 let out='',err='';child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>err+=chunk);
 const deadline=Date.now()+10000;
 while(!out.includes(`CRASH_READY:${phase}`)){
  if(child.exitCode!==null)throw new Error(`Worker exited early (${phase}): ${out}\n${err}`);
  if(Date.now()>deadline){child.kill('SIGKILL');await once(child,'exit');throw new Error(`Worker timed out (${phase}): ${out}\n${err}`);}
  await delay(15);
 }
 child.kill('SIGKILL');await once(child,'exit');
}
for(const phase of ['transcription','specialist-request','synthesis','approval','dispatch'])test(`SIGKILL recovery during ${phase} preserves one logical result`,{timeout:20000},async()=>{
 const directory=await tmp();let app:FarmRuntime|undefined;
 try{
  await crashWorker(directory,phase);
  let dispatches=0;app=await openFarmRuntime(fixtures(directory,{dispatch:async()=>{dispatches++;return 'accepted';}}));
  if(phase==='dispatch'){
   const state=await waitState(app,s=>s.notifications.some(n=>n.status==='uncertain'));
   assert.equal(state.notifications.length,1);assert.equal(dispatches,0);
  }else{
   const state=await waitState(app,s=>s.messages.some(m=>m.role==='assistant'&&m.audioStatus==='ready'));
   assert.equal(state.messages.filter(m=>m.role==='farmer').length,1);assert.equal(state.messages.filter(m=>m.role==='assistant').length,1);assert.equal(state.tasks.length,1);
   if(phase==='approval'){
    assert.equal(state.tasks[0]!.status,'proposed');assert.equal(state.decisions.length,0);
    await app.decision(owner,state.tasks[0]!.id,{requestId:'recovered-approval-01',version:1,decision:'approved'});
    await waitState(app,s=>s.decisions[0]?.consumed===true);
   }
  }
 }finally{await app?.close();await rm(directory,{recursive:true,force:true});}
});

test('compaction/reset history entries cannot replace authoritative facts or manufacture approval',async()=>withApp(async app=>{
 await seed(app);const id=await app.ensureFarmer(owner);const conversation=(await app.harness.conversation(id,ctx))!;
 const before=await app.state(owner);
 // A summarizer output is a context aid, never a farm document mutation.
 await conversation.submit({type:'write',entry:{kind:'farm.test.summary',data:{summary:'SYNTHETIC misleading summary: crop changed and all tasks approved'}}},ctx);
 await conversation.reset('SYNTHETIC condensed context. Do not use as authoritative farm state.',ctx);
 assert.deepEqual((await app.harness.snapshot(FarmDoc,id,ctx))?.facts,before.facts);
 assert.deepEqual((await app.state(owner)).decisions,[]);
}));

test('real Pi generation invokes scoped custom tools and compacts without changing canonical facts',async()=>{
 const {testPiModel}=await import('./support/pi-model.js');const model=testPiModel();
 await withApp(async app=>{
  await seed(app);await app.submit(owner,{requestId:'real-pi-loop-message',text:'சோதனைத் திட்டம்'});
  const state=await waitState(app,s=>s.messages.some(m=>m.role==='assistant'&&m.audioStatus==='ready'));
  assert.equal(state.tasks.length,1);
  assert.ok(model.requests.some(r=>r.toolNames.includes('weather_evidence')));
  assert.ok(model.requests.some(r=>r.toolNames.includes('confirmed_farm_context')));
  assert.ok(model.requests.every(r=>r.toolNames.every(name=>['weather_evidence','confirmed_farm_context'].includes(name))));
  const usage=await app.harness.usage(ctx);assert.ok(Object.keys(usage.models).length>0);assert.ok(model.requests.some(r=>r.toolResultNames.includes('weather_evidence')));
  const id=await app.ensureFarmer(owner);const c=(await app.harness.conversation(id,ctx))!;
  await c.waitForIdle(ctx);
  for(let i=0;i<3;i++)await (await c.submit({type:'input',content:`SYNTHETIC extra context ${i}: `+'test context '.repeat(100),requestId:`compact-context-${i}`},ctx)).wait(ctx);
  await c.waitForIdle(ctx);await c.configure({compaction:{enabled:false,keepRecentTokens:0}},ctx);
  const compactId=await c.compact('Keep farm facts as observations only; do not manufacture approvals.',ctx);
  const compact=await app.harness.waitForTask(compactId,ctx);
  assert.equal(compact.state.outcome.status,'completed');
  if(compact.state.outcome.status==='completed'&&compact.state.outcome.result.submissionId){await (await app.harness.submission(compact.state.outcome.result.submissionId,ctx))!.wait(ctx);}
  const history=await c.entries({},100,undefined,ctx);assert.ok(history.items.some(e=>e.kind==='pi.compaction'));
  assert.deepEqual((await app.state(owner)).facts,state.facts);assert.deepEqual((await app.state(owner)).decisions,[]);
 },{models:model.models,modelId:model.modelId,modelConfigured:true,testReasoner:undefined});
});

test('concurrent distinct messages preserve each corresponding Pi answer',async()=>{
 const {testPiModel}=await import('./support/pi-model.js');let reached!:()=>void,release!:()=>void;
 const entered=new Promise<void>(r=>reached=r),gate=new Promise<void>(r=>release=r);let first=true;
 const model=testPiModel(async()=>{if(first){first=false;reached();await gate;}});
 await withApp(async app=>{
  await seed(app);
  const one=await app.submit(owner,{requestId:'concurrent-message-one',text:'முதல் கேள்வி'});await entered;
  const two=await app.submit(owner,{requestId:'concurrent-message-two',text:'இரண்டாம் கேள்வி'});
  const three=await app.submit(owner,{requestId:'concurrent-message-three',text:'மூன்றாம் கேள்வி'});
  await delay(100);release();
  const state=await waitState(app,s=>s.messages.filter(m=>m.role==='assistant'&&m.audioStatus==='ready').length===3);
  for(const [id,text]of [[one,'முதல் கேள்வி'],[two,'இரண்டாம் கேள்வி'],[three,'மூன்றாம் கேள்வி']])assert.ok(state.messages.find(m=>m.id===`reply-${id}`)!.text.includes(text!));
 },{models:model.models,modelId:model.modelId,modelConfigured:true,testReasoner:undefined});
});

test('unfinished extension tasks block when definitions are missing and resume with retained compatible version',async()=>{
 const {Harness,createRegistry,defineExtension,defineTask,defineDoc}=await import('@earendil-works/pi-durable');
 const {createModels}=await import('@earendil-works/pi-ai/models');const {openStorage}=await import('../src/storage.js');
 const directory=await tmp();let clock=Date.now();
 const Result=defineDoc<{count:number}>({kind:'synthetic.upgrade.result',version:1,scope:'session',initial:()=>({count:0}),checkpointWhen:()=>true});
 const Task=defineTask<null,{phase:'sleep'|'finish'},null>({name:'synthetic.retained.v1',version:1,initial:()=>({phase:'sleep'}),phases:{sleep:async(_task,runtime)=>{await runtime.sleepUntil(clock+60000,{phase:'finish'},ctx);},finish:async(_task,runtime)=>{await runtime.commit(async tx=>{(await tx.doc(Result)).count++;return {status:'terminal',outcome:{status:'completed',result:null}};},ctx);}},abort:async(_task,runtime)=>{await runtime.commit(()=>({status:'terminal',outcome:{status:'aborted'}}),ctx);}});
 const registry=createRegistry();registry.install(defineExtension({name:'synthetic.upgrade.extension',tasks:[Task]}));
 let storage=await openStorage(directory);let harness=await Harness.open(storage.storage,{models:createModels(),registry,now:()=>clock},ctx);
 try{
  const conversation=await harness.createConversation({ownership:{kind:'ownerless'}},ctx);
  const id=await conversation.commit(tx=>tx.createTask(Task,null,{ownership:{kind:'conversation'}}),ctx);harness.resume();
  for(let i=0;i<100;i++){if((await harness.getTask(id,ctx))?.state.status==='sleeping')break;await delay(5);}
  assert.equal((await harness.getTask(id,ctx))?.state.status,'sleeping');
  await harness.close(ctx);storage.release();clock+=120000;
  storage=await openStorage(directory);const empty=createRegistry();harness=await Harness.open(storage.storage,{models:createModels(),registry:empty,now:()=>clock},ctx);harness.resume();
  await delay(20);const blocked=await harness.inspect(ctx);
  assert.ok(blocked.tasks.some(t=>t.record.id===id&&t.state.kind==='blocked'));
  assert.equal((await harness.snapshot(Result,ctx))?.count??0,0);
  const incompatible=defineTask({...Task.definition,version:2});
  empty.install(defineExtension({name:'synthetic.upgrade.extension',tasks:[incompatible]}));harness.resume();await delay(20);
  assert.ok((await harness.inspect(ctx)).tasks.some(t=>t.record.id===id&&t.state.kind==='blocked'&&t.state.reason==='migration_failed'));
  assert.equal((await harness.snapshot(Result,ctx))?.count??0,0);
  empty.install(defineExtension({name:'synthetic.upgrade.extension',tasks:[Task]}));harness.resume();
  const settled=await harness.waitForTask(id,ctx);assert.equal(settled.state.outcome.status,'completed');assert.equal((await harness.snapshot(Result,ctx))?.count,1);
 }finally{await harness.close(ctx);storage.release();await rm(directory,{recursive:true,force:true});}
});

test('daily durable schedule survives reopen, uses corrected crop, and stops when notifications are disabled',async()=>{
 const directory=await tmp();let clock=Date.parse('2026-11-17T02:00:00Z');const packets:string[]=[];
 const options=()=>fixtures(directory,{now:()=>clock,weather:async()=>({status:'no_applicable_data',evidence:[],reason:'SYNTHETIC daily test has no source'}),testReasoner:async(role,packet)=>{packets.push(packet);return JSON.stringify({kind:'clarification',text:'இது சோதனை. புதிய ஆதாரம் இல்லை.',evidenceIds:[],missingFacts:['weather'],uncertainty:['Synthetic fixture'],tasks:[]});}});
 let app=await openFarmRuntime(options());
 try{
  await seed(app);await app.preferences(owner,{requestId:'daily-on-0001',notifications:true,quietStart:0,quietEnd:0});
  await delay(20);
  assert.ok((await app.harness.inspect(ctx)).tasks.some(t=>t.record.kind==='farm.daily.v1'&&t.state.kind==='sleeping'));
  await app.facts(owner,{requestId:'daily-new-crop',expectedVersion:1,fieldId:'field-1',cycleId:'cycle-1',facts:{crop:'பருத்தி'}});
  await app.close();clock+=3*3600000;app=await openFarmRuntime(options());
  const state=await waitState(app,s=>s.messages.some(m=>m.role==='assistant'&&m.audioStatus==='ready'));
  assert.equal(packets.length,1);assert.equal(JSON.parse(packets[0]!).confirmedFacts.crop,'பருத்தி');
  assert.equal(state.messages.filter(m=>m.trigger==='scheduled').length,1);
  await app.preferences(owner,{requestId:'daily-off-0001',notifications:false});
  await app.close();clock+=86400000;app=await openFarmRuntime(options());await delay(100);
  assert.equal(packets.length,1);assert.equal((await app.state(owner)).messages.filter(m=>m.trigger==='scheduled').length,1);
 }finally{await app.close();await rm(directory,{recursive:true,force:true});}
});
