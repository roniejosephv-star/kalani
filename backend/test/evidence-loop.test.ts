import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import { defineTask } from '@earendil-works/pi-durable';
import { FarmDoc } from '../src/domain.js';
import { openFarmRuntime, type FarmRuntime, type RuntimeOptions } from '../src/runtime.js';
import type { FarmLocale, ReviewedRecord, SourceResult } from '../src/adapters.js';
import { fixtures, owner, seed, waitState } from './support/fixtures.js';

const temporary = () => mkdtemp('/private/tmp/kalani-evidence-loop-');
const route = (routes: string[]): NonNullable<RuntimeOptions['route']> => async () => JSON.stringify({ routes });
const weatherEvidence = (location: { latitude: number; longitude: number }, id = 'synthetic-fallback-weather', expires = Date.now() + 3600000): SourceResult => ({
 status: 'available', evidence: [{ id, source: 'SYNTHETIC evidence-loop weather', url: 'https://example.invalid/synthetic-loop-weather', title: 'Synthetic weather fixture', retrievedAt: new Date().toISOString(), validUntil: new Date(expires).toISOString(), status: 'current', scope: location, units: { precipitation: 'mm' }, data: { synthetic: true, precipitation: 2 } }],
});
const unavailable: SourceResult = { status: 'unavailable', evidence: [], reason: 'SYNTHETIC transient provider outage' };
const answerText = (locale: FarmLocale) => locale === 'ta-IN' ? 'இது சோதனை வானிலைத் தகவல்.' : 'This is synthetic weather information.';
const reasoner: NonNullable<RuntimeOptions['testReasoner']> = async (role, packet) => {
 const data = JSON.parse(packet);
 if (role !== 'main') return JSON.stringify({ summary: 'Synthetic scoped finding', evidenceIds: (data.evidence ?? []).map((e: { id: string }) => e.id), applicability: 'Synthetic field only', missingFacts: [], uncertainty: ['Synthetic fixture'] });
 const evidence = Object.values(data.sources ?? {}).flatMap(source => (source as { evidence?: { id: string }[] }).evidence ?? []);
 return JSON.stringify({ kind: evidence.length ? 'guidance' : 'clarification', text: answerText(data.locale), evidenceIds: evidence.map(e => e.id), missingFacts: [], uncertainty: ['Synthetic fixture'], tasks: [] });
};
async function withApp(run: (app: FarmRuntime, directory: string) => Promise<void>, extra: Partial<RuntimeOptions> = {}) {
 const directory = await temporary();
 const app = await openFarmRuntime(fixtures(directory, { route: route(['weather']), testReasoner: reasoner, ...extra }));
 try { await run(app, directory); } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
}
const ready = (app: FarmRuntime, id: string) => waitState(app, s => s.messages.some(m => m.id === `reply-${id}` && m.audioStatus === 'ready'));

for (const locale of ['en-IN', 'ta-IN'] as const) test(`one approved weather fallback produces a scoped ${locale} response`, async () => {
 let primary = 0, fallback = 0;
 await withApp(async app => {
  await seed(app);
  await app.preferences(owner, { requestId: `loop-language-${locale}`, locale });
  const before = await app.state(owner);
  const id = await app.submit(owner, { requestId: `fallback-${locale}-0001`, text: locale === 'ta-IN' ? 'இந்த வார வானிலை என்ன?' : 'What is the weather this week?' });
  const state = await ready(app, id);
  const reply = state.messages.find(m => m.id === `reply-${id}`)!;
  assert.equal(primary, 1); assert.equal(fallback, 1);
  assert.equal(reply.locale, locale); assert.equal(reply.text, answerText(locale));
  assert.deepEqual(reply.evidenceIds, ['synthetic-fallback-weather']);
  assert.deepEqual(state.facts, before.facts); assert.deepEqual(state.decisions, []); assert.deepEqual(state.tasks, []);
  assert.ok(state.traces.some(trace => trace.role === 'weather' && trace.evidenceIds.includes('synthetic-fallback-weather')));
 }, { weather: async () => { primary++; return unavailable; }, weatherFallback: async location => { fallback++; return weatherEvidence(location); } });
});

