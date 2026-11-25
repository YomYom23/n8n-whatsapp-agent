'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const { earliestPerDay, stillAllowed, slotIdFor, startFromSlotId, slotLabel } = require('../slots');

const TZ = 'America/New_York';
const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri'].map((weekday) => ({ weekday, open: '09:00', close: '17:00' }));
const base = { hours: weekdays, durationMinutes: 60, gapMinutes: 30, minNoticeHours: 12, daysAhead: 14, count: 3, tz: TZ, DateTime };

// Mon 2026-01-05 06:00 New York = 11:00Z (EST, UTC-5)
const monMorning = '2026-01-05T11:00:00Z';

test('one slot per day on three days', () => {
  const r = earliestPerDay({ ...base, now: '2026-01-05T00:00:00Z' }); // Sun 7pm local
  assert.equal(r.length, 3);
  assert.deepEqual(r.map((s) => s.day), ['2026-01-05', '2026-01-06', '2026-01-07']);
  assert.equal(r[0].id, 'slot-20260105T1400Z'); // 9:00 EST
  assert.equal(r[0].label, 'Monday January 5 at 9 AM');
});

test('skips a closed Sunday (and Saturday)', () => {
  // Fri 2026-01-02 07:00 local + 12h notice is past closing, so Friday has nothing; Sat and Sun are closed.
  const r = earliestPerDay({ ...base, now: '2026-01-02T12:00:00Z' });
  assert.deepEqual(r.map((s) => s.day), ['2026-01-05', '2026-01-06', '2026-01-07']);
});

test('respects minimum notice', () => {
  // Mon 6:00 local + 12h = 18:00, past closing -> Monday has nothing
  const r = earliestPerDay({ ...base, now: monMorning });
  assert.equal(r[0].day, '2026-01-06');
  // Mon 05:30 local with 4h notice: 9:00 is too soon, so the first start is 10:30 local = 15:30Z.
  const r2 = earliestPerDay({ ...base, now: '2026-01-05T10:30:00Z', minNoticeHours: 4 });
  assert.equal(r2[0].id, 'slot-20260105T1530Z');
});

test('busy time removes slots it overlaps, including the gap', () => {
  const now = '2026-01-04T12:00:00Z';
  // busy 9:00-10:00 local Mon (14:00Z-15:00Z): 9:00 blocked; 10:30 slot block 10:30-12:00 is free
  const r = earliestPerDay({ ...base, now, busy: [{ start: '2026-01-05T14:00:00Z', end: '2026-01-05T15:00:00Z' }], count: 1 });
  assert.equal(r[0].label, 'Monday January 5 at 10:30 AM');
  // busy 10:00-10:15 sits in the gap of the 9:00 block (9:00-10:30) so it still blocks it
  const r2 = earliestPerDay({ ...base, now, busy: [{ start: '2026-01-05T15:00:00Z', end: '2026-01-05T15:15:00Z' }], count: 1 });
  assert.equal(r2[0].label, 'Monday January 5 at 10:30 AM');
});

test('a busy period ending exactly at a start does not block it', () => {
  const r = earliestPerDay({ ...base, now: '2026-01-04T12:00:00Z', count: 1,
    busy: [{ start: '2026-01-05T13:00:00Z', end: '2026-01-05T14:00:00Z' }] });
  assert.equal(r[0].id, 'slot-20260105T1400Z');
});

test('a fully busy day is skipped for the next day', () => {
  const r = earliestPerDay({ ...base, now: '2026-01-04T12:00:00Z', count: 2,
    busy: [{ start: '2026-01-05T00:00:00Z', end: '2026-01-06T00:00:00Z' }] });
  assert.deepEqual(r.map((s) => s.day), ['2026-01-06', '2026-01-07']);
});

