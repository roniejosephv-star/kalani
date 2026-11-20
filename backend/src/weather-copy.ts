import type { Evidence, FarmLocale } from './adapters.js';

export type RainLikelihood = 'unlikely' | 'possible' | 'likely' | 'unknown';
export interface RainForecast {
 timezone: string;
 days: { date: string; likelihood: RainLikelihood }[];
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const dayTime = (date: string) => Date.parse(`${date}T00:00:00Z`);
const validDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(dayTime(value)) && new Date(dayTime(value)).toISOString().slice(0, 10) === value;

export function forecastFromEvidence(evidence: Pick<Evidence, 'data'>): RainForecast | null {
 const data = evidence.data;
 if (!object(data) || typeof data.timezone !== 'string' || !object(data.daily)) return null;
 try { new Intl.DateTimeFormat('en-IN', { timeZone: data.timezone }); } catch { return null; }
 const dates = data.daily.time, chances = data.daily.precipitation_probability_max;
 if (!Array.isArray(dates) || !dates.length || !dates.every(validDate) || new Set(dates).size !== dates.length || !Array.isArray(chances) || dates.length !== chances.length) return null;
 if (!chances.every(value => value === null || typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100)) return null;
 return { timezone: data.timezone, days: dates.map((date, index): RainForecast['days'][number] => ({ date, likelihood: chances[index] === null ? 'unknown' : chances[index] < 20 ? 'unlikely' : chances[index] < 70 ? 'possible' : 'likely' })).sort((a, b) => a.date.localeCompare(b.date)) };
}

const phrasesByLocale: Record<FarmLocale,{phrases:Record<RainLikelihood,string>;unavailable:string;beforeWork:string;range:(first:string,last:string)=>string}> = {
 'en-IN': {
  phrases:{ unlikely:'Rain is unlikely', possible:'Rain is possible', likely:'Rain is likely', unknown:'Rain information is unavailable' },
  unavailable:'Rain information is unavailable.', beforeWork:'Before working outside, check the forecast again.', range:(first,last)=>`${first} to ${last}`,
 },
 'ta-IN': {
  phrases:{ unlikely:'மழை வர வாய்ப்பு குறைவான நாட்கள்', possible:'மழை வரக்கூடிய நாட்கள்', likely:'மழை வர வாய்ப்பு அதிகமான நாட்கள்', unknown:'மழை வாய்ப்பு பற்றிய தகவல் இல்லாத நாட்கள்' },
  unavailable:'மழை வாய்ப்பு பற்றிய தகவல் இல்லை.', beforeWork:'வயல் வேலைக்குப் போறதுக்கு முன்னாடி வானிலையை மறுபடியும் பாருங்க.', range:(first,last)=>`${first} முதல் ${last} வரை`,
 },
 'kn-IN': {
  phrases:{ unlikely:'ಮಳೆಯ ಸಾಧ್ಯತೆ ಕಡಿಮೆ ಇರುವ ದಿನಗಳು', possible:'ಮಳೆಯಾಗಬಹುದಾದ ದಿನಗಳು', likely:'ಮಳೆಯ ಸಾಧ್ಯತೆ ಹೆಚ್ಚು ಇರುವ ದಿನಗಳು', unknown:'ಮಳೆಯ ಮಾಹಿತಿ ಲಭ್ಯವಿಲ್ಲದ ದಿನಗಳು' },
  unavailable:'ಮಳೆಯ ಮಾಹಿತಿ ಲಭ್ಯವಿಲ್ಲ.', beforeWork:'ಹೊಲದ ಕೆಲಸಕ್ಕೆ ಹೋಗುವ ಮುನ್ನ ಹವಾಮಾನವನ್ನು ಮತ್ತೊಮ್ಮೆ ನೋಡಿ.', range:(first,last)=>`${first} ರಿಂದ ${last} ವರೆಗೆ`,
 },
 'ml-IN': {
  phrases:{ unlikely:'മഴയ്ക്ക് സാധ്യത കുറവുള്ള ദിവസങ്ങൾ', possible:'മഴ പെയ്യാൻ സാധ്യതയുള്ള ദിവസങ്ങൾ', likely:'മഴയ്ക്ക് കൂടുതൽ സാധ്യതയുള്ള ദിവസങ്ങൾ', unknown:'മഴയെക്കുറിച്ച് വിവരമില്ലാത്ത ദിവസങ്ങൾ' },
  unavailable:'മഴയെക്കുറിച്ച് വിവരമില്ല.', beforeWork:'വയലിൽ ജോലിക്ക് ഇറങ്ങും മുമ്പ് കാലാവസ്ഥ വീണ്ടും നോക്കൂ.', range:(first,last)=>`${first} മുതൽ ${last} വരെ`,
 },
 'te-IN': {
  phrases:{ unlikely:'వర్షం పడే అవకాశం తక్కువగా ఉన్న రోజులు', possible:'వర్షం పడే అవకాశం ఉన్న రోజులు', likely:'వర్షం పడే అవకాశం ఎక్కువగా ఉన్న రోజులు', unknown:'వర్షం గురించి సమాచారం లేని రోజులు' },
  unavailable:'వర్షం గురించి సమాచారం లేదు.', beforeWork:'పొలం పనికి వెళ్లే ముందు వాతావరణాన్ని మళ్లీ చూడండి.', range:(first,last)=>`${first} నుంచి ${last} వరకు`,
 },
};

export function renderRainForecast(forecast: RainForecast, locale: FarmLocale): string {
 const copy = phrasesByLocale[locale];
 if (!forecast.days.length) return copy.unavailable;
 const includeYear = new Set(forecast.days.map(day => day.date.slice(0, 4))).size > 1;
 const format = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', day: 'numeric', month: 'long', ...(includeYear ? { year: 'numeric' } : {}) });
 const label = (date: string) => format.format(new Date(dayTime(date)));
 const clauses = (['likely', 'possible', 'unknown', 'unlikely'] as const).flatMap(likelihood => {
  const runs: { first: string; last: string }[] = [];
  for (const day of forecast.days.filter(day => day.likelihood === likelihood)) {
   const previous = runs.at(-1);
   if (previous && dayTime(day.date) - dayTime(previous.last) === 86400000) previous.last = day.date;
   else runs.push({ first: day.date, last: day.date });
  }
  if (!runs.length) return [];
  const dates = runs.map(run => run.first === run.last ? label(run.first) : copy.range(label(run.first),label(run.last)));
  const periods = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(dates);
  return [locale==='en-IN' ? `${copy.phrases[likelihood]} on ${periods}.` : `${copy.phrases[likelihood]}: ${periods}.`];
 });
 return [...clauses, copy.beforeWork].join(' ');
}

export function isSimpleRainQuestion(text: string): boolean {
 const question = text.trim().toLowerCase().replace(/[?？.!]+$/u, '').trim().replace(/\s+/g, ' ');
 return /^(?:(?:will it|is it going to) rain(?: this week)?|(?:is rain expected|what is the (?:chance|likelihood) of rain)(?: this week)?|(?:any )?rain(?: this week)?)$/.test(question)
  || /^(?:இந்த வாரம் )?மழை (?:பெய்யுமா|வருமா|வர வாய்ப்பு இருக்கா|வர வாய்ப்பு உள்ளதா|பெய்ய வாய்ப்பு இருக்கா)$/.test(question)
  || /^(?:ಈ ವಾರ )?ಮಳೆ (?:ಬರುತ್ತದೆಯಾ|ಬರುತ್ತಾ|ಆಗುತ್ತದೆಯೇ)$/.test(question)
  || /^(?:ഈ ആഴ്ച )?മഴ പെയ്യുമോ$/.test(question)
  || /^(?:ఈ వారం )?వర్షం (?:పడుతుందా|వస్తుందా)$/.test(question);
}
