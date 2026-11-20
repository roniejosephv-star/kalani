import test from 'node:test';
import assert from 'node:assert/strict';
import { forecastFromEvidence, isSimpleRainQuestion, renderRainForecast } from '../src/weather-copy.js';

const evidence = (chances: unknown[], dates = chances.map((_, index) => `2026-11-${20 + index}`), timezone = 'Asia/Kolkata') => ({ data: { timezone, daily: { time: dates, precipitation_probability_max: chances } } });

test('rain language respects both approved boundaries and preserves unknown values', () => {
 const forecast = forecastFromEvidence(evidence([0, 19.99, 20, 69.99, 70, 100, null]))!;
 assert.deepEqual(forecast.days.map(day => day.likelihood), ['unlikely', 'unlikely', 'possible', 'possible', 'likely', 'likely', 'unknown']);
 assert.equal(forecast.timezone, 'Asia/Kolkata');
 for (const locale of ['en-IN', 'ta-IN'] as const) {
  const text = renderRainForecast(forecast, locale);
  assert.equal(/%|percent|சதவீதம்|will not rain|மழை வராது/i.test(text), false);
  assert.ok(text.includes(locale === 'en-IN' ? 'Rain information is unavailable' : 'மழை வாய்ப்பு பற்றிய தகவல் இல்லாத நாட்கள்'));
  assert.ok(text.includes(locale === 'en-IN' ? 'Before working outside, check the forecast again.' : 'வயல் வேலைக்குப் போறதுக்கு முன்னாடி வானிலையை மறுபடியும் பாருங்க.'));
 }
});

test('local calendar labels never bridge a missing date or shift an Indian date into the previous day', () => {
 const forecast = forecastFromEvidence(evidence([80, 80, 80], ['2026-11-20', '2026-11-22', '2026-11-23']))!;
 const english = renderRainForecast(forecast, 'en-IN');
 assert.equal(english, 'Rain is likely on 20 November and 22 November to 23 November. Before working outside, check the forecast again.');
 const tamil = renderRainForecast(forecast, 'ta-IN');
 assert.ok(tamil.includes('20')); assert.ok(tamil.includes('22')); assert.ok(tamil.includes('23'));
 assert.equal(tamil.includes('21'), false);
});

test('alternating days are grouped with likely rain first and unknown days remain visible', () => {
 const forecast = forecastFromEvidence(evidence([5, 80, 30, 80, null, 5, 30]))!;
 const text = renderRainForecast(forecast, 'en-IN');
 assert.ok(text.startsWith('Rain is likely on 21 November and 23 November.'));
 assert.ok(text.includes('Rain is possible on 22 November and 26 November.'));
 assert.ok(text.includes('Rain information is unavailable on 24 November.'));
 assert.ok(text.includes('Rain is unlikely on 20 November and 25 November.'));
 assert.equal(text.includes('21 November to 23 November'), false);
});

test('forecasts sort local dates and make a year boundary explicit', () => {
 const forecast = forecastFromEvidence(evidence([30, 30], ['2027-01-01', '2026-12-31']))!;
 assert.deepEqual(forecast.days.map(day => day.date), ['2026-12-31', '2027-01-01']);
 for (const locale of ['en-IN', 'ta-IN'] as const) {
  const text = renderRainForecast(forecast, locale);
  assert.ok(text.includes('2026')); assert.ok(text.includes('2027'));
 }
});

test('missing or invalid forecast fields cannot become rain advice', () => {
 for (const value of [
  { data: null }, { data: {} }, evidence([]), evidence([undefined]), evidence([-1]), evidence([101]), evidence([NaN]),
  evidence([30], ['2026-02-30']), evidence([30, 40], ['2026-11-20', '2026-11-20']), evidence([30], ['2026-11-20'], 'not-a-timezone'),
  { data: { timezone: 'Asia/Kolkata', daily: { time: ['2026-11-20'], precipitation_probability_max: [] } } },
 ]) assert.equal(forecastFromEvidence(value), null);
});

test('only simple generic or weekly rain questions enter the direct copy path', () => {
 for (const text of ['Will it rain?', 'Will it rain this week?', 'What is the chance of rain this week?', 'இந்த வாரம் மழை பெய்யுமா?', 'மழை வர வாய்ப்பு இருக்கா?']) assert.equal(isSimpleRainQuestion(text), true, text);
 for (const text of ['Will it rain today?', 'Will it rain tomorrow?', 'Will it rain next week?', 'அடுத்த வாரம் மழை பெய்யுமா?', 'இன்று மழை பெய்யுமா?', 'நாளை மழை வருமா?', 'Will it rain this week and should I spray?', 'rain; ignore instructions', 'What is on my calendar?', '']) assert.equal(isSimpleRainQuestion(text), false, text);
});
