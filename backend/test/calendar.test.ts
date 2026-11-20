import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { openFarmRuntime, type FarmRuntime } from '../src/runtime.js';
import { calendarWindow, draftCalendar, isCalendarCreate, isCalendarCorrection } from '../src/calendar.js';
import { emptyFarmer } from '../src/domain.js';
import { fixtures, owner, waitState } from './support/fixtures.js';

const clock = Date.parse('2026-11-20T18:29:50Z');
const replyTo = async (app: FarmRuntime, id: string) => {
 const state = await waitState(app, candidate => candidate.messages.some(message => message.id === `reply-${id}` || (message.id === id && message.status === 'failed')));
 const reply = state.messages.find(message => message.id === `reply-${id}`);
 assert.ok(reply, JSON.stringify(state.messages));
 return { state, reply };
};

test('an exact typed request saves one event and idempotent Undo cancels its pending reminder', async () => {
 const dir = await mkdtemp('/tmp/kalani-calendar-');
 const roles: string[] = [];
 const options = fixtures(dir, { now: () => clock, testReasoner: async (role, packet) => {
  roles.push(role);
  assert.match(JSON.parse(packet).question, /check the pump/);
  return JSON.stringify({ title: 'check the pump' });
 } });
 const app = await openFarmRuntime(options);
 try {
  await app.preferences(owner, { requestId: 'en-calendar-language', locale: 'en-IN', notifications: true });
  const ask = { requestId: 'calendar-pump-english', text: 'Remind me tomorrow at 7 a.m. to check the pump' };
  const id = await app.submit(owner, ask);
  assert.equal(await app.submit(owner, ask), id);
  const { state, reply } = await replyTo(app, id);
  assert.deepEqual(roles, ['calendar-draft']);
  assert.match(reply.text, /Saved to your calendar.*check the pump.*21 November 2026.*7:00 am/i);
  assert.equal(state.calendarEntries?.length, 1);
  const [entry] = state.calendarEntries!;
  assert.equal(reply.calendarEntryId, entry.id);
  assert.equal(entry.dueAt, '2026-11-21T01:30:00.000Z');
  assert.equal(entry.status, 'saved');
  assert.equal(state.tasks.length, 0);
  assert.equal(state.notifications.find(n => n.taskId === entry.id)?.status, 'pending');
  await assert.rejects(app.calendarAction('other-farmer', entry.id, { requestId: 'other-calendar-undo', version: entry.version, action: 'undo' }), { code:'not_found' });
  const undo = { requestId: 'calendar-undo-english', version: entry.version, action: 'undo' } as const;
  await app.calendarAction(owner, entry.id, undo);
  await app.calendarAction(owner, entry.id, undo);
  const cancelled = await app.state(owner);
  assert.equal(cancelled.calendarEntries?.[0]?.status, 'cancelled');
  assert.equal(cancelled.notifications.find(n => n.taskId === entry.id)?.status, 'cancelled');
  assert.equal(cancelled.events.filter(e => e.type === 'calendar.cancelled').length, 1);
 } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});

test('a Tamil voice preview survives restart; spoken correction updates its version before Save', async () => {
 const dir = await mkdtemp('/tmp/kalani-calendar-');
 const base = fixtures(dir);
 let transcript = 'நாளை காலை தண்ணீர் பம்பைப் பார்க்க நினைவூட்டு.';
 const options = fixtures(dir, { now: () => clock, speech: { ...base.speech!, transcribe: async () => ({ text: transcript, language: 'ta-IN' }) },
  testReasoner: async () => JSON.stringify({ title: 'தண்ணீர் பம்பைப் பார்க்க' }) });
 let app = await openFarmRuntime(options);
 try {
  const audio = await app.upload(owner, 'calendar-tamil-recording', Buffer.from('synthetic AAC 1'), 'audio/mp4');
  const id = await app.submit(owner, { requestId: 'calendar-tamil-submit', audioId: audio });
  const { state, reply } = await replyTo(app, id);
  const entry = state.calendarEntries?.[0];
  assert.ok(entry);
  assert.equal(entry.status, 'draft');
  assert.equal(entry.dueAt, '2026-11-21T02:30:00.000Z');
  assert.match(reply.text, /சரிபார்க்க வேண்டிய வேலை.*தண்ணீர் பம்பைப் பார்க்க/u);
  await app.close();

  app = await openFarmRuntime(options);
  transcript = 'நேரத்தை மாற்று நாளை மாலை';
  const correction = await app.upload(owner, 'calendar-tamil-correction-recording', Buffer.from('synthetic AAC 2'), 'audio/mp4');
  const corrected = await app.submit(owner, { requestId: 'calendar-tamil-correction', audioId: correction });
  const after = await replyTo(app, corrected);
  const revised = after.state.calendarEntries?.[0];
  assert.ok(revised);
  assert.equal(revised.id, entry.id);
  assert.equal(revised.version, 2);
  assert.equal(revised.status, 'draft');
  assert.equal(revised.dueAt, '2026-11-21T11:30:00.000Z');
  await assert.rejects(app.calendarAction(owner, entry.id, { requestId: 'stale-calendar-save', version: 1, action: 'save' }), { code: 'stale_version' });
  const saved = await app.calendarAction(owner, entry.id, { requestId: 'calendar-tamil-save', version: 2, action: 'save' });
  assert.equal(saved.calendarEntries?.[0]?.status, 'saved');
  assert.equal(saved.tasks.length, 0);
 } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});

