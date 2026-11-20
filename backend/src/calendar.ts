import type { FarmLocale } from './adapters.js';
import { AppError, ModelOutputError, event, iso, type FarmerState } from './domain.js';

export type CalendarEntry = {
 id: string; version: number; fieldId: string; cycleId: string; contextVersion: number;
 title: string; dueAt?: string; status: 'draft' | 'saved' | 'cancelled'; sourceMessageId: string;
 localDate?: string; minuteOfDay?: number;
};
export type CalendarAction = 'save' | 'change_time' | 'undo';
type CalendarTiming = { localDate?: string | null; minuteOfDay?: number | null; exact: boolean };
type CalendarTitle = string | null;
type CalendarExtraction = { title: CalendarTitle; dateText?: string; timeText?: string };

const localOffset = 330 * 60_000;
const day = 86_400_000;
const calendarTitleLimit = 160;
export const calendarLocalDate = (at: number) => iso(at + localOffset).slice(0, 10);
const midnight = (date: string) => Date.parse(`${date}T00:00:00Z`);
const isDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(midnight(date)) && iso(midnight(date)).slice(0, 10) === date;
const when = (localDate: string, minuteOfDay: number) => iso(midnight(localDate) - localOffset + minuteOfDay * 60_000);
const normalise = (s: string) => s.normalize('NFKC').replace(/[௦-௯౦-౯೦-೯൦-൯]/gu, char => String((char.codePointAt(0)! & 15) - 6)).trim().replace(/\s+/gu, ' ');
const relative = [
 /\btoday\b|இன்று|இன்னைக்கு|ಇಂದು|ഇന്ന്|ఈ రోజు|ఇవాళ/iu,
 /\btomorrow\b|நாளை|நாளைக்கு|ನಾಳೆ|നാളെ|రేపు/iu,
 /\bday after tomorrow\b|நாளை மறுநாள்|நாளை மறுநாளைக்கு|ನಾಡಿದ್ದು|മറ്റന്നാൾ|ఎల్లుండి/iu,
];
const weekdays = [
 /\bSunday\b|ஞாயிறு|ಭಾನುವಾರ|ഞായർ|ఆదివారం/iu,
 /\bMonday\b|திங்கள்|ಸೋಮವಾರ|തിങ്കൾ|సోమవారం/iu,
 /\bTuesday\b|செவ்வாய்|ಮಂಗಳವಾರ|ചൊവ്വ|మంగళవారం/iu,
 /\bWednesday\b|புதன்|ಬುಧವಾರ|ബുധൻ|బుధవారం/iu,
 /\bThursday\b|வியாழன்|ಗುರುವಾರ|വ്യാഴം|గురువారం/iu,
 /\bFriday\b|வெள்ளி|ಶುಕ್ರವಾರ|വെള്ളി|శుక్రవారం/iu,
 /\bSaturday\b|சனி|ಶನಿವಾರ|ശനി|శనివారం/iu,
];
const parts = [
 { words: /\bmorning\b|காலை|ಬೆಳಗ್ಗೆ|രാവിലെ|ఉదయం/iu, minute: 480, afternoon: false },
 { words: /\bafternoon\b|மதியம்|ಮಧ್ಯಾಹ್ನ|ഉച്ചയ്ക്ക്|మధ్యాహ్నం/iu, minute: 840, afternoon: true },
 { words: /\bevening\b|மாலை|ಸಂಜೆ|വൈകുന്നേരം|సాయంత్రం/iu, minute: 1020, afternoon: true },
 { words: /\bnight\b|இரவு|ರಾತ್ರಿ|രാത്രി|రాత్రి/iu, minute: undefined, afternoon: true },
];
const meridiemClock = /(?:^|[^\p{L}\d:])(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?(?!\p{L})/giu;
const fixedClock = /(?:^|[^\p{L}\d:])(\d{1,2}):(\d{2})(?=$|[^\p{L}\d:])/gu;
const hourWithPart = /\bat\s+(\d{1,2})(?![\d:])|(?<![\d:])(\d{1,2})\s*(?:o.?clock|மணிக்கு|மணி|ಗಂಟೆಗೆ|മണിക്ക്|గంటలకు)/giu;
const datePattern = /\b\d{4}-\d{2}-\d{2}\b/gu;
const recurring = /\b(?:every (?:day|week|month|morning)|daily|weekly|monthly|each (?:day|week)|next and|both days)\b|தினமும்|ஒவ்வொரு நாள்|ప్రతి రోజు|ಪ್ರತಿದಿನ|എല്ലാ ദിവസവും/iu;
const directRequest = /^(?:(?:please\s+|(?:can|could|would) you\s+)?(?:remind me\b(?!\s+(?:how|why|what)\b)|(?:add|create|set|make|schedule|put|book)\b(?:[^.!?]{0,40}\b(?:reminder|event|calendar)\b|\s+(?:an?\s+)?reminder\b)|schedule\s+(?!for\b)))|(?:நினைவூட்டு(?:ங்கள்)?|ஞாபகப்படுத்து(?:ங்கள்)?|ನೆನಪಿಸು(?:ತ್ತೀರಾ)?|ഓർമ്മിപ്പിക്കൂ|ഗുര్తు\s*చేయండి|గుర్తు\s*చెయ్యి)\s*[.?!]?$/iu;
const changePrefix = /^(?:please\s+)?(?:change (?:it|the time|the date)(?: to)?|move (?:it|the reminder)(?: to)?|make it|instead|no[,\s]+|நேரத்தை மாற்று|நேரம் மாற்று|அதற்குப் பதிலாக|இல்லை[,\s]+|ಸಮಯ ಬದಲಿಸಿ|സമയം മാറ്റൂ|సమయం మార్చండి)\s*[, ]*/iu;
const calendarView = /\b(?:what(?:'s| is) on my calendar|show(?: me)? (?:my|the) calendar|(?:work|events?|reminders?) (?:are |is )?scheduled)\b|என் கால அட்டவணை|கால அட்டவணையை காட்டு|ನನ್ನ ವೇಳಾಪಟ್ಟಿ|എന്റെ കലണ്ടർ|నా క్యాలెండర్/iu;

function dateOf(text: string, anchor: number): string | null | undefined {
 const source = normalise(text);
 const matches = [...source.matchAll(datePattern)].map(match => match[0]);
 let rest = source;
 for (const offset of [2, 1, 0]) if (relative[offset].test(rest)) {
  rest = rest.replace(relative[offset], ' ');
  matches.push(calendarLocalDate(anchor + offset * day));
 }
 const today = new Date(midnight(calendarLocalDate(anchor))).getUTCDay();
 for (const [weekday, words] of weekdays.entries()) if (words.test(rest)) {
  const delta = (weekday - today + 7) % 7;
  matches.push(calendarLocalDate(anchor + (delta || (/\bnext\b|அடுத்த/iu.test(rest) ? 7 : 0)) * day));
 }
 if (!matches.length) return undefined;
 return matches.every(date => date === matches[0] && isDate(date)) ? matches[0] : null;
}
function timingOf(text: string, anchor: number): CalendarTiming {
 const localDate = dateOf(text, anchor);
 const source = normalise(text).replace(datePattern, ' ');
 const dayparts = parts.filter(part => part.words.test(source));
 const clocks = [...source.matchAll(meridiemClock)];
 const base = clocks.length ? clocks : [...source.matchAll(fixedClock)];
 const looseHours = dayparts.length === 1 ? [...source.matchAll(hourWithPart)].map(match => Number(match[1] ?? match[2])) : [];
 const laidOut = base.length ? base : looseHours.map(hour => ['', String(hour)]);
 if (dayparts.length > 1 || laidOut.length > 1 || (clocks.length && fixedClock.test(source.replace(meridiemClock, ' ')))) {
  fixedClock.lastIndex = 0;
  return { localDate, minuteOfDay: null, exact: false };
 }
 fixedClock.lastIndex = 0;
 if (laidOut.length) {
  const [, hours, minutes, marker] = laidOut[0];
  const hour = Number(hours), minute = Number(minutes ?? '0'), part = dayparts[0];
  const explicit = clocks.length > 0 || base.length > 0;
  const normalizedHour = marker ? hour % 12 + (marker.toLowerCase() === 'p' ? 12 : 0) : part && hour <= 12 ? hour % 12 + (part.afternoon ? 12 : 0) : hour;
  if (minute > 59 || hour > (marker || !explicit ? 12 : 23) || (marker && hour === 0) || (part && (normalizedHour >= 12) !== part.afternoon)) return { localDate, minuteOfDay: null, exact: false };
  return { localDate, minuteOfDay: normalizedHour * 60 + minute, exact: explicit && !part };
 }
 return { localDate, minuteOfDay: dayparts[0]?.minute, exact: false };
}
const viewTomorrow = /\btomorrow\b|நாளை|ನಾಳೆ|നാളെ|రేపు/iu;

export function calendarWindow(question: string, at: number): { start: string; days: number } {
 const selected = dateOf(question, at);
 const isWeekly = /\b(?:this week|next (?:seven|7) days|upcoming)\b|இந்த வாரம்|ಈ ವಾರ|ഈ ആഴ്ച|ఈ వారం/iu.test(question);
 return { start: selected ?? calendarLocalDate(at), days: selected && !isWeekly || viewTomorrow.test(question) ? 1 : 7 };
}
export const isCalendarView = (text: string) => calendarView.test(text) && !/\b(?:and|rain|weather|market|price|scheme|subsidy)\b|மற்றும்|மழை|வானிலை|விலை|மானியம்/iu.test(text);
export const isCalendarCreate = (text: string) => directRequest.test(normalise(text));
export function clarificationTitle(text: string): CalendarTitle {
 const source = normalise(text).replace(/^(?:the event is|it is to|it[’']s to|the task is|வேலை|சேர்க்க வேண்டியது)[\s:]+/iu, '').replace(/[.!]+$/u, '').trim();
 if (!source || source.length > calendarTitleLimit || /[?？]/u.test(source) || /^(?:what|when|where|which|why|how|can|could|will|is|weather|rain|calendar|market)\b|^(?:என்ன|எப்போது|எப்படி|மழை|வானிலை|கால அட்டவணை|சந்தை)/iu.test(source)) return null;
 return /\p{L}/u.test(source) ? source : null;
}
export function pendingCalendar(state: FarmerState): CalendarEntry | undefined {
 return (state.calendarEntries ?? []).findLast(e => e.status === 'draft' && e.contextVersion === state.version && e.fieldId === state.fieldId && e.cycleId === state.cycleId);
}
export function isCalendarCorrection(text: string, anchor: number): boolean {
 if (changePrefix.test(text)) return true;
 const timing = timingOf(text, anchor);
 if (timing.localDate === undefined && timing.minuteOfDay === undefined) return false;
 let residue = normalise(text).replace(datePattern, ' ').replace(meridiemClock, ' ').replace(fixedClock, ' ');
 for (const expression of [...relative].reverse()) residue = residue.replace(expression, ' ');
 for (const expression of weekdays) residue = residue.replace(expression, ' ');
 for (const part of parts) residue = residue.replace(part.words, ' ');
 return /^(?:(?:at|on|please|next|this)\b|மணிக்கு|மணி|[ ,.!?])*$/iu.test(residue);
}
export const calendarExtractFormat = 'Extract the title, date wording and time wording from the quoted farmer message. Each value must be a single verbatim span or null. Leave trigger words, dates and times outside the activity title. Do not translate, calculate, infer or add words. Return exactly {"title":"copied activity","dateText":"copied date","timeText":"copied time"}, with null for an absent or ambiguous span.';
export function parseCalendarExtraction(raw: string, question: string): CalendarExtraction {
 let parsed: unknown;
 try { parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1')); }
 catch { throw new ModelOutputError('invalid_model_output', 'json'); }
 if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ModelOutputError('invalid_model_output', 'shape');
 const { title, dateText, timeText } = parsed as Record<string, unknown>;
 const quoted = normalise(question).toLocaleLowerCase();
 const span = (value: unknown, limit: number): value is string => typeof value === 'string' && !!value.trim() && [...value].length <= limit && quoted.includes(normalise(value).toLocaleLowerCase());
 if ((title !== null && !span(title, calendarTitleLimit)) || (dateText != null && !span(dateText, 64)) || (timeText != null && !span(timeText, 64))) throw new ModelOutputError('invalid_model_output', 'shape');
 return { title: typeof title === 'string' ? normalise(title).replace(/[.!?]+$/u, '').trim() || null : null, ...(typeof dateText === 'string' ? {dateText} : {}), ...(typeof timeText === 'string' ? {timeText} : {}) };
}

export function localCalendarTitle(question: string): CalendarTitle {
 const source = normalise(question);
 const englishTitle = source.match(/\b(?:to|that I (?:should|need to))\s+(.+?)(?=\s+(?:(?:today|tomorrow)\b|at\s+\d)|[.!?]*$)/iu)?.[1];
 if (englishTitle && englishTitle.length <= calendarTitleLimit) return englishTitle.trim();
 let residue = source.replace(/^(?:please\s+|(?:can|could|would) you\s+)?(?:remind me|(?:add|create|set(?: up)?|make|schedule|put|book)(?:\s+(?:an?|my|the))?(?:\s+(?:reminder|event))?(?:\s+(?:for|to|on my calendar))?)/iu, '')
  .replace(/(?:நினைவூட்டு(?:ங்கள்)?|ஞாபகப்படுத்து(?:ங்கள்)?|ನೆನಪಿಸು(?:ತ್ತೀರಾ)?|ഓർമ്മിപ്പിക്കൂ|గుర్తు\s*చేయండి|గుర్తు\s*చెయ్యి)\s*[.?!]?$/iu, '')
  .replace(datePattern, ' ').replace(meridiemClock, ' ').replace(fixedClock, ' ');
 for (const expression of [...relative].reverse()) residue = residue.replace(expression, ' ');
 for (const expression of weekdays) residue = residue.replace(expression, ' ');
 for (const part of parts) residue = residue.replace(part.words, ' ');
 residue = residue.replace(/\b(?:to|at|on|for)\b\s*$|^[ ,.]+|[ ,.!?]+$/giu, '').trim();
 return residue && residue.length <= calendarTitleLimit ? residue : null;
}

const copy = {
 'en-IN': { title: 'What would you like me to add to the calendar?', date: 'Which date should I use?', time: 'What time should I use?', past: 'That time has passed. What new date and time should I use?', busy: 'There is already something scheduled then. What other time works?', recurring: 'Which one date and time should I use for this event?', stale: 'That draft changed. Open Calendar to review it.', preview: (details: string) => `Here’s the event to review: ${details}. Tap Save or choose a different time.`, saved: (details: string) => `Saved to your calendar: ${details}.`, existing: (details: string) => `Already on your calendar: ${details}.` },
 'ta-IN': { title: 'கால அட்டவணையில் என்ன சேர்க்க வேண்டும்?', date: 'எந்த தேதியில் சேர்க்க வேண்டும்?', time: 'எத்தனை மணிக்கு சேர்க்க வேண்டும்?', past: 'அந்த நேரம் கடந்துவிட்டது. வேறு எந்த தேதி, நேரத்தில் சேர்க்க வேண்டும்?', busy: 'அந்த நேரத்தில் இன்னொரு வேலை உள்ளது. வேறு எந்த நேரம் சரியாக இருக்கும்?', recurring: 'இந்த வேலைக்கு எந்த ஒரு தேதி, நேரத்தைச் சேர்க்க வேண்டும்?', stale: 'வரைவு மாறிவிட்டது. கால அட்டவணையில் பார்த்துக்கொள்ளுங்கள்.', preview: (details: string) => `சரிபார்க்க வேண்டிய வேலை: ${details}. சேமிக்கலாம் அல்லது நேரத்தை மாற்றலாம்.`, saved: (details: string) => `கால அட்டவணையில் சேர்த்துவிட்டேன்: ${details}.`, existing: (details: string) => `இது ஏற்கெனவே கால அட்டவணையில் உள்ளது: ${details}.` },
 'kn-IN': { title: 'ವೇಳಾಪಟ್ಟಿಗೆ ಏನು ಸೇರಿಸಲಿ?', date: 'ಯಾವ ದಿನಾಂಕಕ್ಕೆ ಸೇರಿಸಲಿ?', time: 'ಯಾವ ಸಮಯಕ್ಕೆ ಸೇರಿಸಲಿ?', past: 'ಆ ಸಮಯ ಕಳೆದಿದೆ. ಯಾವ ಹೊಸ ದಿನಾಂಕ ಮತ್ತು ಸಮಯ ಬಳಸಲಿ?', busy: 'ಆ ಸಮಯಕ್ಕೆ ಈಗಾಗಲೇ ಕೆಲಸವಿದೆ. ಬೇರೆ ಯಾವ ಸಮಯ ಸರಿಹೊಂದುತ್ತದೆ?', recurring: 'ಈ ಕೆಲಸಕ್ಕೆ ಒಂದು ದಿನಾಂಕ ಮತ್ತು ಸಮಯ ಹೇಳುತ್ತೀರಾ?', stale: 'ಕರಡು ಬದಲಾಗಿದೆ. ವೇಳಾಪಟ್ಟಿಯಲ್ಲಿ ಪರಿಶೀಲಿಸಿ.', preview: (details: string) => `ಪರಿಶೀಲಿಸಬೇಕಾದ ಕೆಲಸ: ${details}. ಉಳಿಸಿ ಅಥವಾ ಸಮಯವನ್ನು ಬದಲಿಸಿ.`, saved: (details: string) => `ವೇಳಾಪಟ್ಟಿಯಲ್ಲಿ ಉಳಿಸಿದೆ: ${details}.`, existing: (details: string) => `ಇದು ಈಗಾಗಲೇ ವೇಳಾಪಟ್ಟಿಯಲ್ಲಿದೆ: ${details}.` },
 'ml-IN': { title: 'കലണ്ടറിൽ എന്ത് ചേർക്കണം?', date: 'ഏത് തീയതി ഉപയോഗിക്കണം?', time: 'ഏത് സമയം ഉപയോഗിക്കണം?', past: 'ആ സമയം കഴിഞ്ഞു. പുതിയ തീയതിയും സമയവും പറയാമോ?', busy: 'ആ സമയത്ത് മറ്റൊരു ജോലിയുണ്ട്. വേറെ ഏത് സമയമാണ് വേണ്ടത്?', recurring: 'ഈ ജോലിക്ക് ഒരു തീയതിയും സമയവും പറയാമോ?', stale: 'കരട് മാറി. കലണ്ടറിൽ പരിശോധിക്കൂ.', preview: (details: string) => `പരിശോധിക്കാനുള്ള ജോലി: ${details}. സേവ് ചെയ്യുകയോ സമയം മാറ്റുകയോ ചെയ്യൂ.`, saved: (details: string) => `കലണ്ടറിൽ ചേർത്തു: ${details}.`, existing: (details: string) => `ഇത് ഇതിനകം കലണ്ടറിലുണ്ട്: ${details}.` },
 'te-IN': { title: 'క్యాలెండర్‌లో ఏ పని చేర్చాలి?', date: 'ఏ తేదీకి చేర్చాలి?', time: 'ఏ సమయానికి చేర్చాలి?', past: 'ఆ సమయం గడిచిపోయింది. కొత్త తేదీ, సమయం చెప్పగలరా?', busy: 'ఆ సమయంలో మరో పని ఉంది. ఏ ఇతర సమయం సరిపోతుంది?', recurring: 'ఈ పనికి ఒక తేదీ, సమయం చెప్పగలరా?', stale: 'ముసాయిదా మారింది. క్యాలెండర్‌లో చూడండి.', preview: (details: string) => `చూసుకోవాల్సిన పని: ${details}. సేవ్ చేయండి లేదా సమయాన్ని మార్చండి.`, saved: (details: string) => `క్యాలెండర్‌లో చేర్చాను: ${details}.`, existing: (details: string) => `ఇది ఇప్పటికే క్యాలెండర్‌లో ఉంది: ${details}.` },
};
const summary = (entry: CalendarEntry, locale: FarmLocale) => `${entry.title}, ${new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(Date.parse(entry.dueAt!))}`;
const overlapping = (a: string | undefined, b: string) => !!a && Math.floor(Date.parse(a) / 60_000) === Math.floor(Date.parse(b) / 60_000);
const busy = (state: FarmerState, dueAt: string, id: string) =>
 (state.calendarEntries ?? []).some(e => e.id !== id && e.status === 'saved' && overlapping(e.dueAt, dueAt)) ||
 state.tasks.some(t => t.status === 'approved' && Date.parse(t.validUntil) > Date.parse(dueAt) && overlapping(t.dueAt, dueAt));

export function draftCalendar(state: FarmerState, input: CalendarExtraction & { messageId: string; text: string; locale: FarmLocale; anchor: number; voice: boolean; pending?: Pick<CalendarEntry, 'id' | 'version'> }, now: number): { text: string; entry?: CalendarEntry; saved?: true } {
 const wording = copy[input.locale];
 const prior = input.pending && pendingCalendar(state);
 if (input.pending && (prior?.id !== input.pending.id || prior.version !== input.pending.version)) return { text: wording.stale };
 const title = prior?.title || input.title || '';
 const original = timingOf(input.text.replace(changePrefix, ''), input.anchor);
 const extracted = timingOf([input.dateText, input.timeText].filter(Boolean).join(' '), input.anchor);
 const timing = { localDate: original.localDate === undefined ? extracted.localDate : original.localDate, minuteOfDay: original.minuteOfDay === undefined ? extracted.minuteOfDay : original.minuteOfDay };
 const exact = original.exact && original.localDate != null && original.minuteOfDay != null &&
  (extracted.localDate === undefined || extracted.localDate === original.localDate) && (extracted.minuteOfDay === undefined || extracted.minuteOfDay === original.minuteOfDay);
 const localDate = timing.localDate === undefined ? prior?.localDate : timing.localDate ?? undefined;
 const minuteOfDay = timing.minuteOfDay === undefined ? prior?.minuteOfDay : timing.minuteOfDay ?? undefined;
 const intended = localDate && minuteOfDay !== undefined ? when(localDate, minuteOfDay) : undefined;
 const id = prior?.id ?? `event-${input.messageId}`;
 const entry: CalendarEntry = { id, version: (prior?.version ?? 0) + 1, fieldId: state.fieldId, cycleId: state.cycleId, contextVersion: state.version, title, localDate, minuteOfDay, status: 'draft', sourceMessageId: prior?.sourceMessageId ?? input.messageId };
 let text = wording.date;
 let saved: true | undefined;
 if (!title) text = wording.title;
 else if (recurring.test(input.text)) {
  text = wording.recurring;
  delete entry.localDate;
  delete entry.minuteOfDay;
 } else if (localDate && minuteOfDay === undefined) text = wording.time;
 else if (intended) {
  const duplicate = state.calendarEntries?.find(e => e.status === 'saved' && e.fieldId === state.fieldId && e.cycleId === state.cycleId && e.dueAt === intended && normalise(e.title).toLocaleLowerCase() === title.toLocaleLowerCase());
  if (duplicate) return { text: wording.existing(summary(duplicate, input.locale)), entry: duplicate };
  if (Date.parse(intended) <= now) {
   text = wording.past;
   delete entry.localDate;
   delete entry.minuteOfDay;
  } else if (busy(state, intended, id)) {
   text = wording.busy;
   delete entry.minuteOfDay;
  } else {
   entry.dueAt = intended;
   if (!input.voice && !prior && exact) { entry.status = 'saved'; saved = true; }
   text = (saved ? wording.saved : wording.preview)(summary(entry, input.locale));
  }
 }
 state.calendarEntries ??= [];
 const records = state.calendarEntries;
 if (prior) records[records.indexOf(prior)] = entry;
 else records.push(entry);
 event(state, saved ? 'calendar.saved' : 'calendar.draft', id, now);
 return { text, entry, saved };
}

export function actOnCalendar(state: FarmerState, id: string, version: number, action: CalendarAction, dueAt: string | undefined, now: number): CalendarEntry {
 const entry = state.calendarEntries?.find(e => e.id === id && e.fieldId === state.fieldId && e.cycleId === state.cycleId);
 if (!entry) throw new AppError('not_found', 'Calendar event was not found.', 404);
 if (entry.version !== version || entry.status === 'cancelled') throw new AppError('stale_version', 'The calendar event changed. Review the current calendar.', 409);
 if (!['save', 'change_time', 'undo'].includes(action)) throw new AppError('invalid_calendar_action', 'Unsupported calendar action.');
 if (action === 'undo') {
  if (entry.status !== 'saved') throw new AppError('calendar_not_saved', 'Only saved events can be undone.', 409);
  entry.status = 'cancelled';
  for (const reminder of state.notifications) if (reminder.purpose === 'calendar' && reminder.taskId === id && reminder.status === 'pending') {
   reminder.status = 'cancelled';
   event(state, 'notification.cancelled', reminder.id, now);
  }
 } else {
  if (entry.status !== 'draft' || entry.contextVersion !== state.version) throw new AppError('stale_version', 'Review a current calendar draft.', 409);
  if (!entry.title) throw new AppError('calendar_title_required', 'Say what you want to schedule first.', 409);
  if (action === 'save') dueAt = entry.dueAt;
  const instant = Date.parse(dueAt ?? '');
  if (!dueAt || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.test(dueAt) || !isDate(dueAt.slice(0, 10)) || !Number.isFinite(instant) || instant <= now) throw new AppError('invalid_calendar_time', 'Choose a future date and time.', 409);
  const normalized = iso(Math.floor(instant / 60_000) * 60_000);
  if (Date.parse(normalized) <= now) throw new AppError('invalid_calendar_time', 'Choose a future date and time.', 409);
  if (busy(state, normalized, id)) throw new AppError('calendar_time_conflict', 'Something is already scheduled then.', 409);
  entry.dueAt = normalized;
  entry.localDate = calendarLocalDate(instant);
  entry.minuteOfDay = Math.floor((instant + localOffset) % day / 60_000);
  if (action === 'save') entry.status = 'saved';
 }
 entry.version++;
 event(state, action === 'save' ? 'calendar.saved' : action === 'undo' ? 'calendar.cancelled' : 'calendar.changed', id, now);
 return entry;
}
