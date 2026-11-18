import { openFarmRuntime } from '../../src/runtime.js';
import { fixtures, owner, seed, waitState } from './fixtures.js';
const directory=process.argv[2]!, crashAt=process.argv[3]!;
async function crashPoint(phase:string){if(phase===crashAt){process.stdout.write(`CRASH_READY:${phase}\n`);await new Promise<void>(()=>{});}}
const options=fixtures(directory,{checkpoint:crashPoint});
if(crashAt==='transcription')options.speech={...options.speech!,transcribe:async()=>{await crashPoint('transcription');return {text:'சோதனை',language:'ta-IN'};}};
if(crashAt==='specialist-request'){const reasoner=options.testReasoner!;options.testReasoner=async(role,packet)=>{if(role==='weather')await crashPoint('specialist-request');return reasoner(role,packet);};}
if(crashAt==='synthesis')options.speech={...options.speech!,synthesize:async()=>{await crashPoint('synthesis');return {audio:Buffer.from('SYNTHETIC'),mime:'audio/wav'};}};
const app=await openFarmRuntime(options);
await seed(app);
await app.preferences(owner,{requestId:'synthetic-preferences',notifications:true,quietStart:0,quietEnd:0});
const audioId=await app.upload(owner,'synthetic-recording',Buffer.from('SYNTHETIC TEST INPUT'),'audio/wav');
await app.submit(owner,{requestId:'synthetic-message',audioId});
if(crashAt==='dispatch'){
 const state=await waitState(app,s=>s.tasks.length===1);
 await app.decision(owner,state.tasks[0]!.id,{requestId:'synthetic-approval',version:1,decision:'approved'});
}
setInterval(()=>{},1000);