test('an unavailable primary and fallback exhaust one follow-up without inventing tasks or evidence', async () => {
 let primary = 0, fallback = 0;
 const phases: string[] = [];
 await withApp(async app => {
  await seed(app);
  const id = await app.submit(owner, { requestId: 'weather-exhausted-001', text: 'What is the weather?' });
  const state = await ready(app, id);
  assert.equal(primary, 1); assert.equal(fallback, 1);
  assert.equal(phases.filter(p => p === 'followup').length, 1);
  assert.deepEqual(state.messages.find(m => m.id === `reply-${id}`)!.evidenceIds, []);
  assert.equal(state.tasks.length, 0); assert.equal(state.evidence.length, 0);
  assert.ok(!state.messages.some(m => m.status === 'failed'));
 }, { weather: async () => { primary++; return unavailable; }, weatherFallback: async () => { fallback++; return unavailable; }, checkpoint: async phase => { phases.push(phase); } });
});

test('a transient source is retried only once when no fallback is configured', async () => {
 let calls = 0;
 await withApp(async app => {
  await seed(app);
  const id = await app.submit(owner, { requestId: 'primary-retry-once-001', text: 'What is the weather?' });
  const state = await ready(app, id);
  assert.equal(calls, 2); assert.deepEqual(state.messages.find(m => m.id === `reply-${id}`)!.evidenceIds, ['synthetic-primary-retry']);
 }, { weather: async location => ++calls === 1 ? unavailable : weatherEvidence(location, 'synthetic-primary-retry') });
});

test('the persisted 120-second budget stops a follow-up before another source call', async () => {
 let clock = Date.now(), primary = 0, fallback = 0;
 await withApp(async app => {
  await seed(app);
  const id = await app.submit(owner, { requestId: 'weather-deadline-001', text: 'What is the weather?' });
  const state = await ready(app, id);
  const message = state.messages.find(m => m.id === id)!;
  await app.harness.waitForTask(message.workflowId! as Parameters<typeof app.harness.waitForTask>[0], ctx);
  assert.equal(primary, 1); assert.equal(fallback, 0); assert.equal(state.tasks.length, 0);
  assert.deepEqual(state.messages.find(m => m.id === `reply-${id}`)!.evidenceIds, []);
  assert.ok(JSON.stringify(state.traces).includes('budget_exhausted'));
 }, { now: () => clock, budgetMs: 120000, weather: async () => { primary++; return unavailable; }, weatherFallback: async location => { fallback++; return weatherEvidence(location); }, checkpoint: async phase => { if (phase === 'followup') clock += 120001; } });
});

for (const invalid of ['wrong location', 'expired'] as const) test(`${invalid} fallback evidence cannot support a published plan`, async () => {
 let fallback = 0;
 await withApp(async app => {
  await seed(app);
  const id = await app.submit(owner, { requestId: `invalid-fallback-${invalid.replaceAll(' ', '-')}`, text: 'What is the weather?' });
  const state = await ready(app, id);
  assert.equal(fallback, 1); assert.deepEqual(state.messages.find(m => m.id === `reply-${id}`)!.evidenceIds, []);
  assert.equal(state.evidence.some(e => e.id === 'synthetic-invalid-weather'), false); assert.equal(state.tasks.length, 0);
 }, { weather: async () => unavailable, weatherFallback: async location => { fallback++; return weatherEvidence(invalid === 'wrong location' ? { latitude: 0, longitude: 0 } : location, 'synthetic-invalid-weather', invalid === 'expired' ? Date.now() - 1 : Date.now() + 3600000); } });
});

