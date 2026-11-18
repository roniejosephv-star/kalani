import { setTimeout as delay } from 'node:timers/promises';
import type { RuntimeOptions, FarmRuntime } from '../../src/runtime.js';
import type { FarmerState } from '../../src/domain.js';

// Explicitly synthetic provider fixtures. These are never loaded by the service entry point.
export const owner = 'synthetic-farmer';
export const profiles = [
 {crop:'நெல்',village:'Synthetic rice village',latitude:10.79,longitude:79.14},
 {crop:'பருத்தி',village:'Synthetic cotton village',latitude:11.02,longitude:76.96},
 {crop:'வாழை',village:'Synthetic banana village',latitude:10.75,longitude:78.7},
 {crop:'நிலக்கடலை',village:'Synthetic groundnut village',latitude:12.11,longitude:79.7},
 {crop:'தக்காளி',village:'Synthetic tomato village',latitude:12.12,longitude:78.1},
];
export function fixtures(directory:string, extra:Partial<RuntimeOptions>={}):RuntimeOptions {
 const weather: NonNullable<RuntimeOptions['weather']> = async location => ({status:'available',evidence:[{id:'synthetic-weather',source:'SYNTHETIC TEST WEATHER',url:'https://example.invalid/synthetic-weather',title:'Synthetic test forecast',retrievedAt:new Date().toISOString(),validUntil:new Date(Date.now()+3600000).toISOString(),status:'current',scope:location,units:{precipitation:'mm'},data:{fixture:true,precipitation:4}}]});
 return {directory,modelConfigured:false,approvalPollMs:20,weather,
  speech:{configured:true,transcribe:async()=>({text:'இன்று என்ன செய்ய வேண்டும்?',language:'ta-IN'}),synthesize:async()=>({audio:Buffer.from('SYNTHETIC AUDIO TEST BYTES'),mime:'audio/wav'})},
  testReasoner:async(role,packet)=>{
   if(role!=='main')return JSON.stringify({summary:'Synthetic source explanation',evidenceIds:['synthetic-weather'],applicability:'Test crop and field only',missingFacts:[],uncertainty:['Synthetic fixture']});
   const p=JSON.parse(packet);const hasWeather=!!p.sources?.weather?.evidence?.length;
   return JSON.stringify({kind:hasWeather?'guidance':'clarification',text:hasWeather?'இது சோதனைத் தகவல். வயலைப் பார்வையிடவும்.':'உங்கள் வயல் எங்கே உள்ளது?',evidenceIds:hasWeather?['synthetic-weather']:[],missingFacts:[],uncertainty:['Synthetic fixture'],tasks:hasWeather?[{title:'வயலைப் பார்வையிடவும்',reason:'சோதனை வானிலை தகவல்',dueAt:new Date(Date.now()+300).toISOString(),evidenceIds:['synthetic-weather'],uncertainty:['Synthetic fixture']}]:[]});
  },...extra};
}
export async function waitState(app:FarmRuntime, predicate:(state:FarmerState)=>boolean, farmer=owner, timeout=8000) {
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline){const state=await app.state(farmer);if(predicate(state))return state;await delay(15);}
 const state=await app.state(farmer);throw new Error(`State did not settle: ${JSON.stringify({messages:state.messages,reports:app.reports,tasks:state.tasks,notifications:state.notifications})}`);
}
export async function seed(app:FarmRuntime, farmer=owner, profile=profiles[0]!) {
 return app.facts(farmer,{requestId:'synthetic-facts-0001',expectedVersion:0,fieldId:'field-1',cycleId:'cycle-1',facts:profile});
}