test('afterDay starts after the given day', () => {
  const r = earliestPerDay({ ...base, now: '2026-01-04T12:00:00Z', afterDay: '2026-01-06' });
  assert.deepEqual(r.map((s) => s.day), ['2026-01-07', '2026-01-08', '2026-01-09']);
});

test('across the March DST change labels stay at local opening time', () => {
  // Thu 2026-03-05; DST starts Sun 2026-03-08. Fri Mar 6 is EST, Mon Mar 9 and Tue Mar 10 are EDT.
  const r = earliestPerDay({ ...base, now: '2026-03-05T12:00:00Z', afterDay: '2026-03-05' });
  assert.deepEqual(r.map((s) => s.day), ['2026-03-06', '2026-03-09', '2026-03-10']);
  assert.deepEqual(r.map((s) => s.label), [
    'Friday March 6 at 9 AM', 'Monday March 9 at 9 AM', 'Tuesday March 10 at 9 AM',
  ]);
  assert.deepEqual(r.map((s) => s.id), ['slot-20260306T1400Z', 'slot-20260309T1300Z', 'slot-20260310T1300Z']);
});

test('nothing within daysAhead gives an empty list; missing weekday is closed', () => {
  assert.deepEqual(earliestPerDay({ ...base, hours: [], now: monMorning }), []);
  const r = earliestPerDay({ ...base, hours: [{ weekday: 'wed', open: '10:00', close: '12:00' }], now: monMorning, count: 5 });
  assert.deepEqual(r.map((s) => s.day), ['2026-01-07', '2026-01-14']); // 14 days ahead ends 2026-01-19
});

test('slot must end by closing time and duration comes from the service', () => {
  const r = earliestPerDay({ ...base, hours: [{ weekday: 'mon', open: '09:00', close: '10:30' }], durationMinutes: 120, now: '2026-01-04T12:00:00Z' });
  assert.deepEqual(r, []);
  const r2 = earliestPerDay({ ...base, hours: [{ weekday: 'mon', open: '09:00', close: '11:00' }], durationMinutes: 120, now: '2026-01-04T12:00:00Z', count: 1 });
  assert.equal(r2.length, 1);
});

test('accepts Date objects for now and busy', () => {
  const r = earliestPerDay({ ...base, now: new Date('2026-01-04T12:00:00Z'), count: 1,
    busy: [{ start: new Date('2026-01-05T14:00:00Z'), end: new Date('2026-01-05T15:00:00Z') }] });
  assert.equal(r[0].label, 'Monday January 5 at 10:30 AM');
});

test('stillAllowed', () => {
  const now = '2026-01-05T12:00:00Z';
  assert.equal(stillAllowed({ slotId: 'slot-20260106T0000Z', now, minNoticeHours: 12 }), true); // exactly 12h
  assert.equal(stillAllowed({ slotId: 'slot-20260105T2359Z', now, minNoticeHours: 12 }), false);
  assert.equal(stillAllowed({ slotId: 'slot-20260101T1400Z', now, minNoticeHours: 12 }), false); // past
  assert.equal(stillAllowed({ slotId: 'nonsense', now, minNoticeHours: 12 }), false);
  assert.equal(stillAllowed({ slotId: 'slot-20261301T1400Z', now, minNoticeHours: 0 }), false);
});

test('slot id round trip and label', () => {
  const ms = Date.UTC(2026, 9, 5, 13, 30);
  assert.equal(slotIdFor(ms), 'slot-20261005T1330Z');
  assert.equal(startFromSlotId('slot-20261005T1330Z'), ms);
  assert.equal(slotLabel(DateTime.fromMillis(ms, { zone: TZ })), 'Monday October 5 at 9:30 AM');
  assert.equal(slotLabel(DateTime.fromISO('2026-10-05T12:00', { zone: TZ })), 'Monday October 5 at 12 PM');
  assert.equal(slotLabel(DateTime.fromISO('2026-10-04T00:15', { zone: TZ })), 'Sunday October 4 at 12:15 AM');
});
