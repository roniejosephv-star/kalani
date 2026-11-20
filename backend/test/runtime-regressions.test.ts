import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import { AgentDoc, configure } from '@earendil-works/pi-durable';
import { AdapterError, SPEECH_TEXT_LIMIT, type FarmLocale } from '../src/adapters.js';
import { openFarmRuntime, type FarmRuntime, type RuntimeOptions } from '../src/runtime.js';
import { FarmDoc, decodePlan, publicState } from '../src/domain.js';
import { hasLocaleScript, spokenLanguageCommand } from '../src/languages.js';
import { renderRainForecast } from '../src/weather-copy.js';
import { fixtures, owner, seed, waitState } from './support/fixtures.js';
import { testPiModel } from './support/pi-model.js';
async function withApp(run:(app:FarmRuntime,directory:string)=>Promise<void>, options:Partial<RuntimeOptions>={}){
 const directory=await mkdtemp('/private/tmp/farm-regression-test-');const app=await openFarmRuntime(fixtures(directory,options));
 try{await run(app,directory);}finally{await app.close();await rm(directory,{recursive:true,force:true});}
}

for(const kind of ['guidance','clarification','refusal'] as const)test(`chemical quantities in ${kind} narrative become a deterministic refusal before publication`,async()=>{
 const base=fixtures('/unused').testReasoner!;
 await withApp(async app=>{
  await seed(app);await app.submit(owner,{requestId:`chemical-${kind}-001`,text:'மருந்து பற்றி கேள்வி'});
  const state=await waitState(app,s=>s.messages.some(m=>m.role==='assistant'&&m.audioStatus==='ready'));
  const answer=state.messages.find(m=>m.role==='assistant')!;
  assert.match(answer.text,/உறுதி செய்ய முடியவில்லை/);assert.ok(!answer.text.includes('250'));assert.equal(state.tasks.length,0);
  assert.ok(state.events.some(e=>e.type==='plan.refusal'));assert.deepEqual(answer.evidenceIds,[]);
 },{testReasoner:async(role,packet)=>role==='main'?JSON.stringify({kind,text:'பூச்சிக்கொல்லி மருந்து 250 ml பயன்படுத்தவும்.',evidenceIds:['synthetic-weather'],missingFacts:[],uncertainty:[],tasks:[]}):base(role,packet)});
});

for(const [locale,text] of [
 ['en-IN','The forecast covers 20–26 November. Which topic do you mean: field activities or timing (sowing, transplanting, fertiliser application, harvest)?'],
 ['ta-IN','நவம்பர் 20 முதல் 26 வரை வானிலைத் தகவல் உள்ளது. விதைப்பு, உரம், அறுவடை இவற்றில் எதைப் பற்றி கேட்கிறீர்கள் என்று தெளிவுபடுத்தவும்.'],
] as const)test(`a neutral ${locale} clarification can name field topics and weather dates`,async()=>{
 const base=fixtures('/unused').testReasoner!;
 await withApp(async app=>{
  await seed(app);
  await app.preferences(owner,{requestId:'clarification-locale',locale});
  const id=await app.submit(owner,{requestId:'neutral-field-topic',text:'Field activities?'});
  const state=await waitState(app,s=>s.messages.some(m=>m.id===`reply-${id}`&&m.audioStatus==='ready'));
  assert.equal(state.messages.find(m=>m.id===`reply-${id}`)?.text,text);
  assert.ok(state.events.some(e=>e.type==='plan.clarification'));
  assert.equal(state.tasks.length,0);
 },{testReasoner:async(role,packet)=>role==='main'?JSON.stringify({kind:'clarification',text,evidenceIds:['synthetic-weather'],missingFacts:[],uncertainty:[],tasks:[]}):base(role,packet)});
});

test('a clarification cannot direct chemical intervention without dosing information',async()=>{
 const base=fixtures('/unused').testReasoner!;
 await withApp(async app=>{
  await seed(app);
  await app.preferences(owner,{requestId:'directive-locale',locale:'en-IN'});
  await app.submit(owner,{requestId:'chemical-directive-blocked',text:'Field activities?'});
  const state=await waitState(app,s=>s.messages.some(m=>m.role==='assistant'&&m.audioStatus==='ready'));
  assert.ok(state.events.some(e=>e.type==='plan.refusal'));
  assert.equal(state.tasks.length,0);
 },{testReasoner:async(role,packet)=>role==='main'?JSON.stringify({kind:'clarification',text:'Please apply fertiliser tomorrow. When was the field planted?',evidenceIds:['synthetic-weather'],missingFacts:[],uncertainty:[],tasks:[]}):base(role,packet)});
});