function districtCatalogue(kind: 'crop' | 'opportunity' = 'crop'): ReviewedRecord[] {
 const at = new Date(Date.now() - 1000).toISOString(), until = new Date(Date.now() + 3600000).toISOString();
 return [{ kind, reviewStatus: 'reviewed', reviewer: 'SYNTHETIC reviewer', reviewedAt: at, validFrom: at, validUntil: until, evidence: { id: `synthetic-district-${kind}`, source: 'SYNTHETIC district guidance', title: 'Synthetic scoped guidance', url: 'https://agritech.tnau.ac.in/synthetic-test-only', retrievedAt: at, validUntil: until, status: 'current', scope: { crop: 'நெல்', district: 'Synthetic district' }, units: {}, passage: 'SYNTHETIC test guidance only.', data: { synthetic: true } } }];
}
for (const role of ['crop', 'opportunities'] as const) for (const configured of [true, false]) test(`${role} evidence distinguishes ${configured ? 'a missing district' : 'an unconfigured catalogue'}`, async () => {
 let weatherCalls = 0, mainCalls = 0;
 await withApp(async app => {
  await seed(app);
  const id = await app.submit(owner, { requestId: `${role}-source-${configured ? 'district' : 'unconfigured'}`, text: role === 'crop' ? 'Tell me about my crop.' : 'Which government support may be relevant?' });
  const state = await ready(app, id);
  const source = state.traces.filter(t => t.role === role).map(t => JSON.parse(t.summary)).find(t => t.stage === 'collect');
  assert.equal(source.outcome, configured ? 'missing_farm_fact' : 'not_configured');
  if (configured) assert.ok(source.missingFacts.includes('district'));
  assert.equal(mainCalls, 0);
  assert.equal(weatherCalls, 0); assert.equal(state.tasks.length, 0); assert.equal(state.evidence.length, 0);
 }, { route: route([role]), catalogue: configured ? districtCatalogue(role === 'crop' ? 'crop' : 'opportunity') : [], weather: async location => { weatherCalls++; return weatherEvidence(location); }, testReasoner: async (role, packet) => { if (role === 'main') mainCalls++; return reasoner(role, packet); } });
});

for (const existing of [false, true]) test(`calendar routing reads ${existing ? 'the existing' : 'an empty'} agenda without fetching weather or creating a new activity`, async () => {
 const packets: Record<string, any>[] = []; let weatherCalls = 0;
 const at = Date.parse('2026-11-19T20:00:00Z');
 await withApp(async app => {
  await seed(app);
  const cid = await app.ensureFarmer(owner);
  if (existing) await app.harness.commit(async tx => {
   const state = await tx.doc(FarmDoc, cid);
   state.tasks.push({ id: 'synthetic-existing-task', version: 1, contextVersion: state.version, fieldId: state.fieldId, cycleId: state.cycleId, title: 'SYNTHETIC existing inspection', reason: 'SYNTHETIC farmer agenda', dueAt: new Date(at + 60000).toISOString(), validUntil: new Date(at + 3600000).toISOString(), status: 'approved', evidenceIds: [], uncertainty: [] });
  }, ctx);
  const id = await app.submit(owner, { requestId: 'calendar-existing-agenda', text: 'What is on my calendar?' });
  const state = await ready(app, id);
  assert.equal(weatherCalls, 0); assert.equal(packets.at(-1)!.sources.calendar.status, 'supported');
  const calendar = packets.at(-1)!.sources.calendar.evidence[0].data;
  assert.equal(calendar.fromLocalDate, '2026-11-20');
  assert.equal(calendar.throughLocalDate, '2026-11-26');
  if (existing) assert.ok(JSON.stringify(packets.at(-1)).includes('SYNTHETIC existing inspection'));
  else assert.ok(JSON.stringify(packets.at(-1)).includes('"entries":[]'));
  assert.equal(state.tasks.length, existing ? 1 : 0); assert.equal(state.decisions.length, 0);
 }, { now: () => at, route: route(['calendar']), weather: async location => { weatherCalls++; return weatherEvidence(location); }, testReasoner: async (role, packet) => { if (role === 'main') packets.push(JSON.parse(packet)); return reasoner(role, packet); } });
});

