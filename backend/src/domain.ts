import { createHash, randomUUID } from 'node:crypto';
import { defineDoc, type JsonObject } from '@earendil-works/pi-durable';
import { DEFAULT_LOCALE, SPEECH_TEXT_LIMIT, type Evidence, type FarmLocale } from './adapters.js';
import type { CalendarEntry } from './calendar.js';
import { activeLanguage, enabledLanguages, hasLocaleScript } from './languages.js';

export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export type FactValue = string | number;
export type Message = { id: string; role: 'farmer' | 'assistant'; text: string; locale?: FarmLocale; languageRevision?:number; calendarEntryId?:string; audioId?: string; status: 'queued' | 'processing' | 'ready' | 'failed' | 'superseded'; audioStatus?: 'pending' | 'ready' | 'failed' | 'unconfigured'; createdAt: string; contextVersion: number; error?: string; evidenceIds?: string[]; workflowId?: number; attempt?: number; trigger?: 'farmer' | 'scheduled'; proposedFacts?: Record<string, FactValue> };
export type FarmTask = { id: string; version: number; contextVersion: number; fieldId: string; cycleId: string; title: string; reason: string; dueAt: string; validUntil: string; status: 'proposed' | 'approved' | 'postponed' | 'completed' | 'rejected' | 'superseded'; evidenceIds: string[]; uncertainty: string[]; waitTaskId?: number };
export type Decision = { id: string; taskId: string; version: number; decision: 'approved' | 'postponed' | 'completed' | 'rejected'; actor: string; at: string; consumed: boolean };
export type AppEvent = { sequence: number; type: string; at: string; reference?: string };
export type Notification = { id: string; title: string; dueAt: string; expiresAt: string; taskId: string; version: number; contextVersion: number; status: 'pending' | 'dispatching' | 'accepted' | 'uncertain' | 'cancelled' | 'expired'; deliveryId: string; mode: 'in-app'; purpose?: 'task' | 'guidance' | 'calendar'; messageId?: string; acceptedAt?: string };
export type Playbook = { origin?: 'farmer_reported'; experienceIds?: string[]; sourceTaskId?: string; id: string; version: number; status: 'candidate' | 'reviewed' | 'withdrawn'; title: string; crop: string; fieldId: string; cycleId: string; prerequisites: Record<string, FactValue>; evidenceIds: string[]; steps: string[]; createdAt: string; validUntil: string; history: { version: number; at: string; note: string }[]; reviewer?: string };
export type Improvement = { id: string; version: number; category: 'vocabulary' | 'routing' | 'retrieval' | 'prompt'; proposal: string; status: 'proposed' | 'evaluated' | 'released' | 'rejected'; baselineVersion: string; evaluatedVersion?: number; evidenceEventIds: number[]; evaluations: { suite: string; passed: boolean; at: string; report: string }[]; reviewer?: string; releasedAt?: string };
export type EvidenceRecord = JsonObject & { id: string; source: string; url: string; retrievedAt: string; validUntil?: string; status: string };
export type FarmerState = {
 owner: string; version: number; fieldId: string; cycleId: string; facts: Record<string, FactValue>;
 contexts: Record<string, { facts: Record<string, FactValue>; version: number; fieldId: string; cycleId: string }>;
 preferences: { locale: FarmLocale; notifications: boolean; quietStart: number; quietEnd: number };
 languageRevision?: number;
 messages: Message[]; tasks: FarmTask[]; evidence: EvidenceRecord[]; decisions: Decision[]; notifications: Notification[]; playbooks: Playbook[];
 calendarEntries?: CalendarEntry[];
 experiences: { id: string; taskId: string; at: string; origin: 'farmer_reported'; text: string; fieldId: string; cycleId: string }[];
 memories: { key: string; value: FactValue; at: string; confirmedBy: string; contextVersion: number }[];
 proposals: Improvement[]; activeRelease: string; releaseHistory?: {id:string;proposalId:string;proposalVersion:number;previousRelease:string;reviewer:string;at:string;action:'release'|'rollback'}[];
 events: AppEvent[]; sequence: number; requests: Record<string, { hash: string; result: string }>;
 media: Record<string, { mime: string; size: number; createdAt: string; digest: string }>;
 traces: { role: string; at: string; messageId: string; evidenceIds: string[]; summary: string; contextVersion: number }[];
 deleted: boolean; scheduleRevision: number;
};
export const emptyFarmer = (): FarmerState => ({ owner: '', version: 0, fieldId: 'field-1', cycleId: 'cycle-1', facts: {}, contexts: {}, preferences: { locale: DEFAULT_LOCALE, notifications: false, quietStart: 20, quietEnd: 7 }, messages: [], tasks: [], evidence: [], decisions: [], notifications: [], playbooks: [], experiences: [], memories: [], proposals: [], activeRelease: 'farm-v1', events: [], sequence: 0, requests: {}, media: {}, traces: [], deleted: false, scheduleRevision: 0 });
export const FarmDoc = defineDoc<FarmerState>({ kind: 'farm.state.v1', version: 1, scope: 'conversation', history: 'latest', fork: 'initial', initial: emptyFarmer, checkpointWhen: () => true });
export const DirectoryDoc = defineDoc<{ farmers: Record<string, number> }>({ kind: 'farm.directory.v1', version: 1, scope: 'session', initial: () => ({ farmers: {} }), checkpointWhen: () => true });
export const MetricsDoc = defineDoc<{ operations: Record<string, { calls:number; failures:number; totalMs:number; recentMs:number[] }> }>({ kind:'farm.metrics.v1',version:1,scope:'session',initial:()=>({operations:{}}),checkpointWhen:()=>true });
export const WeatherCacheDoc = defineDoc<{ snapshots: Record<string, { expiresAt: number; result: string }> }>({ kind: 'farm.public-weather.v1', version: 1, scope: 'session', initial: () => ({ snapshots: {} }), checkpointWhen: () => true });
export const PacketDoc = defineDoc<{ role: string; packet: string }>({ kind: 'farm.packet.v1', version: 1, scope: 'conversation', history: 'latest', fork: 'initial', initial: () => ({ role: '', packet: '' }), checkpointWhen: () => true });
export const iso = (now = Date.now()) => new Date(now).toISOString();
export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export function event(state: FarmerState, type: string, reference?: string, now = Date.now()) {
 state.events.push({ sequence: ++state.sequence, type, at: iso(now), ...(reference ? { reference } : {}) });
 if (state.events.length > 500) state.events.splice(0, state.events.length - 500);
}
export function requireRequest(value: unknown): asserts value is string {
 if (typeof value !== 'string' || ['__proto__','constructor','prototype'].includes(value) || !/^[a-zA-Z0-9_-]{8,128}$/.test(value)) throw new AppError('invalid_request_id', 'A stable request ID is required.');
}
export function duplicate(state: FarmerState, requestId: string, payload: unknown): string | undefined {
 requireRequest(requestId);
 const existing = Object.hasOwn(state.requests, requestId) ? state.requests[requestId] : undefined;
 if (existing && existing.hash !== digest(payload)) throw new AppError('idempotency_conflict', 'Request ID was already used with different content.', 409);
 return existing?.result;
}
export function rememberRequest(state: FarmerState, requestId: string, payload: unknown, result: string) { state.requests[requestId] = { hash: digest(payload), result }; }
export function validateFacts(facts: unknown): asserts facts is Record<string, FactValue> {
 if (!facts || typeof facts !== 'object' || Array.isArray(facts)) throw new AppError('invalid_facts', 'Facts must be an object.');
 const allowed = ['village','crop','district','state','season','latitude','longitude','sowingDate','transplantDate','datePrecision','soil','irrigation','concern'];
 for (const [key,value] of Object.entries(facts)) {
  if (!allowed.includes(key) || (typeof value !== 'string' && typeof value !== 'number')) throw new AppError('invalid_fact', 'Unsupported farm fact.');
  if (key === 'latitude' || key === 'longitude') {
   if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > (key === 'latitude' ? 90 : 180)) throw new AppError('invalid_coordinates', 'Coordinates are invalid.');
  } else if (typeof value !== 'string' || value.length > 400) throw new AppError('invalid_fact', 'Farm fact is too long.');
 }
}
export function correctFacts(state: FarmerState, input: { expectedVersion: number; facts: Record<string, FactValue>; fieldId: string; cycleId: string }, now = Date.now()) {
 if (input.expectedVersion !== state.version) throw new AppError('stale_version', 'Farm details changed. Review the latest details.', 409);
 validateFacts(input.facts);
 if (![input.fieldId,input.cycleId].every(v => /^[a-zA-Z0-9_-]{1,80}$/.test(v))) throw new AppError('invalid_context', 'Field and crop cycle are required.');
 state.contexts[`${state.fieldId}/${state.cycleId}`] = { facts: { ...state.facts }, version: state.version, fieldId: state.fieldId, cycleId: state.cycleId };
 const same = input.fieldId === state.fieldId && input.cycleId === state.cycleId;
 const prior = same ? state.facts : state.contexts[`${input.fieldId}/${input.cycleId}`]?.facts ?? {};
 state.facts = { ...prior, ...input.facts };
 if (['village','district','state'].some(key => input.facts[key] !== undefined && input.facts[key] !== prior[key]) && !(typeof input.facts.latitude === 'number' && typeof input.facts.longitude === 'number')) { delete state.facts.latitude; delete state.facts.longitude; }
 if(input.facts.crop !== undefined && input.facts.crop !== prior.crop) for(const key of ['sowingDate','transplantDate','datePrecision']) if(input.facts[key] === undefined) delete state.facts[key];
 state.fieldId = input.fieldId; state.cycleId = input.cycleId; state.version++;
 for (const [key,value] of Object.entries(input.facts)) state.memories.push({ key, value, at: iso(now), confirmedBy: state.owner, contextVersion: state.version });
 for (const entry of state.calendarEntries ?? []) if (entry.status === 'draft') { entry.status = 'cancelled'; entry.version++; }
 for (const task of state.tasks) if (!['completed','rejected','superseded'].includes(task.status)) task.status = 'superseded';
 for (const message of state.messages) if (['queued','processing'].includes(message.status) || message.role === 'assistant') message.status = 'superseded';
 for (const notification of state.notifications) if (notification.purpose !== 'calendar' && ['pending','dispatching'].includes(notification.status)) notification.status = notification.status === 'dispatching' ? 'uncertain' : 'cancelled';
 event(state, 'facts.corrected', undefined, now);
}
export function taskApplicable(state: FarmerState, task: FarmTask, now = Date.now()) {
 return task.contextVersion === state.version && task.fieldId === state.fieldId && task.cycleId === state.cycleId && Date.parse(task.validUntil) > now && task.evidenceIds.length > 0 && task.evidenceIds.every(id => state.evidence.some(e => e.id === id && e.status === 'current' && !!e.validUntil && Date.parse(e.validUntil) > now));
}
export function decide(state: FarmerState, id: string, version: number, decision: Decision['decision'], now = Date.now()) {
 const task = state.tasks.find(t => t.id === id);
 if (!task) throw new AppError('not_found', 'Task was not found.', 404);
 if (version !== task.version || task.status === 'superseded' || task.contextVersion !== state.version) throw new AppError('stale_version', 'This task changed. Review the current plan.', 409);
 if (!['approved','postponed','completed','rejected'].includes(decision)) throw new AppError('invalid_decision', 'Unsupported decision.');
 if (['completed','rejected'].includes(task.status) || (task.status === 'postponed' && decision !== 'completed')) throw new AppError('closed_task', 'This task has already been closed.', 409);
 if (decision === 'approved' && !taskApplicable(state, task, now)) throw new AppError('expired_evidence', 'Conditions or evidence expired. Request fresh guidance.', 409);
 const record: Decision = { id: randomUUID(), taskId: id, version, decision, actor: state.owner, at: iso(now), consumed: false };
 state.decisions.push(record); task.status = decision;
 if (decision === 'completed') state.experiences.push({ id: randomUUID(), taskId: id, at: iso(now), origin: 'farmer_reported', text: task.title, fieldId: task.fieldId, cycleId: task.cycleId });
 if (decision !== 'approved') for (const n of state.notifications.filter(n => n.taskId === id && n.status === 'pending')) n.status = 'cancelled';
 event(state, `task.${decision}`, id, now); return record;
}
export type PlanOutput = { proposedFacts?: Record<string, FactValue>; kind: 'guidance' | 'clarification' | 'refusal'; text: string; evidenceIds: string[]; missingFacts: string[]; uncertainty: string[]; tasks: { title: string; reason: string; dueAt: string; evidenceIds: string[]; uncertainty: string[] }[] };
const strings = (value: unknown, max = 20): value is string[] => Array.isArray(value) && value.length <= max && value.every(v => typeof v === 'string' && v.length <= 1200);
const object = (value: unknown): value is Record<string,unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
type OutputCode = 'invalid_specialist_output' | 'invalid_model_output';
export class ModelOutputError extends AppError {
 constructor(code: OutputCode, readonly reason: 'json' | 'shape' | 'evidence') {
  super(code, 'The model response could not be verified.', 502);
 }
}
function outputObject(raw: string, code: OutputCode): Record<string,unknown> {
 const text=raw.trim();
 const fenced=text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
 let value:unknown;
 try { value=JSON.parse(fenced?.[1]??text); } catch { throw new ModelOutputError(code,'json'); }
 if(!object(value))throw new ModelOutputError(code,'shape');
 return value;
}
export type SpecialistFinding = { summary:string;evidenceIds:string[];applicability:string;missingFacts:string[];uncertainty:string[] };
export function parseSpecialist(raw:string, evidence:readonly Evidence[]):SpecialistFinding {
 const code='invalid_specialist_output';
 const p=outputObject(raw,code);
 if(!strings(p.evidenceIds))throw new ModelOutputError(code,'shape');
 if(p.evidenceIds.some(id=>!evidence.some(e=>e.id===id)))throw new ModelOutputError(code,'evidence');
 if(typeof p.summary!=='string'||!p.summary.trim()||typeof p.applicability!=='string'||!strings(p.missingFacts)||!strings(p.uncertainty))throw new ModelOutputError(code,'shape');
 return {summary:p.summary,evidenceIds:p.evidenceIds,applicability:p.applicability,missingFacts:p.missingFacts,uncertainty:p.uncertainty};
}
export function decodePlan(raw:string,locale:FarmLocale=DEFAULT_LOCALE):PlanOutput {
 const code='invalid_model_output';
 const p=outputObject(raw,code);
 if((p.kind!=='guidance'&&p.kind!=='clarification'&&p.kind!=='refusal')||typeof p.text!=='string'||[...p.text].length>SPEECH_TEXT_LIMIT||!hasLocaleScript(p.text,locale)||!strings(p.evidenceIds)||!strings(p.missingFacts)||!strings(p.uncertainty)||!Array.isArray(p.tasks)||p.tasks.length>7||(p.proposedFacts!==undefined&&!object(p.proposedFacts)))throw new ModelOutputError(code,'shape');
 if(p.tasks.some(t=>!object(t)||typeof t.title!=='string'||!hasLocaleScript(t.title,locale)||typeof t.reason!=='string'||typeof t.dueAt!=='string'||!strings(t.evidenceIds)||!strings(t.uncertainty)))throw new ModelOutputError(code,'shape');
 return p as PlanOutput;
}
export function parsePlan(raw: string, evidence: readonly EvidenceRecord[], now = Date.now(),locale:FarmLocale=DEFAULT_LOCALE): PlanOutput {
 const p=decodePlan(raw,locale);
 if (p.proposedFacts) validateFacts(p.proposedFacts);
 const chemical = /\b(?:dos(?:e[sd]?|ages?|ing)|(?:pesti|fungi|herbi)cides?|fertili[sz]\w*|spray\w*)\b|உரம்|உரத்தை|உரத்தின்|மருந்து|மருந்தை|தெளி(?!வ)|பூச்சிக்கொல்லி|ரசாயன/i;
 const amount = /(?:[0-9௦-௯]|\b(?:half|one|two|three|four|five|six|seven|eight|nine|ten)(?:\s+an?)?)\s*-?\s*(?:%|(?:ml|mg|kg|g|l|millilit(?:er|re)s?|lit(?:er|re)s?|(?:kilo|milli)?grams?|(?:table|tea)?spoons?)\b|லிட்டர்|மில்லி|கிலோ|கிராம்|ஸ்பூன்)/i;
 const directive = /(?:^|[.!?;:\n]|,\s*then)\s*(?:please\s+)?(?:apply|add|administer|mix|pour|use|give|spray)\b|\byou\s+(?:should|must|can)\s+(?:apply|add|administer|mix|pour|use|give|spray)\b|பயன்படுத்தவும்|இடவும்|கலக்கவும்|தெளிக்கவும்|ஊற்றவும்|போடவும்/i;
 if (chemical.test(p.text) && (p.kind === 'guidance' || amount.test(p.text) || directive.test(p.text))) throw new AppError('expert_review_required', 'Chemical advice cannot be verified in this release.', 502);
 const ids = new Set(evidence.map(e => e.id));
 if (p.evidenceIds.some(id => !ids.has(id)) || (p.kind === 'guidance' && p.evidenceIds.length === 0) || (p.kind !== 'guidance' && p.tasks.length)) throw new AppError('unsupported_claim', 'Guidance has no matching source.', 502);
 for (const t of p.tasks) {
  if (!t.evidenceIds.length || !Number.isFinite(Date.parse(t.dueAt)) || Date.parse(t.dueAt) < now || Date.parse(t.dueAt) > now + 7*86400000 || t.evidenceIds.some(id => !evidence.some(e => e.id === id && e.status === 'current' && e.validUntil && Date.parse(e.validUntil) > Date.parse(t.dueAt)))) throw new AppError('invalid_task', 'A proposed task has expired or unsupported evidence.', 502);
  // v1 never schedules chemical interventions, even when a model supplies a citation.
  if (chemical.test(`${t.title} ${t.reason}`)) throw new AppError('expert_review_required', 'Chemical interventions require reviewed expert guidance.', 502);
 }
 return p;
}
export const storedEvidence = (e: Evidence) => json(e) as unknown as EvidenceRecord;
export function publicState(state: FarmerState) {
 const { owner, requests, media, traces, proposals, contexts, deleted, scheduleRevision, languageRevision, messages, tasks, calendarEntries, ...view } = state;
 return { ...view, calendarEntries: (calendarEntries ?? []).map(({localDate,minuteOfDay,...entry})=>entry), enabledLanguages: enabledLanguages(), preferences: {...view.preferences,locale:activeLanguage(view.preferences.locale)}, messages: messages.filter(m => m.trigger !== 'scheduled').map(({workflowId,trigger,languageRevision,...m})=>m), tasks: tasks.map(({waitTaskId,...t})=>t) };
}