test('chemical interventions cannot be proposed as tasks even without dosing information',async()=>{
 const base=fixtures('/unused').testReasoner!;
 await withApp(async app=>{
  await seed(app);
  const id=await app.submit(owner,{requestId:'chemical-task-blocked',text:'திட்டம்'});
  const state=await waitState(app,s=>s.messages.some(m=>m.id===`reply-${id}`&&m.audioStatus==='ready'));
  assert.ok(state.events.some(e=>e.type==='plan.refusal'));
  assert.equal(state.tasks.length,0);
 },{testReasoner:async(role,packet)=>role==='main'?JSON.stringify({kind:'guidance',text:'இந்த வாரம் வயலைப் பார்வையிடவும்.',evidenceIds:['synthetic-weather'],missingFacts:[],uncertainty:[],tasks:[{title:'உரம் இடவும்',reason:'சோதனைப் பரிந்துரை',dueAt:new Date(Date.now()+360000).toISOString(),evidenceIds:['synthetic-weather'],uncertainty:[]}]}):base(role,packet)});
});

test('postponed task needs a new proposal for approval but still accepts an independent completion report',async()=>withApp(async app=>{
 await seed(app);await app.submit(owner,{requestId:'postpone-message-001',text:'திட்டம்'});
 const state=await waitState(app,s=>s.tasks.length===1);const task=state.tasks[0]!;
 await app.decision(owner,task.id,{requestId:'postpone-decision-001',version:1,decision:'postponed'});
 await assert.rejects(app.decision(owner,task.id,{requestId:'reapprove-postponed-01',version:1,decision:'approved'}),{code:'closed_task'});
 await app.decision(owner,task.id,{requestId:'completed-postponed-01',version:1,decision:'completed'});
 const latest=await app.state(owner);assert.equal(latest.tasks[0]!.status,'completed');assert.equal(latest.decisions.filter(d=>d.decision==='approved').length,0);assert.equal(latest.experiences[0]!.origin,'farmer_reported');assert.equal(latest.notifications.length,0);
}));

test('account deletion joins blocked synthesis and prevents media recreation or later uploads',{timeout:10000},async()=>{
 let entered!:()=>void,release!:()=>void;const reached=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
 const defaultSpeech=fixtures('/unused').speech!;
 await withApp(async(app,directory)=>{
  await seed(app);const recording=await app.upload(owner,'deletion-recording-01',Buffer.from('SYNTHETIC PRIVATE RECORDING'),'audio/wav');
  const cid=await app.ensureFarmer(owner);await app.submit(owner,{requestId:'deletion-synthesis-01',text:'திட்டம்'});await reached;
  const removal=app.remove(owner,'delete-account-001');
  try{
   for(let i=0;i<100;i++){if((await app.harness.snapshot(FarmDoc,cid,ctx))?.deleted)break;await delay(5);}
   assert.equal((await app.harness.snapshot(FarmDoc,cid,ctx))?.deleted,true);
  }finally{release();}
  await removal;
  await assert.rejects(app.state(owner),{code:'account_deleted'});
  await assert.rejects(app.upload(owner,'upload-after-delete-01',Buffer.from('LATER SYNTHETIC AUDIO'),'audio/wav'),{code:'account_deleted'});
  await assert.rejects(app.audio.read(owner,recording),{code:'ENOENT'});
  await assert.rejects(access(join(directory,'audio',createHash('sha256').update(owner).digest('hex'))),{code:'ENOENT'});
  assert.deepEqual((await app.harness.snapshot(FarmDoc,cid,ctx))?.media,{});
 },{speech:{...defaultSpeech,synthesize:async()=>{entered();await gate;return {audio:Buffer.from('SYNTHETIC LATE SYNTHESIS'),mime:'audio/wav'};}}});
});

