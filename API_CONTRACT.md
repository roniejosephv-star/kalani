# SwiftUI contract v1

Local base URL http://127.0.0.1:8787; all /v1 routes require Authorization: Bearer <farmer token>. Server token maps to farmer; no client owner IDs. Token manually provisioned for local demo; save in Keychain, never bundle provider keys. JSON ISO timestamps UTC. Errors {error:{code,message}}. 409 stale version; 503 unavailable provider. All mutations take requestId UUID (header Idempotency-Key for binary upload), persisted deduplication. Request body max 64 KiB; audio max 10 MiB.

- GET /health: {status,claudeConfigured,speechConfigured}. No auth secrets.
- GET /v1/state: FarmerState below.
- GET /v1/events?after=0: reconnectable SSE, id=sequence, event=update, data={sequence,type,at,reference?}. Filtered app events only. Client can reload state after event; snapshot on reconnect handles compacted events. Poll fallback GET state acceptable during outage.
- POST /v1/messages: {requestId,text?:string,audioId?:string,fieldId?:string,cycleId?:string}; returns 202 {messageId}. Uses confirmed field context; requestId retained to prevent repeat sends.
- POST /v1/audio: binary audio (audio/mp4 or audio/wav), Idempotency-Key UUID; returns {audioId}. Recording preview/discard before send in client.
- GET /v1/audio/:id: private audio bytes with matching Content-Type.
- POST /v1/facts: {requestId,expectedVersion:number,facts:{village?:string,crop?:string,latitude?:number,longitude?:number,district?:string,sowingDate?:string,soil?:string,irrigation?:string},fieldId:string,cycleId:string}. Explicit farmer confirmation; returns state. Missing/approx dates remain unknown; current initial fieldId=field-1 cycleId=cycle-1. Changing crop starts revised context version; completed history retained. Must read back entered location/crop before confirm, no automatic geolocation assumptions.
- POST /v1/tasks/:id/decisions: {requestId,version:number,decision:"approved"|"postponed"|"completed"|"rejected"}; returns state. Approval and completion are distinct controls.
- PATCH /v1/preferences: {requestId,notifications?:boolean,locale?:"ta-IN"|"en-IN",quietStart?:number,quietEnd?:number}; returns state.
- POST /v1/messages/:id/retry-audio: {requestId}; retry synthesis for an existing text response.
- GET /v1/export: owner JSON export.
- DELETE /v1/account: {requestId,confirmation:"DELETE"}; revokes access and deletes media/current private records (backup retention limitation documented).

FarmerState shape (additional fields allowed):
```
{
 version:number, facts:{[key:string]:string|number}, fieldId:string,cycleId:string,
 preferences:{locale:"ta-IN"|"en-IN",notifications:boolean,quietStart:number,quietEnd:number},
 messages:[{id:string,role:"farmer"|"assistant",text:string,audioId?:string,status:"queued"|"processing"|"ready"|"failed"|"superseded",audioStatus?:"pending"|"ready"|"failed"|"unconfigured",createdAt:string,error?:string,evidenceIds?:string[]}],
 tasks:[{id:string,version:number,title:string,reason:string,status:"proposed"|"approved"|"postponed"|"completed"|"rejected"|"superseded",dueAt:string,evidenceIds:string[],uncertainty:string[],fieldId:string,cycleId:string}],
 evidence:[{id:string,source:string,url:string,retrievedAt:string,observedAt?:string,validUntil?:string,data:unknown,units?:unknown}],
 events:[{sequence:number,type:string,at:string,reference?:string}],
 notifications:[{id:string,status:string,title:string,dueAt:string,taskId?:string}],
 playbooks:[], sequence:number
}
```
No raw model traces in client. Source failures are visible in assistant response or processing status. Never show fixtures as live advice. Today should show latest current assistant guidance with date and audio/reply; separate history, week, farm settings. Onboarding starts with English or Tamil selection and consent for remote audio, crop/village confirmation, concern; latitude/longitude optional manual demo inputs required for real weather until verified village lookup exists. UI design refinement deferred.

A submitted message keeps the language selected when the server accepted it. Both transcription and reply audio use that language even if preferences change while it runs. Message records may expose `locale`; older messages without it default to Tamil.
