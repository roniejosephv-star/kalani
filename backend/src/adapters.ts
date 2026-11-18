import { createHash } from 'node:crypto';

export const SPEECH_TEXT_LIMIT = 2500;
export type FarmLocale = 'ta-IN' | 'en-IN';
export const DEFAULT_LOCALE: FarmLocale = 'ta-IN';

export interface Evidence {
  id: string;
  source: string;
  url: string;
  title: string;
  retrievedAt: string;
  observedAt?: string;
  publishedAt?: string;
  validUntil?: string;
  status: 'current' | 'historical' | 'unknown_validity';
  scope: { crop?: string; district?: string; state?: string; season?: string; latitude?: number; longitude?: number; [key: string]: unknown };
  units: Record<string, string>;
  data: unknown;
  passage?: string;
}

export interface SourceResult {
  status: 'available' | 'unavailable' | 'unconfigured' | 'no_applicable_data';
  evidence: Evidence[];
  reason?: string;
}

export interface AdapterOptions {
  fetch?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}

export class AdapterError extends Error {
  constructor(public readonly code: 'unconfigured' | 'invalid_input' | 'unavailable' | 'invalid_response', message: string, public readonly httpStatus?: number) {
    super(message);
    this.name = 'AdapterError';
  }
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const dateOnly = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const evidenceId = (source: string, value: unknown) => `${source}-${createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)}`;
const unavailable = (error: unknown): SourceResult => ({ status: 'unavailable', evidence: [], reason: error instanceof AdapterError ? error.message : 'Source request could not be completed.' });

async function requestJSON(url: string, init: RequestInit, options: AdapterOptions): Promise<unknown> {
  try {
    const response = await (options.fetch ?? fetch)(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(options.timeoutMs ?? 20_000) });
    if (!response.ok) throw new AdapterError('unavailable', `Provider returned HTTP ${response.status}.`, response.status);
    const length = Number(response.headers.get('content-length'));
    if (length > 16_000_000) throw new AdapterError('invalid_response', 'Provider response exceeded the size limit.');
    const reader = response.body?.getReader();
    if (!reader) throw new AdapterError('invalid_response', 'Provider returned an empty response.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 16_000_000) throw new AdapterError('invalid_response', 'Provider response exceeded the size limit.');
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof AdapterError) throw error;
    throw new AdapterError('unavailable', 'Provider request timed out, failed, or returned invalid JSON.');
  }
}

const weatherUnits = {
  temperature_2m_max: '°C', temperature_2m_min: '°C', precipitation_sum: 'mm',
  precipitation_probability_max: '%', et0_fao_evapotranspiration: 'mm',
};

export async function fetchWeather(location: { latitude: number; longitude: number }, options: AdapterOptions = {}): Promise<SourceResult> {
  if (!finite(location.latitude) || !finite(location.longitude) || Math.abs(location.latitude) > 90 || Math.abs(location.longitude) > 180) {
    throw new AdapterError('invalid_input', 'Confirmed coordinates are required for weather.');
  }
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({ latitude: String(location.latitude), longitude: String(location.longitude), daily: Object.keys(weatherUnits).join(','), timezone: 'Asia/Kolkata', forecast_days: '7' }).toString();
  try {
    const raw = await requestJSON(url.href, {}, options);
    if (!object(raw) || !finite(raw.latitude) || !finite(raw.longitude) || raw.timezone !== 'Asia/Kolkata' || !object(raw.daily) || !object(raw.daily_units)) throw new AdapterError('invalid_response', 'Weather response is missing location, timezone or daily data.');
    const daily = raw.daily;
    const times = daily.time;
    if (!Array.isArray(times) || times.length !== 7 || !times.every(dateOnly) || new Set(times).size !== 7 || times.some((date, i) => i > 0 && Date.parse(date) - Date.parse(times[i - 1]) !== 86_400_000)) throw new AdapterError('invalid_response', 'Weather forecast dates are invalid.');
    for (const [key, unit] of Object.entries(weatherUnits)) {
      const values = daily[key];
      if (raw.daily_units[key] !== unit || !Array.isArray(values) || values.length !== times.length || !values.every(v => v === null || finite(v))) throw new AdapterError('invalid_response', `Weather variable ${key} has invalid values or units.`);
      if ((key === 'precipitation_probability_max' && values.some(v => v !== null && (v < 0 || v > 100))) || (key === 'precipitation_sum' && values.some(v => v !== null && v < 0))) throw new AdapterError('invalid_response', 'Weather values are outside their expected range.');
    }
    const now = (options.now ?? (() => new Date()))();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    if (times[0] !== today) throw new AdapterError('invalid_response', 'Weather response does not start on the current local date.');
    const retrievedAt = now.toISOString();
    const data = { daily, grid: { latitude: raw.latitude, longitude: raw.longitude }, timezone: raw.timezone, origin: 'modelled_forecast', forecastIssuedAt: null, note: 'ET0 is reference evapotranspiration, not a field irrigation amount. Missing values remain unknown.' };
    return { status: 'available', evidence: [{ id: evidenceId('open-meteo', { location, retrievedAt, data }), source: 'Open-Meteo', title: 'Seven-day modelled weather forecast', url: url.href, retrievedAt, validUntil: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(), status: 'current', scope: { ...location, forecastFrom: times[0], forecastTo: times.at(-1) }, units: weatherUnits, data }] };
  } catch (error) { return unavailable(error); }
}

