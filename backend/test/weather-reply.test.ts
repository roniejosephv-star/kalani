import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Evidence, FarmLocale, SourceResult } from '../src/adapters.js';
import { openFarmRuntime, type FarmRuntime, type RuntimeOptions } from '../src/runtime.js';
import { fixtures, owner, seed, waitState } from './support/fixtures.js';

const now = Date.parse('2026-11-20T06:00:00Z');
const days = ['20', '21', '22', '23', '24', '25', '26'].map(day => `2026-11-${day}`);
const probabilities = [5, 5, 70, 10, 8, 5, 3];
const evidenceId = 'synthetic-open-meteo-week';
const questions = {
 'en-IN': 'Will it rain this week?',
 'ta-IN': 'இந்த வாரம் மழை பெய்யுமா?',
} satisfies Record<Extract<FarmLocale, 'en-IN' | 'ta-IN'>, string>;

function forecast(location: { latitude: number; longitude: number }, expires = now + 6 * 3600000): SourceResult {
 const evidence: Evidence = {
  id: evidenceId, source: 'Open-Meteo', title: 'Synthetic seven-day modelled weather forecast',
  url: 'https://api.open-meteo.com/v1/forecast', status: 'current',
  retrievedAt: new Date(now).toISOString(), validUntil: new Date(expires).toISOString(),
  scope: { ...location, forecastFrom: days[0], forecastTo: days.at(-1) },
  units: { precipitation_probability_max: '%', precipitation_sum: 'mm' },
  data: {
   origin: 'modelled_forecast', timezone: 'Asia/Kolkata',
   daily: {
    time: days, precipitation_probability_max: probabilities,
    precipitation_sum: [0, 0, 3.2, 0, 0, 0, 0],
   },
  },
 };
 return { status: 'available', evidence: [evidence] };
}

async function withApp(run: (app: FarmRuntime) => Promise<void>, options: Partial<RuntimeOptions> = {}) {
 const directory = await mkdtemp('/private/tmp/kalani-weather-reply-');
 const app = await openFarmRuntime(fixtures(directory, { weather: async location => forecast(location), now: () => now,
  route: async () => JSON.stringify({ routes: ['weather'] }), ...options }));
 try { await run(app); } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
}

const finished = (app: FarmRuntime, id: string) => waitState(app, s => s.messages.some(m =>
 (m.id === `reply-${id}` && m.audioStatus === 'ready') || (m.id === id && m.status === 'failed')));
const percentage = /%|％|\bpercent(?:age)?\b|சதவீதம்/iu;

for (const locale of ['en-IN', 'ta-IN'] as const) for (const mode of ['text', 'voice'] as const) {
 test(`a simple ${locale} ${mode} rain question speaks a short cited forecast without Claude reconciliation`, async () => {
  let mainCalls = 0, weatherCalls = 0;
  const spoken: { text: string; locale?: FarmLocale }[] = [];
  const transcribed: (FarmLocale | undefined)[] = [];
  const speech = fixtures('/unused').speech!;
  const specialist = fixtures('/unused').testReasoner!;
  await withApp(async app => {
   await seed(app);
   await app.preferences(owner, { requestId: 'weather-reply-locale', locale });
   const question = questions[locale];
   const input = mode === 'text' ? { text: question } : {
    audioId: await app.upload(owner, 'weather-reply-recording', Buffer.from('synthetic M4A bytes for stub STT'), 'audio/mp4'),
   };
   const id = await app.submit(owner, { requestId: 'ask-weather-reply', ...input });
   const state = await finished(app, id);
   const answer = state.messages.find(m => m.id === `reply-${id}`);
   assert.equal(state.messages.find(m => m.id === id)?.status, 'ready');
   assert.ok(answer);
   assert.equal(state.messages.find(m => m.id === id)?.text, question);
   assert.equal(mainCalls, 0); assert.equal(weatherCalls, 1);
   assert.deepEqual(transcribed, mode === 'voice' ? [locale] : []);
   assert.equal(answer.locale, locale);
   assert.match(answer.text, locale === 'en-IN' ? /rain is likely[^.]*22 November/i : /மழை வர வாய்ப்பு அதிக[^.]*22 நவம்பர்/);
   assert.doesNotMatch(answer.text, percentage);
   assert.ok(answer.text.length < 350, answer.text);
   assert.deepEqual(answer.evidenceIds, [evidenceId]);
   assert.deepEqual(spoken, [{ text: answer.text, locale }]);
   assert.deepEqual(state.tasks, []);
   const cited = state.evidence.find(e => e.id === evidenceId);
   assert.equal(cited?.source, 'Open-Meteo');
   assert.deepEqual((cited?.data as { daily?: { precipitation_probability_max?: number[] } })?.daily?.precipitation_probability_max, probabilities);
  }, {
   weather: async location => { weatherCalls++; return forecast(location); },
   testReasoner: async (role, packet) => {
    if (role === 'main') { mainCalls++; throw new Error('Simple rain questions must bypass model reconciliation'); }
    const raw = JSON.parse(await specialist(role, packet)); raw.evidenceIds = [evidenceId]; return JSON.stringify(raw);
   },
   speech: {
    ...speech,
    transcribe: async (_bytes, _mime, _terms, language) => { transcribed.push(language); return { text: questions[locale], language: locale }; },
    synthesize: async (text, language) => { spoken.push({ text, locale: language }); return speech.synthesize(text, language); },
   },
  });
 });
}

