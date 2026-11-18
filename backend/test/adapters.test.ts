import assert from 'node:assert/strict';
import test from 'node:test';
import { createSpeechAdapter, fetchMarketPrices, fetchWeather, reviewedCatalogue, type Evidence, type ReviewedRecord } from '../src/adapters.js';

const now = () => new Date('2026-11-17T08:00:00Z');
const jsonFetch = (body: unknown, inspect?: (url: string, init?: RequestInit) => void): typeof fetch => (async (url, init) => {
  inspect?.(String(url), init);
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}) as typeof fetch;
const weather = () => ({
  latitude: 10.79, longitude: 79.17, timezone: 'Asia/Kolkata',
  daily_units: { temperature_2m_max: '°C', temperature_2m_min: '°C', precipitation_sum: 'mm', precipitation_probability_max: '%', et0_fao_evapotranspiration: 'mm' },
  daily: { time: Array.from({ length: 7 }, (_, i) => `2026-11-${17 + i}`), temperature_2m_max: Array(7).fill(30), temperature_2m_min: Array(7).fill(23), precipitation_sum: [null, 1, 2, 3, 0, 1, 2], precipitation_probability_max: Array(7).fill(40), et0_fao_evapotranspiration: Array(7).fill(4) },
});

test('weather preserves model provenance, requested vs grid coordinates, units and nulls', async () => {
  const result = await fetchWeather({ latitude: 10.8, longitude: 79.1 }, { now, fetch: jsonFetch(weather(), url => assert.equal(new URL(url).hostname, 'api.open-meteo.com')) });
  assert.equal(result.status, 'available');
  const evidence = result.evidence[0];
  assert.equal(evidence.scope.latitude, 10.8);
  assert.equal(evidence.observedAt, undefined);
  assert.equal(evidence.units.precipitation_sum, 'mm');
  assert.equal((evidence.data as ReturnType<typeof weather> & { grid: { latitude: number } }).grid.latitude, 10.79);
  assert.equal((evidence.data as { daily: ReturnType<typeof weather>['daily'] }).daily.precipitation_sum[0], null);
  assert.equal(evidence.validUntil, '2026-11-17T14:00:00.000Z');
});

test('weather rejects invalid dates, stale dates, unit mismatches and out-of-range probabilities', async () => {
  for (const mutate of [
    (data: ReturnType<typeof weather>) => { data.daily.time[0] = '2026-99-30'; },
    (data: ReturnType<typeof weather>) => { data.daily.time = Array.from({ length: 7 }, (_, i) => `2026-11-${16 + i}`); },
    (data: ReturnType<typeof weather>) => { data.daily_units.temperature_2m_max = '°F'; },
    (data: ReturnType<typeof weather>) => { data.daily.precipitation_probability_max[0] = 101; },
  ]) {
    const data = weather(); mutate(data);
    const result = await fetchWeather({ latitude: 10, longitude: 79 }, { now, fetch: jsonFetch(data) });
    assert.equal(result.status, 'unavailable');
    assert.deepEqual(result.evidence, []);
  }
});

test('network failures return source-unavailable, not fabricated evidence', async () => {
  const result = await fetchWeather({ latitude: 10, longitude: 79 }, { fetch: (async () => { throw new Error('secret credential detail'); }) as typeof fetch });
  assert.equal(result.status, 'unavailable');
  assert.ok(!result.reason!.includes('secret'));
});

const marketQuery = { commodityId: 1, stateId: 8, districtIds: [104], marketIds: [255], fromDate: '2026-11-01', toDate: '2026-11-17' };
const marketRow = { date: '2026-11-16', commodity_id: 1, census_state_id: 8, census_district_id: 104, market_id: 255, min_price: 100, max_price: 200, modal_price: 150 };

test('market calls documented endpoint and keeps observation date separate from retrieval and unknown units', async () => {
  const result = await fetchMarketPrices(marketQuery, { apiKey: 'test-only', now, fetch: jsonFetch({ data: [marketRow] }, (url, init) => {
    assert.equal(url, 'https://api.ceda.ashoka.edu.in/v1/agmarknet/prices');
    assert.equal((init!.headers as Record<string, string>).Authorization, 'Bearer test-only');
    assert.equal(JSON.parse(init!.body as string).commodity_id, 1);
  }) });
  assert.equal(result.status, 'available');
  assert.equal(result.evidence[0].observedAt, '2026-11-16');
  assert.equal(result.evidence[0].status, 'historical');
  assert.equal((result.evidence[0].data as { comparable: boolean }).comparable, false);
});