export interface MarketQuery {
  commodityId: number;
  stateId: number;
  districtIds?: number[];
  marketIds?: number[];
  fromDate: string;
  toDate: string;
}

export async function fetchMarketPrices(query: MarketQuery, options: AdapterOptions & { apiKey?: string; units?: string } = {}): Promise<SourceResult> {
  const apiKey = options.apiKey ?? process.env.CEDA_API_KEY;
  if (!apiKey) return { status: 'unconfigured', evidence: [], reason: 'CEDA API credentials are not configured.' };
  if (![query.commodityId, query.stateId, ...(query.districtIds ?? []), ...(query.marketIds ?? [])].every(v => Number.isSafeInteger(v) && v >= 0) || !dateOnly(query.fromDate) || !dateOnly(query.toDate) || query.fromDate > query.toDate || Date.parse(query.toDate) - Date.parse(query.fromDate) > 31 * 86_400_000) throw new AdapterError('invalid_input', 'Market queries need verified source IDs and an ordered date interval of at most 31 days.');
  const url = 'https://api.ceda.ashoka.edu.in/v1/agmarknet/prices';
  try {
    const raw = await requestJSON(url, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ commodity_id: query.commodityId, state_id: query.stateId, district_id: query.districtIds, market_id: query.marketIds, from_date: query.fromDate, to_date: query.toDate }) }, options);
    if (!object(raw) || !Array.isArray(raw.data) || raw.data.length > 5000 || !raw.data.every(row => object(row) && dateOnly(row.date) && row.date >= query.fromDate && row.date <= query.toDate && row.commodity_id === query.commodityId && (query.stateId === 0 || row.census_state_id === query.stateId) && (!query.districtIds?.length || query.districtIds.includes(row.census_district_id as number)) && (!query.marketIds?.length || query.marketIds.includes(row.market_id as number)) && ['min_price', 'max_price', 'modal_price'].every(key => row[key] === null || (finite(row[key]) && row[key] >= 0)))) throw new AdapterError('invalid_response', 'CEDA returned an unexpected price schema or mismatched scope.');
    if (!raw.data.length) return { status: 'no_applicable_data', evidence: [], reason: 'CEDA returned no observations for the requested interval and markets.' };
    const retrievedAt = (options.now ?? (() => new Date()))().toISOString();
    return { status: 'available', evidence: raw.data.map(row => ({ id: evidenceId('ceda', { row, units: options.units ?? 'unknown' }), source: 'CEDA Agmarknet', title: 'Dated market price observation', url, retrievedAt, observedAt: row.date, status: 'historical', scope: { commodityId: query.commodityId, stateId: row.census_state_id, districtId: row.census_district_id, marketId: row.market_id }, units: { price: options.units ?? 'unknown—verify source units before comparing' }, data: { ...row, isOffer: false, isForecast: false, comparable: !!options.units } })) };
  } catch (error) { return unavailable(error); }
}

export interface ReviewedRecord {
  kind: 'crop' | 'market' | 'opportunity';
  reviewStatus: 'draft' | 'reviewed' | 'withdrawn';
  reviewer?: string;
  reviewedAt?: string;
  validFrom: string;
  validUntil: string;
  evidence: Evidence;
}

function officialSource(url: string, kind: ReviewedRecord['kind']): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return false;
    const host = parsed.hostname;
    return host.endsWith('.gov.in') || host === 'tnau.ac.in' || host.endsWith('.tnau.ac.in') || host === 'icar.org.in' || host.endsWith('.icar.org.in') || (kind === 'market' && (host === 'ashoka.edu.in' || host.endsWith('.ashoka.edu.in')));
  } catch { return false; }
}

export function reviewedCatalogue(records: readonly ReviewedRecord[], query: { kind: ReviewedRecord['kind']; crop?: string; district?: string; state?: string; season?: string }, now = new Date()): SourceResult {
  if (!records.length) return { status: 'unconfigured', evidence: [], reason: 'No reviewed source catalogue has been installed.' };
  const evidence = records.filter(record => {
    const source = record.evidence;
    const from = Date.parse(record.validFrom), until = Date.parse(record.validUntil);
    if (record.kind !== query.kind || record.reviewStatus !== 'reviewed' || !record.reviewer || !record.reviewedAt || !Number.isFinite(Date.parse(record.reviewedAt)) || Date.parse(record.reviewedAt) > now.getTime() || !Number.isFinite(from) || !Number.isFinite(until) || from > now.getTime() || until <= now.getTime()) return false;
    if (!source.id || !source.title || !source.passage?.trim() || !officialSource(source.url, record.kind) || !source.source || source.status !== 'current' || (source.validUntil && (!Number.isFinite(Date.parse(source.validUntil)) || Date.parse(source.validUntil) <= now.getTime()))) return false;
    return (['crop', 'district', 'state', 'season'] as const).every(key => !source.scope[key] || (!!query[key] && source.scope[key]!.toLocaleLowerCase() === query[key]!.toLocaleLowerCase()));
  }).map(record => ({ ...structuredClone(record.evidence), validUntil: record.evidence.validUntil && Date.parse(record.evidence.validUntil) < Date.parse(record.validUntil) ? record.evidence.validUntil : record.validUntil }));
  return evidence.length ? { status: 'available', evidence } : { status: 'no_applicable_data', evidence: [], reason: 'No current reviewed evidence matches the confirmed farm context.' };
}

