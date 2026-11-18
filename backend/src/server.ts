import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openFarmRuntime, type FarmRuntime } from './runtime.js';
import { AppError, publicState } from './domain.js';
import type { ReviewedRecord, MarketQuery } from './adapters.js';

type Access = { tokenHash: string; owner: string }[];
async function body(request: IncomingMessage, limit = 65536) {
 const chunks: Buffer[] = []; let length=0;
 for await (const value of request) {const chunk=Buffer.from(value);length+=chunk.length;if(length>limit)throw new AppError('body_too_large','Request too large.',413);chunks.push(chunk);}
 return Buffer.concat(chunks);
}
async function jsonBody(request:IncomingMessage):Promise<Record<string,unknown>>{
 if(!request.headers['content-type']?.startsWith('application/json'))throw new AppError('content_type','Use application/json.',415);
 try{const value=JSON.parse((await body(request)).toString());if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}catch(error){if(error instanceof AppError)throw error;throw new AppError('invalid_json','Expected a JSON object.');}
}
const reply=(response:ServerResponse,status:number,value:unknown)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(JSON.stringify(value));};
const string=(value:unknown,name:string)=>{if(typeof value!=='string')throw new AppError('invalid_input',`${name} is required.`);return value;};
const number=(value:unknown,name:string)=>{if(typeof value!=='number'||!Number.isSafeInteger(value))throw new AppError('invalid_input',`${name} must be an integer.`);return value;};
export function apiServer(runtime:FarmRuntime,access:Access){
 const authenticate=(request:IncomingMessage)=>{
  const token=request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{32,200})$/)?.[1];
  if(!token)throw new AppError('unauthorized','A farmer session is required.',401);
  const actual=createHash('sha256').update(token).digest();
  const entry=access.find(item=>/^[0-9a-f]{64}$/.test(item.tokenHash)&&timingSafeEqual(actual,Buffer.from(item.tokenHash,'hex')));
  if(!entry)throw new AppError('unauthorized','Session token is not valid.',401);return entry.owner;
 };
 const server=createServer(async(request,response)=>{
  try{
   const url=new URL(request.url??'/','http://localhost');
   if(request.method==='GET'&&url.pathname==='/health'){reply(response,200,{status:'ok',claudeConfigured:runtime.configured,speechConfigured:runtime.speechConfigured});return;}
   const owner=authenticate(request);const path=url.pathname;const method=request.method;
   response.setHeader('Cache-Control','no-store');
   if(method==='GET'&&path==='/v1/state'){reply(response,200,publicState(await runtime.state(owner)));return;}
   if(method==='GET'&&path==='/v1/export'){reply(response,200,{format:'farm-export-v1',exportedAt:new Date().toISOString(),...publicState(await runtime.state(owner))});return;}
   if(method==='GET'&&path==='/v1/events'){
    let cursor=Number(url.searchParams.get('after')??request.headers['last-event-id']??0);
    if(!Number.isSafeInteger(cursor)||cursor<0)throw new AppError('invalid_cursor','Event cursor is invalid.');
    await runtime.state(owner);
    response.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});response.flushHeaders();
    let closed=false,polling=false;
    const send=async()=>{
     if(polling||closed)return;polling=true;
     try{const state=await runtime.state(owner);if(cursor>state.sequence||cursor<(state.events[0]?.sequence??0)-1){cursor=state.sequence;response.write(`id: ${cursor}\nevent: update\ndata: ${JSON.stringify({sequence:cursor,type:'snapshot.required',at:new Date().toISOString()})}\n\n`);}else{for(const e of state.events.filter(e=>e.sequence>cursor)){if(response.writableLength>262144){response.end();return;}response.write(`id: ${e.sequence}\nevent: update\ndata: ${JSON.stringify(e)}\n\n`);cursor=e.sequence;}}}
     catch{response.end();}finally{polling=false;}
    };
    const timer=setInterval(()=>void send(),1000);const keepalive=setInterval(()=>response.write(': keepalive\n\n'),15000);
    response.on('close',()=>{closed=true;clearInterval(timer);clearInterval(keepalive);});await send();return;
   }
   const media=path.match(/^\/v1\/audio\/([A-Za-z0-9_-]+)$/);
   if(method==='GET'&&media){const result=await runtime.getAudio(owner,media[1]);response.writeHead(200,{'Content-Type':result.mime,'Content-Length':result.bytes.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});response.end(result.bytes);return;}
   if(method==='POST'&&path==='/v1/audio'){const requestId=string(request.headers['idempotency-key'],'Idempotency-Key');const mime=string(request.headers['content-type'],'Content-Type').split(';')[0];reply(response,201,{audioId:await runtime.upload(owner,requestId,await body(request,10*1024*1024),mime)});return;}
   if(method==='POST'&&path==='/v1/messages'){
    const b=await jsonBody(request);const input={requestId:string(b.requestId,'requestId'),...(b.text!==undefined?{text:string(b.text,'text')}:{}),...(b.audioId!==undefined?{audioId:string(b.audioId,'audioId')}:{}),...(b.fieldId!==undefined?{fieldId:string(b.fieldId,'fieldId')}:{}),...(b.cycleId!==undefined?{cycleId:string(b.cycleId,'cycleId')}:{})};
    reply(response,202,{messageId:await runtime.submit(owner,input)});return;
   }
   if(method==='POST'&&path==='/v1/facts'){const b=await jsonBody(request);reply(response,200,await runtime.facts(owner,{requestId:string(b.requestId,'requestId'),expectedVersion:number(b.expectedVersion,'expectedVersion'),facts:b.facts as never,fieldId:string(b.fieldId,'fieldId'),cycleId:string(b.cycleId,'cycleId')}));return;}
   const decision=path.match(/^\/v1\/tasks\/([A-Za-z0-9_-]+)\/decisions$/);
   if(method==='POST'&&decision){const b=await jsonBody(request);reply(response,200,await runtime.decision(owner,decision[1],{requestId:string(b.requestId,'requestId'),version:number(b.version,'version'),decision:string(b.decision,'decision') as never}));return;}
   if(method==='PATCH'&&path==='/v1/preferences'){const b=await jsonBody(request);reply(response,200,await runtime.preferences(owner,{requestId:string(b.requestId,'requestId'),...(b.locale!==undefined?{locale:string(b.locale,'locale')}:{}),...(b.notifications!==undefined?{notifications:b.notifications as boolean}:{}),...(b.quietStart!==undefined?{quietStart:number(b.quietStart,'quietStart')}:{}),...(b.quietEnd!==undefined?{quietEnd:number(b.quietEnd,'quietEnd')}:{})}));return;}
   const retryMessage=path.match(/^\/v1\/messages\/([A-Za-z0-9_-]+)\/retry$/);
   if(method==='POST'&&retryMessage){const b=await jsonBody(request);reply(response,202,{messageId:await runtime.retryMessage(owner,retryMessage[1],string(b.requestId,'requestId'))});return;}
   const retry=path.match(/^\/v1\/messages\/([A-Za-z0-9_-]+)\/retry-audio$/);
   if(method==='POST'&&retry){const b=await jsonBody(request);reply(response,202,{messageId:await runtime.retryAudio(owner,retry[1],string(b.requestId,'requestId'))});return;}
   if(method==='DELETE'&&path==='/v1/account'){const b=await jsonBody(request);if(b.confirmation!=='DELETE')throw new AppError('confirmation_required','Explicit deletion confirmation is required.');await runtime.remove(owner,string(b.requestId,'requestId'));reply(response,200,{status:'deleted',retention:'Transcript history and backups require operator purge; see retention policy.'});return;}
   throw new AppError('not_found','Endpoint not found.',404);
  }catch(error){if(response.headersSent){response.end();return;}reply(response,error instanceof AppError?error.status:500,{error:{code:error instanceof AppError?error.code:'internal_error',message:error instanceof AppError?error.message:'Request could not be completed.'}});}
 });
 server.requestTimeout=30000;server.headersTimeout=10000;server.maxRequestsPerSocket=200;
 return server;
}
async function readConfig<T>(file:string|undefined,fallback:T):Promise<T>{if(!file)return fallback;return JSON.parse(await readFile(file,'utf8'));}
export async function main(){
 const directory=resolve(process.env.FARM_DATA_DIR??'.runtime');await mkdir(directory,{recursive:true,mode:0o700});
 const access=await readConfig<Access>(process.env.FARM_ACCESS_FILE??`${directory}/access.json`,[]).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;});
 if(!Array.isArray(access)||access.some(x=>typeof x.owner!=='string'||!/^[0-9a-f]{64}$/.test(x.tokenHash)))throw new Error('Invalid access configuration.');
 const runtime=await openFarmRuntime({directory,catalogue:await readConfig<ReviewedRecord[]>(process.env.FARM_CATALOGUE_FILE,[]),marketMappings:await readConfig<Record<string,MarketQuery>>(process.env.FARM_MARKET_MAPPINGS_FILE,{})});
 const server=apiServer(runtime,access);const port=Number(process.env.PORT??8787);
 server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({service:'tamil-farm',port,sqliteSynchronous:runtime.synchronous,claudeConfigured:runtime.configured,speechConfigured:runtime.speechConfigured,farmerSessions:access.length})));
 let closing=false;const close=async()=>{if(closing)return;closing=true;server.close();server.closeAllConnections();await runtime.close();};
 process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