for (const scenario of ['unknown units', 'out of interval', 'no match'] as const) test(`market ${scenario} keeps its evidence limits without creating farming tasks`, async () => {
 const packets: Record<string, any>[] = []; let calls = 0;
 const toDate = new Date().toISOString().slice(0, 10), fromDate = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
 const mapping = { commodityId: 1, stateId: 2, districtIds: [3], marketIds: [4], fromDate, toDate };
 const observedAt = scenario === 'out of interval' ? '2000-01-01' : toDate;
 await withApp(async app => {
  await seed(app);
  await app.facts(owner, { requestId: `market-context-${scenario.replaceAll(' ', '-')}`, expectedVersion: 1, fieldId: 'field-1', cycleId: 'cycle-1', facts: { state: 'Synthetic state', district: 'Synthetic district', latitude: 10.79, longitude: 79.14 } });
  const id = await app.submit(owner, { requestId: `market-loop-${scenario.replaceAll(' ', '-')}`, text: 'Show the dated market observation.' });
  const state = await ready(app, id);
  assert.equal(calls, 1); assert.equal(state.tasks.length, 0);
  if (scenario === 'unknown units') {
   const source = packets.at(-1)!.sources.market;
   assert.equal(source.status, 'supported'); assert.equal(source.evidence[0].status, 'historical');
   assert.equal(source.evidence[0].observedAt, toDate); assert.equal(source.evidence[0].data.comparable, false);
   assert.deepEqual(state.messages.find(m => m.id === `reply-${id}`)!.evidenceIds, ['synthetic-market-limits']);
  } else {
   const source = state.traces.filter(t => t.role === 'market').map(t => JSON.parse(t.summary)).find(t => t.stage === 'collect');
   assert.equal(source.outcome, 'no_match'); assert.equal(packets.length, 0);
   assert.equal(state.evidence.length, 0); assert.deepEqual(state.messages.find(m => m.id === `reply-${id}`)!.evidenceIds, []);
  }
 }, { route: route(['market']), marketMappings: { 'Synthetic state/Synthetic district/நெல்': mapping }, testReasoner: async (role, packet) => { if (role === 'main') packets.push(JSON.parse(packet)); return reasoner(role, packet); }, market: async () => {
  calls++;
  if (scenario === 'no match') return { status: 'no_applicable_data', evidence: [], reason: 'SYNTHETIC no observation in the requested markets' };
  return { status: 'available', evidence: [{ id: 'synthetic-market-limits', source: 'SYNTHETIC CEDA observation', title: 'Synthetic dated observation', url: 'https://api.ceda.ashoka.edu.in/synthetic-test-only', retrievedAt: new Date().toISOString(), observedAt, status: 'historical', scope: { commodityId: 1, stateId: 2, districtId: 3, marketId: 4 }, units: { price: 'unknown—verify source units before comparing' }, data: { synthetic: true, date: observedAt, comparable: false, isOffer: false, isForecast: false, modal_price: 100 } }] };
 } });
});

