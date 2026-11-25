'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../config');
const q = require('../questions');

const services = [
  { service: 'Regular clean', aliases: 'standard clean;weekly clean', unit: 'hour', amount: 35, duration_minutes: 120, bookable: 'yes' },
  { service: 'Deep clean', aliases: '', unit: 'fixed', amount: 120, duration_minutes: 240, bookable: 'yes' },
  { service: 'Oven clean', aliases: '', unit: 'fixed', amount: 60, duration_minutes: 60, bookable: 'yes' },
  { service: 'Window quote', aliases: '', unit: 'fixed', amount: 0, duration_minutes: 0, bookable: 'no' },
];
const slots = [
  { id: 'slot-20260301T1500Z', label: 'Mon 10:00 AM' },
  { id: 'slot-20260302T1500Z', label: 'Tue 10:00 AM' },
  { id: 'slot-20260303T1500Z', label: 'Wed 10:00 AM' },
];

test('hazard questions are noul with true and false criteria', () => {
  const h = q.hazardQuestions();
  assert.deepEqual(Object.keys(h), config.HAZARD_ORDER);
  for (const v of Object.values(h)) {
    assert.equal(v.type, 'noul');
    assert.equal(typeof v.instructions, 'string');
    assert.deepEqual(Object.keys(v.criteria).sort(), ['false', 'true']);
  }
  assert.match(h.prompt_injection.instructions, /change the assistant's instructions/);
});

test('new stage: bookable services only, plus just_asking and the escapes', () => {
  const set = q.stageQuestions({ stage: 'new', services });
  assert.deepEqual(Object.keys(set), [...config.HAZARD_ORDER, 'answer', 'price_service', 'price_hours']);
  const options = Object.keys(set.answer.criteria);
  assert.deepEqual(options.slice(0, 4), ['regular_clean', 'deep_clean', 'oven_clean', 'just_asking']);
  assert.deepEqual(options.slice(4), config.ESCAPE_OPTIONS);
  assert.equal(set.answer.type, 'choice');
});

test('price_service lists every sheet service plus not_stated; price_hours is 1..8 plus not_stated', () => {
  const set = q.stageQuestions({ stage: 'new', services });
  assert.deepEqual(Object.keys(set.price_service.criteria), ['regular_clean', 'deep_clean', 'oven_clean', 'window_quote', 'not_stated']);
  assert.deepEqual(Object.keys(set.price_hours.criteria), ['1', '2', '3', '4', '5', '6', '7', '8', 'not_stated']);
});

test('address stage asks hazards only', () => {
  const set = q.stageQuestions({ stage: 'address', services });
  assert.deepEqual(Object.keys(set), config.HAZARD_ORDER);
});

test('offer stage: slot IDs, none, then the escapes', () => {
  const set = q.stageQuestions({ stage: 'offer', services, offeredSlots: slots });
  assert.deepEqual(Object.keys(set.answer.criteria), [...slots.map((s) => s.id), 'none', ...config.ESCAPE_OPTIONS]);
  assert.equal(set.answer.criteria[slots[1].id], '2) Tue 10:00 AM');
});

test('booked stage: thanks and change_booking', () => {
  const set = q.stageQuestions({ stage: 'booked', services });
  assert.deepEqual(Object.keys(set.answer.criteria).slice(0, 2), ['thanks', 'change_booking']);
});

test('a slot option named like an escape (or none) throws', () => {
  for (const id of ['repeat', 'none', 'unclear']) {
    assert.throws(
      () => q.stageQuestions({ stage: 'offer', services, offeredSlots: [{ id, label: 'x' }] }),
      /reserved option id/
    );
  }
});

test('a service whose ID equals an escape name throws', () => {
  const bad = [...services, { service: 'Later', aliases: '', unit: 'fixed', amount: 1, duration_minutes: 1, bookable: 'yes' }];
  assert.throws(() => q.stageQuestions({ stage: 'new', services: bad }), /reserved option id/);
});

test('closed and unknown stages have no question set', () => {
  assert.throws(() => q.stageQuestions({ stage: 'closed', services }), /no classifier questions/);
  assert.throws(() => q.stageQuestions({ stage: 'bogus', services }), /no classifier questions/);
});

test('choice questions stay within 2..255 options', () => {
  const many = Array.from({ length: 260 }, (_, i) => ({ id: 'slot-' + i, label: 'x' }));
  assert.throws(() => q.stageQuestions({ stage: 'offer', services, offeredSlots: many }), /2 to 255/);
});

test('draft-check set has the five Jev problems and its state keys', () => {
  const set = q.draftCheckQuestions();
  assert.deepEqual(Object.keys(set), config.DRAFT_JEV_PROBLEMS);
  for (const v of Object.values(set)) assert.equal(v.type, 'noul');
  assert.deepEqual(q.DRAFT_CHECK_STATE_KEYS, ['FACTS', 'CUSTOMER_QUESTION', 'REPLY']);
  assert.deepEqual(q.draftCheckState('f', 'c', 'r'), { FACTS: 'f', CUSTOMER_QUESTION: 'c', REPLY: 'r' });
});

test('owner-spoke-last line', () => {
  assert.equal(
    q.ownerSpokeLastLine('Which clean would you like?'),
    'The conversation was with a person; the bot last asked: Which clean would you like?'
  );
});

test('serviceId slugs sheet names', () => {
  assert.equal(q.serviceId('Deep clean'), 'deep_clean');
  assert.equal(q.serviceId(' Oven  Clean! '), 'oven_clean');
});