test('farmer projection excludes workflow identifiers and scheduler prompt scaffolding',async()=>withApp(async app=>{
 await seed(app);await app.submit(owner,{requestId:'projection-message-01',text:'திட்டம்'});
 const state=await waitState(app,s=>s.tasks.length===1);state.messages.push({id:'synthetic-daily-scaffold',role:'assistant',text:'INTERNAL SYNTHETIC SCHEDULER PROMPT',status:'queued',createdAt:new Date().toISOString(),contextVersion:1,trigger:'scheduled',workflowId:42});
 const visible=publicState(state);
 assert.ok(!('scheduleRevision'in visible));assert.ok(!('traces'in visible));assert.ok(visible.messages.every(m=>!('workflowId'in m)&&!('trigger'in m)));
 assert.ok(visible.tasks.every(t=>!('waitTaskId'in t)));assert.ok(!JSON.stringify(visible).includes('INTERNAL SYNTHETIC SCHEDULER PROMPT'));
}));

for(const defect of ['string fields','trailing prose'] as const)test(`Pi repairs a specialist response with ${defect} once before publication`,async()=>{
 const question='இந்த வாரம் மழை பெய்யுமா?';
 const valid={summary:'Synthetic weather finding',evidenceIds:['synthetic-weather'],applicability:'Synthetic field only',missingFacts:[],uncertainty:['Synthetic fixture']};
 const broken={...valid,missingFacts:'None',uncertainty:'Synthetic fixture'};
 const initial='\x60\x60\x60json\n'+JSON.stringify(broken)+'\n\x60\x60\x60'+(defect==='trailing prose'?'\nSynthetic prose outside the JSON.':'');
 const prompts:string[]=[];
 const model=testPiModel(undefined,prompt=>{prompts.push(prompt);return prompts.length===1?initial:JSON.stringify(valid);});
 await withApp(async app=>{
  await seed(app);const id=await app.submit(owner,{requestId:`malformed-specialist-${defect}`.replaceAll(' ','-'),text:question});
  const state=await waitState(app,s=>s.messages.some(m=>m.status==='failed'||m.audioStatus==='ready'));
  assert.equal(state.messages.find(m=>m.id===id)?.status,'ready');
  assert.equal(state.messages.find(m=>m.id===`reply-${id}`)?.audioStatus,'ready');
  assert.equal(prompts.length,2);assert.ok(prompts[0]!.includes(question));
  assert.ok(model.requests.some(r=>r.toolNames.includes('confirmed_farm_context')));
 },{models:model.models,modelId:model.modelId,modelConfigured:true,testReasoner:undefined});
});

test('a persistently malformed specialist fails with a classified error after one repair',async()=>{
 let replies=0;
 const model=testPiModel(undefined,()=>{replies++;return 'synthetic non-JSON response';});
 await withApp(async app=>{
  await seed(app);const id=await app.submit(owner,{requestId:'malformed-specialist-exhausted',text:'வானிலை'});
  const state=await waitState(app,s=>s.messages.some(m=>m.status==='failed'));
  const message=state.messages.find(m=>m.id===id)!;
  assert.equal(message.error,'invalid_specialist_output');
  const task=await app.harness.waitForTask(message.workflowId! as Parameters<typeof app.harness.waitForTask>[0],ctx);
  assert.deepEqual(task.state.outcome,{status:'failed',error:{message:'invalid_specialist_output',detail:{phase:'specialists',reason:'json'}}});
  assert.equal(replies,2);assert.equal(state.tasks.length,0);
  assert.equal(state.messages.some(m=>m.role==='assistant'),false);
  assert.equal(model.requests.some(r=>r.toolNames.includes('confirmed_farm_context')),false);
 },{models:model.models,modelId:model.modelId,modelConfigured:true,testReasoner:undefined});
});