test('a farm correction at the persisted follow-up boundary prevents stale fallback publication', async () => {
 let reached!: () => void, release!: () => void, fallback = 0;
 const entered = new Promise<void>(resolve => { reached = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
 await withApp(async app => {
  await seed(app);
  const id = await app.submit(owner, { requestId: 'correct-at-followup-001', text: 'What is the weather?' });
  await entered;
  try { await app.facts(owner, { requestId: 'correct-followup-crop', expectedVersion: 1, fieldId: 'field-1', cycleId: 'cycle-1', facts: { crop: 'பருத்தி' } }); } finally { release(); }
  const message = (await app.state(owner)).messages.find(m => m.id === id)!;
  await app.harness.waitForTask(message.workflowId! as Parameters<typeof app.harness.waitForTask>[0], ctx);
  const state = await app.state(owner);
  assert.equal(fallback, 0); assert.equal(state.messages.find(m => m.id === id)!.status, 'superseded');
  assert.equal(state.messages.some(m => m.id === `reply-${id}`), false); assert.equal(state.tasks.length, 0);
 }, { weather: async () => unavailable, weatherFallback: async location => { fallback++; return weatherEvidence(location); }, checkpoint: async phase => { if (phase === 'followup') { reached(); await gate; } } });
});

test('a follow-up checkpoint resumes after SIGKILL without repeating the failed primary fetch', { timeout: 20000 }, async () => {
 const directory = await temporary(); let app: FarmRuntime | undefined;
 const runtimeUrl = new URL('../src/runtime.ts', import.meta.url).href, fixtureUrl = new URL('./support/fixtures.ts', import.meta.url).href;
 const worker = `
  import {appendFile} from 'node:fs/promises';
  import {openFarmRuntime} from ${JSON.stringify(runtimeUrl)};
  import {fixtures,owner,seed} from ${JSON.stringify(fixtureUrl)};
  const directory=process.argv[1];
  const app=await openFarmRuntime(fixtures(directory,{
   route:async()=>JSON.stringify({routes:['weather']}),
   weather:async()=>{await appendFile(directory+'/calls.log',${JSON.stringify('primary\n')});return {status:'unavailable',evidence:[],reason:'SYNTHETIC outage'};},
   weatherFallback:async()=>({status:'unavailable',evidence:[],reason:'SYNTHETIC fallback'}),
   checkpoint:async phase=>{if(phase==='followup'){process.stdout.write(${JSON.stringify('FOLLOWUP_READY\n')});await new Promise(()=>{});}}
  }));
  await seed(app);await app.submit(owner,{requestId:'recover-evidence-loop',text:'What is the weather?'});
  setInterval(()=>{},1000);
 `;
 const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', worker, directory], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: ['ignore', 'pipe', 'pipe'] });
 let stdout = '', stderr = '';
 child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
 try {
  const deadline = Date.now() + 10000;
  while (!stdout.includes('FOLLOWUP_READY')) {
   if (child.exitCode !== null) throw new Error(`Recovery worker exited: ${stdout} ${stderr}`);
   if (Date.now() > deadline) throw new Error(`Recovery worker timed out: ${stdout} ${stderr}`);
   await delay(15);
  }
  child.kill('SIGKILL'); await once(child, 'exit');
  app = await openFarmRuntime(fixtures(directory, { route: route(['weather']), testReasoner: reasoner, weather: async () => { throw new Error('Primary must not be repeated after persisted follow-up'); }, weatherFallback: async location => weatherEvidence(location) }));
  const state = await waitState(app, s => s.messages.some(m => m.role === 'assistant' && m.audioStatus === 'ready'));
  assert.equal((await readFile(join(directory, 'calls.log'), 'utf8')).trim(), 'primary');
  assert.equal(state.messages.filter(m => m.role === 'assistant').length, 1);
  assert.deepEqual(state.messages.find(m => m.role === 'assistant')!.evidenceIds, ['synthetic-fallback-weather']);
 } finally {
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child, 'exit'); }
  await app?.close(); await rm(directory, { recursive: true, force: true });
 }
});

test('a legacy v1 collect checkpoint migrates and completes without losing its farmer message', async () => {
 const directory = await temporary(); let app = await openFarmRuntime(fixtures(directory, { resume: false, route: route(['weather']), testReasoner: reasoner }));
 try {
  await seed(app); const cid = await app.ensureFarmer(owner);
  const Legacy = defineTask<{ messageId: string; version: number }, { phase: 'collect' }, null>({ name: 'farm.pipeline.v1', version: 1, initial: () => ({ phase: 'collect' }), phases: { collect: async () => { throw new Error('Legacy code must never execute'); } }, abort: async (_task, runtime) => { await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }), ctx); } });
  await app.harness.commit(async tx => {
   const state = await tx.doc(FarmDoc, cid); const messageId = 'synthetic-legacy-message';
   const workflowId = await tx.createTask(Legacy, { messageId, version: state.version }, { ownership: { kind: 'conversation' }, conversationId: cid });
   state.messages.push({ id: messageId, role: 'farmer', text: 'What is the weather?', locale: 'en-IN', status: 'processing', contextVersion: state.version, createdAt: new Date().toISOString(), workflowId });
  }, ctx);
  await app.close(); app = await openFarmRuntime(fixtures(directory, { route: route(['weather']), testReasoner: reasoner }));
  const state = await ready(app, 'synthetic-legacy-message');
  assert.equal(state.messages.filter(m => m.id === 'synthetic-legacy-message').length, 1);
  assert.equal(state.messages.filter(m => m.id === 'reply-synthetic-legacy-message').length, 1);
  assert.deepEqual(state.decisions, []); assert.equal(app.reports.some(report => report.kind === 'migration_failed'), false);
 } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