for (const inventedPercent of [true, false]) test(`mixed rain and calendar rejects ${inventedPercent ? 'an invented percentage' : 'a forecast-only task'}`, async () => {
 let mainCalls = 0;
 await withApp(async app => {
  await seed(app);
  await app.preferences(owner, { requestId: 'mixed-weather-locale', locale: 'en-IN' });
  const id = await app.submit(owner, { requestId: 'mixed-weather-calendar', text: 'Will it rain this week, and what is on my calendar?' });
  const state = await finished(app, id);
  const answer = state.messages.find(m => m.id === `reply-${id}`);
  assert.ok(answer); assert.ok(mainCalls > 0);
  assert.match(answer.text, /\brain\b/i);
  assert.doesNotMatch(answer.text, percentage);
  assert.ok(answer.evidenceIds?.includes(evidenceId));
  assert.deepEqual(state.tasks, []);
 }, {
  route: async () => JSON.stringify({ routes: ['weather', 'calendar'] }),
  testReasoner: async (role, packet) => {
   const p = JSON.parse(packet);
   if (role === 'weather' || role === 'main') assert.doesNotMatch(packet, /precipitation_probability_max/);
   if (role !== 'main') return JSON.stringify({ summary: 'Synthetic finding', evidenceIds: p.evidence.map((e: Evidence) => e.id), applicability: 'This field', missingFacts: [], uncertainty: [] });
   mainCalls++;
   return JSON.stringify({
    kind: 'guidance', text: inventedPercent ? 'There is a 99% chance of rain. The calendar is empty.' : 'Rain is likely on 22 November. The calendar is empty.',
    evidenceIds: [evidenceId, p.sources.calendar.evidence[0].id], missingFacts: [], uncertainty: [],
    tasks: [{ title: 'Prepare for rain', reason: 'Forecast', dueAt: new Date(now + 60000).toISOString(), evidenceIds: [evidenceId], uncertainty: [] }],
   });
  },
 });
});

test('a rain forecast expiring before publication is not cited or proposed as a task', async () => {
 let clock = now;
 const specialist = fixtures('/unused').testReasoner!;
 await withApp(async app => {
  await seed(app);
  await app.preferences(owner, { requestId: 'expiry-weather-locale', locale: 'en-IN' });
  const id = await app.submit(owner, { requestId: 'expiring-weather-reply', text: questions['en-IN'] });
  const state = await finished(app, id);
  const answer = state.messages.find(m => m.id === `reply-${id}`);
  assert.ok(answer); assert.deepEqual(answer.evidenceIds, []);
  assert.ok(state.evidence.some(e => e.id === evidenceId));
  assert.deepEqual(state.tasks, []);
 }, {
  now: () => clock,
  weather: async location => forecast(location, now + 1000),
  checkpoint: async phase => { if (phase === 'publish') clock = now + 2000; },
  testReasoner: async (role, packet) => {
   if (role === 'main') return JSON.stringify({ kind: 'guidance', text: 'Rain this week.', evidenceIds: [evidenceId], missingFacts: [], uncertainty: [], tasks: [] });
   return JSON.stringify({ ...JSON.parse(await specialist(role, packet)), evidenceIds: [evidenceId] });
  },
 });
});