test('a specialist cannot cite evidence assigned only to a different role',async()=>{
 const at=new Date().toISOString(),until=new Date(Date.now()+3600000).toISOString();let mainCalls=0,weatherCalls=0;
 await withApp(async app=>{
  await seed(app);await app.submit(owner,{requestId:'wrong-role-evidence-01',text:'திட்டம்'});
  const state=await waitState(app,s=>s.messages.some(m=>m.role==='farmer'&&m.status==='failed'));
  assert.equal(state.messages[0]!.error,'invalid_specialist_output');assert.equal(state.tasks.length,0);assert.equal(state.messages.filter(m=>m.role==='assistant').length,0);assert.equal(mainCalls,0);assert.equal(weatherCalls,1);
 },{catalogue:[{kind:'crop',reviewStatus:'reviewed',reviewer:'SYNTHETIC reviewer',reviewedAt:at,validFrom:at,validUntil:until,evidence:{id:'synthetic-crop-only',source:'SYNTHETIC TNAU catalogue fixture',url:'https://agritech.tnau.ac.in/synthetic-test-only',title:'Synthetic crop source',retrievedAt:at,validUntil:until,status:'current',scope:{crop:'நெல்'},units:{},data:{synthetic:true},passage:'SYNTHETIC test crop evidence, never production guidance.'}}],testReasoner:async(role)=>{
  if(role==='main')mainCalls++;
  if(role==='weather')weatherCalls++;
  return JSON.stringify({summary:'Synthetic misplaced evidence',evidenceIds:['synthetic-crop-only'],applicability:'Synthetic',missingFacts:[],uncertainty:[]});
 }});
});

test('reconciliation repairs oversized text and a speech failure preserves the cited text for audio retry',async()=>{
 const fixture=fixtures('/unused');let mainCalls=0,speechCalls=0;
 const answer='இந்த வாரம் மழை பெய்ய வாய்ப்புள்ளது.';
 await withApp(async app=>{
  await seed(app);const id=await app.submit(owner,{requestId:'speech-fallback-message',text:'இந்த வாரம் மழை பெய்யுமா?'});
  const replyId=`reply-${id}`;
  let state=await waitState(app,s=>s.messages.some(m=>m.id===replyId&&m.audioStatus==='failed'));
  let reply=state.messages.find(m=>m.id===replyId)!;
  assert.equal(reply.text,answer);assert.equal(reply.status,'ready');assert.equal(reply.audioId,undefined);
  assert.deepEqual(reply.evidenceIds,['synthetic-weather']);assert.equal(state.tasks.length,0);
  await app.retryAudio(owner,replyId,'speech-fallback-retry');
  state=await waitState(app,s=>s.messages.some(m=>m.id===replyId&&m.audioStatus==='ready'));
  reply=state.messages.find(m=>m.id===replyId)!;
  assert.ok(reply.audioId);assert.equal(reply.text,answer);
  assert.equal(mainCalls,2);assert.equal(speechCalls,2);
 },{testReasoner:async(role,packet)=>{
  if(role!=='main')return fixture.testReasoner!(role,packet);
  mainCalls++;
  return JSON.stringify({kind:'guidance',text:mainCalls===1?'ம'.repeat(SPEECH_TEXT_LIMIT+1):answer,evidenceIds:['synthetic-weather'],missingFacts:[],uncertainty:[],tasks:[]});
 },speech:{...fixture.speech!,synthesize:async text=>{
  assert.equal(text,answer);
  if(++speechCalls===1)throw new Error('Synthetic synthesis outage');
  return {audio:Buffer.from('SYNTHETIC SPEECH RETRY BYTES'),mime:'audio/wav'};
 }}});
});

