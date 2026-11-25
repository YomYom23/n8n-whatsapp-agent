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