function completeWave(audio: Buffer): boolean {
  if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE' || audio.readUInt32LE(4) + 8 !== audio.length) return false;
  let format = false, samples = false, offset = 12;
  while (offset + 8 <= audio.length) {
    const chunk = audio.toString('ascii', offset, offset + 4);
    const length = audio.readUInt32LE(offset + 4);
    if (offset + 8 + length > audio.length) return false;
    if (chunk === 'fmt ' && length >= 16) format = true;
    if (chunk === 'data' && length > 0) samples = true;
    offset += 8 + length + (length % 2);
  }
  return format && samples && offset === audio.length;
}

export function createSpeechAdapter(options: AdapterOptions & { apiKey?: string; sttModel?: 'saaras:v3' | 'saaras:v4'; ttsModel?: 'bulbul:v3' | 'bulbul:v4-flash'; speaker?: string } = {}) {
  const apiKey = options.apiKey ?? process.env.SARVAM_API_KEY;
  const sttModel = options.sttModel ?? 'saaras:v4';
  const ttsModel = options.ttsModel ?? 'bulbul:v3';
  const headers = () => {
    if (!apiKey) throw new AdapterError('unconfigured', 'Speech service is not configured.');
    return { 'api-subscription-key': apiKey };
  };
  return {
    configured: !!apiKey,
    async transcribe(audio: Buffer, mime: string, keyterms: string[] = [], locale:FarmLocale = DEFAULT_LOCALE): Promise<{ text: string; language: string | null; providerRequestId?: string }> {
      const extensions: Record<string, string> = { 'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a', 'audio/wav': 'wav', 'audio/mpeg': 'mp3', 'audio/aac': 'aac', 'audio/webm': 'webm', 'audio/ogg': 'ogg' };
      if (!audio.length || audio.length > 5_000_000 || !extensions[mime]) throw new AdapterError('invalid_input', 'Use a supported short audio recording under 5 MB.');
      const form = new FormData();
      form.set('file', new Blob([new Uint8Array(audio)], { type: mime }), `recording.${extensions[mime]}`);
      form.set('model', sttModel);
      form.set('language_code', locale);
      if (sttModel === 'saaras:v4' && keyterms.length) form.set('keyterms', JSON.stringify(keyterms.filter(term => term.trim()).slice(0, 50).map(term => term.slice(0, 64))));
      const raw = await requestJSON('https://api.sarvam.ai/speech-to-text', { method: 'POST', headers: headers(), body: form }, { ...options, timeoutMs: options.timeoutMs ?? 45_000 });
      if (!object(raw) || typeof raw.transcript !== 'string' || !raw.transcript.trim() || raw.transcript.length > 10_000 || !(raw.language_code === null || typeof raw.language_code === 'string')) throw new AdapterError('invalid_response', 'Speech recognition returned no usable transcript.');
      return { text: raw.transcript, language: raw.language_code, ...(typeof raw.request_id === 'string' && { providerRequestId: raw.request_id }) };
    },
    async synthesize(text: string, locale:FarmLocale = DEFAULT_LOCALE): Promise<{ audio: Buffer; mime: 'audio/wav'; providerRequestId?: string }> {
      if (!text.trim() || [...text].length > SPEECH_TEXT_LIMIT) throw new AdapterError('invalid_input', `Spoken responses must contain between 1 and ${SPEECH_TEXT_LIMIT} characters.`);
      const raw = await requestJSON('https://api.sarvam.ai/text-to-speech', { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ text, language_code: locale, model: ttsModel, ...(options.speaker && { speaker: options.speaker }), output_audio_codec: 'wav', speech_sample_rate: 22050 }) }, { ...options, timeoutMs: options.timeoutMs ?? 45_000 });
      if (!object(raw) || !Array.isArray(raw.audios) || raw.audios.length !== 1 || typeof raw.audios[0] !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw.audios[0])) throw new AdapterError('invalid_response', 'Speech synthesis returned invalid audio.');
      const audio = Buffer.from(raw.audios[0], 'base64');
      if (!completeWave(audio)) throw new AdapterError('invalid_response', 'Speech synthesis returned an incomplete or invalid WAV file.');
      return { audio, mime: 'audio/wav', ...(typeof raw.request_id === 'string' && { providerRequestId: raw.request_id }) };
    },
  };
}