test('same farmer switches language while a voice message is processing without changing the original reply locale',async()=>{
 const fixture=fixtures('/unused');
 const model=testPiModel();
 const calls:{stage:string;locale?:FarmLocale}[]=[];
 let entered!:()=>void, release!:()=>void;
 const reached=new Promise<void>(resolve=>{entered=resolve;});
 const gate=new Promise<void>(resolve=>{release=resolve;});
 await withApp(async app=>{
  await seed(app);
  const conversationId=await app.ensureFarmer(owner);
  await app.harness.commit(tx=>configure(tx,conversationId,{instructions:'You are a Tamil farm assistant. Reply only in Tamil.'}),ctx);
  assert.equal((await app.state(owner)).preferences.locale,'ta-IN');
  await app.preferences(owner,{requestId:'select-english',locale:'en-IN'});
  const recording=await app.upload(owner,'language-recording-001',Buffer.from('SYNTHETIC LANGUAGE RECORDING'),'audio/wav');
  const english=await app.submit(owner,{requestId:'language-english-001',audioId:recording});
  await reached;
  try{await app.preferences(owner,{requestId:'select-tamil',locale:'ta-IN'});}finally{release();}
  await waitState(app,s=>s.messages.some(m=>m.id===`reply-${english}`&&m.audioStatus==='ready'));
  assert.match((await app.harness.snapshot(AgentDoc,conversationId,ctx))!.instructions!,/requested response language/);
  const tamil=await app.submit(owner,{requestId:'language-tamil-001',audioId:recording});
  const state=await waitState(app,s=>s.messages.some(m=>m.id===`reply-${tamil}`&&m.audioStatus==='ready'));
  assert.equal(state.preferences.locale,'ta-IN');
  assert.equal(state.messages.find(m=>m.id===english)?.text,'Will it rain this week?');
  assert.match(state.messages.find(m=>m.id===`reply-${english}`)!.text,/Check the field/);
  assert.equal(state.messages.find(m=>m.id===`reply-${english}`)?.locale,'en-IN');
  assert.equal(state.messages.find(m=>m.id===tamil)?.text,'இந்த வாரம் மழை பெய்யுமா?');
  assert.equal(state.messages.find(m=>m.id===`reply-${tamil}`)?.locale,'ta-IN');
  assert.deepEqual(calls,[{stage:'stt',locale:'en-IN'},{stage:'tts',locale:'en-IN'},{stage:'stt',locale:'ta-IN'},{stage:'tts',locale:'ta-IN'}]);
  for(const [language,role] of [['English (en-IN)','weather_evidence'],['English (en-IN)','confirmed_farm_context'],['Tamil (ta-IN)','weather_evidence'],['Tamil (ta-IN)','confirmed_farm_context']]){
   assert.ok(model.requests.some(r=>r.toolNames.includes(role!)&&r.lastUser.includes(language!)));
  }
  await assert.rejects(app.preferences(owner,{requestId:'unsupported-hindi',locale:'hi-IN'}),{code:'unsupported_locale'});
  assert.equal((await app.state(owner)).preferences.locale,'ta-IN');
 },{models:model.models,modelId:model.modelId,modelConfigured:true,testReasoner:undefined,speech:{...fixture.speech!,
  transcribe:async(_audio,_mime,_keywords,locale)=>{
   calls.push({stage:'stt',locale});
   if(locale==='en-IN'){entered();await gate;return {text:'Will it rain this week?',language:locale};}
   return {text:'இந்த வாரம் மழை பெய்யுமா?',language:'ta-IN'};
  },
  synthesize:async(text,locale)=>{calls.push({stage:'tts',locale});return fixture.speech!.synthesize(text,locale);},
 }});
});

test('explicit language commands work in both directions without treating mixed speech as a change',async()=>{
 const fixture=fixtures('/unused');
 assert.equal(spokenLanguageCommand('Please, speak in Tamil from now on.'),'ta-IN');
 assert.equal(spokenLanguageCommand('தயவுசெய்து தமிழ்ல பதில் சொல்லு'),'ta-IN');
 assert.equal(spokenLanguageCommand('Please reply in Tamil and check the forecast.'),undefined);
 const spoken:FarmLocale[]=[];
 const transcriptions=['Reply in Tamil.','Rain forecast in Tamil Nadu?','இங்கிலீஷ்ல பேசுங்க.'];
 await withApp(async app=>{
  await app.preferences(owner,{requestId:'initial-english-01',locale:'en-IN'});
  const audioId=await app.upload(owner,'spoken-switch-audio',Buffer.from('SYNTHETIC COMMAND'),'audio/wav');
  let oldAudioId:string|undefined;
  let oldAudio:Buffer|undefined;
  for(const [index,locale] of ['ta-IN','ta-IN','en-IN'].entries()){
   const messageId=await app.submit(owner,{requestId:`spoken-language-${index}`,audioId});
   const state=await waitState(app,s=>s.messages.some(m=>m.id===`reply-${messageId}`&&m.audioStatus==='ready'));
   const reply=state.messages.find(m=>m.id===`reply-${messageId}`)!;
   assert.equal(state.preferences.locale,locale);
   assert.equal(reply.locale,locale);
   assert.equal(state.messages.find(m=>m.id===messageId)?.locale,index===0?'en-IN':'ta-IN');
   if(index===0){oldAudioId=reply.audioId!;oldAudio=(await app.getAudio(owner,oldAudioId)).bytes;}
  }
  assert.deepEqual(spoken,['ta-IN','ta-IN','en-IN']);
  assert.deepEqual((await app.getAudio(owner,oldAudioId!)).bytes,oldAudio);
 },{speech:{...fixture.speech!,transcribe:async()=>({text:transcriptions.shift()!,language:null}),
  synthesize:async(text,locale)=>{spoken.push(locale!);return fixture.speech!.synthesize(text,locale);},
 },route:async()=>JSON.stringify({routes:[],clarification:'எந்தத் தகவல் வேண்டும்?'})});
});