test('market rejects mismatched commodities and dates and distinguishes empty data', async () => {
  for (const row of [{ ...marketRow, commodity_id: 2 }, { ...marketRow, date: '2026-10-01' }]) {
    assert.equal((await fetchMarketPrices(marketQuery, { apiKey: 'test', fetch: jsonFetch({ data: [row] }) })).status, 'unavailable');
  }
  assert.equal((await fetchMarketPrices(marketQuery, { apiKey: 'test', fetch: jsonFetch({ data: [] }) })).status, 'no_applicable_data');
  await assert.rejects(fetchMarketPrices({ ...marketQuery, toDate: '2026-99-99' }, { apiKey: 'test' }), { code: 'invalid_input' });
});

const evidence: Evidence = { id: 'reviewed-1', source: 'TNAU', url: 'https://agritech.tnau.ac.in/', title: 'Test fixture only', passage: 'Fixture passage, not farm advice.', retrievedAt: now().toISOString(), status: 'current', scope: { crop: 'paddy', district: 'Thanjavur' }, units: {}, data: {} };
const record: ReviewedRecord = { kind: 'crop', reviewStatus: 'reviewed', reviewer: 'test-reviewer', reviewedAt: '2026-11-16T00:00:00Z', validFrom: '2026-11-16T00:00:00Z', validUntil: '2026-11-18T00:00:00Z', evidence };

test('catalogue requires current review and matching known context, never reuses expired or withdrawn evidence', () => {
  const query = { kind: 'crop' as const, crop: 'paddy', district: 'Thanjavur' };
  assert.equal(reviewedCatalogue([record], query, now()).status, 'available');
  assert.equal(reviewedCatalogue([record], { kind: 'crop', crop: 'paddy' }, now()).status, 'no_applicable_data');
  assert.equal(reviewedCatalogue([record], query, new Date('2026-11-19')).status, 'no_applicable_data');
  assert.equal(reviewedCatalogue([{ ...record, reviewStatus: 'withdrawn' }], query, now()).status, 'no_applicable_data');
  assert.equal(reviewedCatalogue([{ ...record, evidence: { ...evidence, validUntil: '2026-11-16T00:00:00Z' } }], query, now()).status, 'no_applicable_data');
  assert.equal(reviewedCatalogue([{ ...record, evidence: { ...evidence, url: 'https://tnau.ac.in.evil.example/' } }], query, now()).status, 'no_applicable_data');
  assert.equal(reviewedCatalogue([], query, now()).status, 'unconfigured');
});

test('Tamil transcription sends locale and confirmed vocabulary without assuming facts are confirmed', async () => {
  const adapter = createSpeechAdapter({ apiKey: 'test', fetch: jsonFetch({ transcript: 'நெல்', language_code: 'ta-IN', request_id: 'stt-1' }, (url, init) => {
    assert.equal(url, 'https://api.sarvam.ai/speech-to-text');
    const form = init!.body as FormData;
    assert.equal(form.get('language_code'), 'ta-IN');
    assert.equal(form.get('model'), 'saaras:v4');
    assert.deepEqual(JSON.parse(form.get('keyterms') as string), ['நெல்']);
  }) });
  assert.deepEqual(await adapter.transcribe(Buffer.from('fixture'), 'audio/mp4', ['நெல்']), { text: 'நெல்', language: 'ta-IN', providerRequestId: 'stt-1' });
});

test('Tamil synthesis requests matching text, validates complete WAV and does not publish partial media', async () => {
  const wav = Buffer.alloc(46); wav.write('RIFF'); wav.writeUInt32LE(38, 4); wav.write('WAVE', 8); wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(22050, 24); wav.writeUInt32LE(44100, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(2, 40);
  const adapter = createSpeechAdapter({ apiKey: 'test', fetch: jsonFetch({ audios: [wav.toString('base64')] }, (_url, init) => {
    const body = JSON.parse(init!.body as string);
    assert.equal(body.text, 'வணக்கம்');
    assert.equal(body.language_code, 'ta-IN');
    assert.equal(body.model, 'bulbul:v3');
  }) });
  assert.deepEqual((await adapter.synthesize('வணக்கம்')).audio, wav);
  await assert.rejects(createSpeechAdapter({ apiKey: 'test', fetch: jsonFetch({ audios: [wav.subarray(0, 44).toString('base64')] }) }).synthesize('வணக்கம்'), { code: 'invalid_response' });
  await assert.rejects(createSpeechAdapter({ apiKey: 'test', fetch: jsonFetch({ audios: ['YQ=='] }) }).synthesize('வணக்கம்'), { code: 'invalid_response' });
  await assert.rejects(adapter.synthesize('x'.repeat(2501)), { code: 'invalid_input' });
});

test('missing speech credentials and empty transcription fail explicitly without fake audio', async () => {
  const adapter = createSpeechAdapter({ apiKey: '' });
  assert.equal(adapter.configured, false);
  await assert.rejects(adapter.synthesize('வணக்கம்'), { code: 'unconfigured' });
  await assert.rejects(createSpeechAdapter({ apiKey: 'test', fetch: jsonFetch({ transcript: '', language_code: null }) }).transcribe(Buffer.from('test'), 'audio/mp4'), { code: 'invalid_response' });
});