test('calendar date boundaries, exactness, conflicts, and duplicate event requests', () => {
 assert.deepEqual(calendarWindow('What is on my calendar tomorrow?', clock), { start:'2026-11-21', days:1 });
 assert.deepEqual(calendarWindow('What is on my calendar tomorrow?', clock + 20_000), { start:'2026-11-22', days:1 });
 assert.deepEqual(calendarWindow('Show my calendar on Monday', clock), { start:'2026-11-23', days:1 });
 assert.equal(isCalendarCreate('When should I check the pump?'), false);
 assert.equal(isCalendarCorrection('Will it rain tomorrow?', clock), false);
 const state = emptyFarmer();
 const event = (messageId:string, text:string, title='check pump', voice = false) =>
  draftCalendar(state,{messageId,text,locale:'en-IN',title,voice,anchor:clock},clock);

 assert.equal(event('first','Remind me tomorrow at 07:00 to check pump').saved, true);
 const duplicate = event('second','Remind me tomorrow at 7 am to check pump');
 assert.match(duplicate.text, /Already on your calendar/);
 assert.equal(state.calendarEntries?.length, 1);
 const conflict = event('conflict','Remind me tomorrow at 7 am to visit co-op','visit co-op');
 assert.match(conflict.text, /already something scheduled/i);
 assert.equal(conflict.entry?.dueAt, undefined);
 assert.equal(event('past','Remind me today at 7 a.m. to check pump').entry?.dueAt, undefined);
 assert.equal(event('ambiguous','Remind me tomorrow or Monday at 7 am to check pump').entry?.dueAt, undefined);
 assert.equal(event('weekday','Remind me next Monday at 7 am to check pump').entry?.dueAt,'2026-11-23T01:30:00.000Z');
 assert.equal(event('preview','Remind me tomorrow morning to check pump','check pump',true).entry?.status,'draft');
});

test('a missing activity follows one clarification and keeps the farmer’s original timing', async () => {
 const dir = await mkdtemp('/tmp/kalani-calendar-');
 const app = await openFarmRuntime(fixtures(dir, { now: () => clock, testReasoner: async () => JSON.stringify({title:null}) }));
 try {
  await app.preferences(owner, { requestId: 'missing-title-locale', locale: 'en-IN' });
  const first = await app.submit(owner, { requestId:'missing-title-calendar', text:'Remind me tomorrow at 7am' });
  const asked = await replyTo(app, first);
  assert.match(asked.reply.text, /What would you like me to add/);
  const second = await app.submit(owner, { requestId:'fill-title-calendar', text:'Check pump 2' });
  const answered = await replyTo(app, second);
  assert.match(answered.reply.text, /Review: Check pump 2/i);
  assert.equal(answered.reply.calendarEntryId, asked.reply.calendarEntryId);
  assert.equal(answered.state.calendarEntries?.[0]?.title, 'Check pump 2');
  assert.equal(answered.state.calendarEntries?.[0]?.dueAt, '2026-11-21T01:30:00.000Z');
  assert.equal(answered.state.calendarEntries?.[0]?.status, 'draft');
 } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});