test('delayed speech cannot override a manual language selection, including a repeat selection',async()=>{
 const fixture=fixtures('/unused');
 let entered!:()=>void, release!:()=>void;
 const reached=new Promise<void>(resolve=>{entered=resolve;});
 const gate=new Promise<void>(resolve=>{release=resolve;});
 await withApp(async app=>{
  await app.preferences(owner,{requestId:'manual-english-initial',locale:'en-IN'});
  const audioId=await app.upload(owner,'delay-switch-audio',Buffer.from('SYNTHETIC COMMAND'),'audio/wav');
  const id=await app.submit(owner,{requestId:'delay-switch-message',audioId});
  await reached;
  try{await app.preferences(owner,{requestId:'manual-english-repeat',locale:'en-IN'});}finally{release();}
  const state=await waitState(app,s=>s.messages.some(m=>m.id===`reply-${id}`&&m.audioStatus==='ready'));
  assert.equal(state.preferences.locale,'en-IN');
  assert.match(state.messages.find(m=>m.id===`reply-${id}`)!.text,/most recently/);
 },{speech:{...fixture.speech!,transcribe:async()=>{entered();await gate;return {text:'Reply in Tamil.',language:'en-IN'};}}});
});

test('pilot languages have independent enablement, voice commands and plain forecast copy',async()=>{
 const previous=process.env.KALANI_PILOT_LANGUAGES;
 try{
  delete process.env.KALANI_PILOT_LANGUAGES;
  await withApp(async app=>{
   assert.deepEqual(publicState(await app.state(owner)).enabledLanguages,['en-IN','ta-IN']);
   await assert.rejects(app.preferences(owner,{requestId:'pilot-disabled',locale:'kn-IN'}),{code:'unsupported_locale'});
   for (const [locale,command] of [
    ['kn-IN','ಕನ್ನಡದಲ್ಲಿ ಮಾತಾಡಿ'],
    ['ml-IN','മലയാളത്തിൽ സംസാരിക്കൂ'],
    ['te-IN','తెలుగులో మాట్లాడండి'],
   ] as const){
    process.env.KALANI_PILOT_LANGUAGES=locale;
    const state=await app.preferences(owner,{requestId:`pilot-language-${locale}`,locale});
    assert.deepEqual(state.enabledLanguages,['en-IN','ta-IN',locale]);
    assert.equal(state.preferences.locale,locale);
    assert.equal(spokenLanguageCommand(command),locale);
    const forecast=renderRainForecast({timezone:'Asia/Kolkata',days:[{date:'2026-11-20',likelihood:'possible'}]},locale);
    assert.ok(hasLocaleScript(forecast,locale));
    assert.doesNotMatch(forecast,/%|percent/iu);
   }
  });
 }finally{
  if(previous===undefined)delete process.env.KALANI_PILOT_LANGUAGES;
  else process.env.KALANI_PILOT_LANGUAGES=previous;
 }
});

test('a speech provider outage leaves the recording available for a same-message retry',async()=>{
 const fixture=fixtures('/unused');let calls=0;
 await withApp(async app=>{
  await seed(app);
  const recording=await app.upload(owner,'speech-outage-upload',Buffer.from('SYNTHETIC RECORDING'),'audio/mp4');
  const id=await app.submit(owner,{requestId:'speech-outage-submit',audioId:recording});
  let state=await waitState(app,s=>s.messages.some(m=>m.id===id&&m.status==='failed'));
  assert.equal(state.messages.find(m=>m.id===id)?.error,'transcription_unavailable');
  assert.equal(state.messages.find(m=>m.id===id)?.audioId,recording);
  assert.equal(state.messages.filter(m=>m.role==='assistant').length,0);
  assert.equal(await app.retryMessage(owner,id,'speech-outage-retry'),id);
  state=await waitState(app,s=>s.messages.some(m=>m.id===`reply-${id}`&&m.audioStatus==='ready'));
  assert.equal(state.messages.filter(m=>m.role==='farmer').length,1);
  assert.equal(calls,2);
 },{speech:{...fixture.speech!,transcribe:async(...args)=>{
  if(++calls===1)throw new AdapterError('unavailable','Private provider details',503);
  return fixture.speech!.transcribe(...args);
 }}});
});

