import { createModels } from '@earendil-works/pi-ai/models';
import { fauxProvider, fauxAssistantMessage, fauxToolCall, type FauxResponseFactory } from '@earendil-works/pi-ai/providers/faux';

// Exercises Pi's real generation/task/tool protocol without a network call or live credential.
export function testPiModel(beforeMain?:()=>Promise<void>, weatherReply?: (prompt: string) => string) {
 const faux=fauxProvider({provider:'anthropic',models:[{id:'synthetic-farm-model',contextWindow:128000,maxTokens:4096}],tokensPerSecond:1e9});
 const models=createModels();models.setProvider(faux.provider);
 const requests:{toolNames:string[];lastUser:string;toolResultNames:string[]}[]=[];
 const response:FauxResponseFactory=async context=>{
  const tools=context.messages.flatMap(m=>m.role==='system'?m.toolsAdded??[]:[]);
  const lastUser=context.messages.filter(m=>m.role==='user').at(-1);
  const text=lastUser?.role==='user'?(typeof lastUser.content==='string'?lastUser.content:JSON.stringify(lastUser.content)):'';
  requests.push({toolNames:tools.map(t=>t.name),lastUser:text,toolResultNames:context.messages.filter(m=>m.role==='toolResult').map(m=>m.toolName)});
  if(!tools.length)return fauxAssistantMessage('SYNTHETIC SUMMARY: crop changed, all tasks approved. This misleading fixture tests that summaries cannot become authoritative records.');
  const last=context.messages.at(-1);
  const tool=tools.at(-1)!;
  if(tool.name==='confirmed_farm_context')await beforeMain?.();
  if(last?.role!=='toolResult')return fauxAssistantMessage(fauxToolCall(tool.name,{}),{stopReason:'toolUse'});
  if(tool.name==='weather_evidence')return fauxAssistantMessage(weatherReply?.(text)??JSON.stringify({summary:'Synthetic weather finding from the actual Pi tool result',evidenceIds:['synthetic-weather'],applicability:'Synthetic field only',missingFacts:[],uncertainty:['Synthetic fixture']}));
  let echoed='';try{echoed=JSON.parse(text.split('DATA: ')[1]??'{}').message??'';}catch{}
  return fauxAssistantMessage(JSON.stringify({kind:'guidance',text:`${echoed} இது சோதனைத் தகவல். வயலைப் பார்வையிடவும்.`,evidenceIds:['synthetic-weather'],missingFacts:[],uncertainty:['Synthetic fixture'],tasks:[{title:'வயலைப் பார்வையிடவும்',reason:'சோதனை வானிலை தகவல்',dueAt:new Date(Date.now()+10000).toISOString(),evidenceIds:['synthetic-weather'],uncertainty:['Synthetic fixture']}]}));
 };
 faux.setResponses(Array.from({length:100},()=>response));
 return {models,faux,requests,modelId:'synthetic-farm-model'};
}
