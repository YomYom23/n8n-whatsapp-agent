'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { eventId, afterChecks, onTaken } = require('../booking');

test('eventId is stable, differs per slot and is lowercase hex', () => {
  const a = eventId('15551234567', 'slot-20260310T1300Z', crypto);
  assert.equal(a, eventId('15551234567', 'slot-20260310T1300Z', crypto));
  assert.notEqual(a, eventId('15551234567', 'slot-20260310T1400Z', crypto));
  assert.notEqual(a, eventId('15559999999', 'slot-20260310T1300Z', crypto));
  assert.match(a, /^[0-9a-f]{64}$/);
  const expected = crypto.createHash('sha256').update('booking:15551234567:slot-20260310T1300Z').digest('hex');
  assert.equal(a, expected);
});

test('afterChecks', () => {
  assert.equal(afterChecks({ existing: { status: 'confirmed' }, allowed: false, free: false }), 'already_booked');
  assert.equal(afterChecks({ existing: { status: 'tentative' }, allowed: true, free: true }), 'already_booked');
  assert.equal(afterChecks({ existing: { status: 'cancelled' }, allowed: true, free: true }), 'key_deleted');
  assert.equal(afterChecks({ existing: null, allowed: false, free: true }), 'taken');
  assert.equal(afterChecks({ existing: null, allowed: true, free: false }), 'taken');
  assert.equal(afterChecks({ existing: undefined, allowed: true, free: true }), 'book');
});

test('onTaken: fresh times once, then slots_exhausted', () => {
  const first = onTaken({ slot_taken_count: 0 });
  assert.equal(first.reply, 'offer_times');
  assert.equal(first.updates.slot_taken_count, 1);
  assert.equal(first.updates.offered_slots, '[]');
  const missing = onTaken({});
  assert.equal(missing.reply, 'offer_times');
  assert.equal(missing.updates.slot_taken_count, 1);
  const second = onTaken({ slot_taken_count: 1 });
  assert.equal(second.reply, 'handoff:slots_exhausted');
  assert.equal(second.updates.slot_taken_count, 2);
  assert.equal('offered_slots' in second.updates, false);
});

const { DateTime } = require('luxon');
const { durationFor, offerReply, bookedReply } = require('../booking');

test('afterChecks: each check is skipped when its guard is left out of enabled', () => {
  const existing = { status: 'confirmed' };
  assert.equal(afterChecks({ existing, allowed: true, free: false, enabled: ['book_allowed', 'book_free'] }), 'taken');
  assert.equal(afterChecks({ existing: null, allowed: false, free: true, enabled: ['book_already', 'book_free'] }), 'book');
  assert.equal(afterChecks({ existing: null, allowed: true, free: false, enabled: ['book_already', 'book_allowed'] }), 'book');
  assert.equal(afterChecks({ existing, allowed: true, free: true, enabled: ['book_already', 'book_allowed', 'book_free'] }), 'already_booked');
});

const TZ = 'America/New_York';
const hours = ['mon', 'tue', 'wed', 'thu', 'fri'].map((weekday) => ({ weekday, open: '09:00', close: '17:00' }));
const services = [{ service: 'Deep clean', duration_minutes: '240' }, { service: 'Regular clean', duration_minutes: '180' }];

test('durationFor: by service name, case-insensitive; unknown is null', () => {
  assert.equal(durationFor(services, 'deep clean'), 240);
  assert.equal(durationFor(services, 'Oven clean'), null);
});

test('offerReply: three numbered times, stored with the last offered day; later starts after it', () => {
  const now = '2026-01-04T12:00:00Z'; // Sunday
  const r = offerReply({ mode: 'offer', conversation: {}, busy: [], hours, durationMinutes: 240, now, tz: TZ, DateTime, updates: { stage: 'offer' } });
  assert.equal(r.action, 'send');
  assert.match(r.text, /^Here are the next times we have open:\n1\) Monday January 5 at 9 AM\n2\) /);
  assert.equal(r.question, r.text);
  assert.equal(r.updates.stage, 'offer');
  assert.equal(JSON.parse(r.updates.offered_slots).length, 3);
  assert.equal(r.updates.last_offered_day, '2026-01-07');
  const later = offerReply({ mode: 'later', conversation: { last_offered_day: '2026-01-07T00:00:00.000Z' }, busy: [], hours,
    durationMinutes: 240, now, tz: TZ, DateTime, updates: {} });
  assert.match(later.text, /^Here are some later times\./);
  assert.equal(JSON.parse(later.updates.offered_slots)[0].day, '2026-01-08');
});

test('offerReply: no free time left hands off with slots_exhausted', () => {
  const busy = [{ start: '2026-01-01T00:00:00Z', end: '2026-02-01T00:00:00Z' }];
  const r = offerReply({ mode: 'offer', conversation: {}, busy, hours, durationMinutes: 240, now: '2026-01-04T12:00:00Z', tz: TZ, DateTime });
  assert.deepEqual(r, { action: 'handoff', reason: 'slots_exhausted', updates: {} });
});

test('bookedReply: confirms the time in the business time zone and stores the event', () => {
  const r = bookedReply({ slotId: 'slot-20260105T1400Z', eventId: 'abc', tz: TZ, DateTime, updates: { stage: 'booked' } });
  assert.equal(r.text, "You're booked for Monday January 5 at 9 AM. Thanks, see you then!");
  assert.deepEqual(r.updates, { stage: 'booked', booked_event_id: 'abc', booked_label: 'Monday January 5 at 9 AM' });
});