test('plan validation gates pure opposite-language reply text',()=>{
 const english={kind:'clarification',text:'Where is your field?',evidenceIds:[],missingFacts:[],uncertainty:[],tasks:[]};
 const tamil={...english,text:'உங்கள் வயல் எங்கே உள்ளது?'};
 assert.equal(decodePlan(JSON.stringify(english),'en-IN').text,english.text);
 assert.equal(decodePlan(JSON.stringify(tamil),'ta-IN').text,tamil.text);
 assert.throws(()=>decodePlan(JSON.stringify(english),'ta-IN'),{code:'invalid_model_output'});
 assert.throws(()=>decodePlan(JSON.stringify(tamil),'en-IN'),{code:'invalid_model_output'});
});

test('prototype-shaped request IDs, farmer IDs, facts and media lookups cannot bypass ownership',async()=>withApp(async app=>{
 for(const key of ['__proto__','constructor','prototype']){
  await assert.rejects(app.state(key),{code:'invalid_owner'});
  await assert.rejects(app.submit(owner,{requestId:key,text:'சோதனை'}),{code:'invalid_request_id'});
  await assert.rejects(app.getAudio(owner,key),{code:'not_found'});
 }
 const malicious=JSON.parse('{"__proto__":{"polluted":true}}');
 await assert.rejects(app.facts(owner,{requestId:'proto-facts-0001',expectedVersion:0,fieldId:'field-1',cycleId:'cycle-1',facts:malicious}),{code:'invalid_fact'});
 assert.deepEqual((await app.state(owner)).facts,{});assert.equal(Object.prototype.hasOwnProperty.call({},'polluted'),false);
}));

test('public weather snapshots reuse exact coordinates across farmers without sharing private facts and refresh after expiry',async()=>{
 let clock=Date.now(),fetches=0;const packets:{role:string;packet:string}[]=[];
 await withApp(async app=>{
  await seed(app,owner);await seed(app,'private-second-farmer',{crop:'பருத்தி',village:'PRIVATE SECOND FARMER VILLAGE',latitude:10.79,longitude:79.14});
  await app.submit(owner,{requestId:'cached-weather-first',text:'வானிலை'});await waitState(app,s=>s.messages.some(m=>m.role==='assistant'&&m.audioStatus==='ready'));
  await app.submit('private-second-farmer',{requestId:'cached-weather-second',text:'வானிலை'});await waitState(app,s=>s.messages.some(m=>m.role==='assistant'&&m.audioStatus==='ready'),'private-second-farmer');
  assert.equal(fetches,1);assert.ok(!JSON.stringify(await app.state(owner)).includes('PRIVATE SECOND FARMER VILLAGE'));
  const firstPacket=packets.find(p=>p.role==='main')!;assert.ok(!firstPacket.packet.includes('PRIVATE SECOND FARMER VILLAGE'));
  clock+=2000;
  await app.submit(owner,{requestId:'cached-weather-expired',text:'புதிய வானிலை'});await waitState(app,s=>s.messages.filter(m=>m.role==='assistant'&&m.audioStatus==='ready').length===2);
  assert.equal(fetches,2);
 },{now:()=>clock,weather:async(location)=>{fetches++;return {status:'available',evidence:[{id:`synthetic-cached-weather-${fetches}`,source:'SYNTHETIC cached weather',url:'https://example.invalid/synthetic-cache',title:'Synthetic public weather',retrievedAt:new Date(clock).toISOString(),validUntil:new Date(clock+1000).toISOString(),status:'current',scope:location,units:{rain:'mm'},data:{synthetic:true,rain:1}}]};},testReasoner:async(role,packet)=>{
  packets.push({role,packet});
  if(role!=='main'){const data=JSON.parse(packet);return JSON.stringify({summary:'Synthetic weather source',evidenceIds:data.evidence.map((e:{id:string})=>e.id),applicability:'Synthetic coordinates',missingFacts:[],uncertainty:[]});}
  return JSON.stringify({kind:'clarification',text:'இது சோதனை. உங்கள் நிலத்தின் நிலையைத் தெரிவிக்கவும்.',evidenceIds:[],missingFacts:['observation'],uncertainty:[],tasks:[]});
 }});
});
