'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { codeProblems, blocking, guardId } = require('../draft_checks');

const prices = [{ service: 'Deep clean', aliases: [], unit: 'fixed', amountCents: 12000, durationMinutes: 240, bookable: true }];
const facts = 'Deep clean: $120\nWe are open 9 to 5.';

test('codeProblems: clean draft', () => {
  assert.deepEqual(codeProblems('A deep clean is $120.', prices, null, facts), []);
});

test('codeProblems: empty and too_long', () => {
  assert.deepEqual(codeProblems('   ', prices, null, facts), ['empty']);
  assert.deepEqual(codeProblems('a'.repeat(600), prices, null, facts), []);
  assert.deepEqual(codeProblems('a'.repeat(601), prices, null, facts), ['too_long']);
});

test('codeProblems: promises_follow_up', () => {
  for (const d of ["I'll pass that to the team.", 'Someone will call you.', 'Our team will get back to you.', 'Let me forward this to the office.']) {
    assert.deepEqual(codeProblems(d, prices, null, facts), ['promises_follow_up'], d);
  }
  assert.deepEqual(codeProblems('We clean kitchens.', prices, null, facts), []);
});

test('codeProblems: price_mismatch and unknown_number', () => {
  assert.deepEqual(codeProblems('A deep clean costs $35.', prices, null, facts + ' 35'), ['price_mismatch']);
  assert.deepEqual(codeProblems('It is 99/hr', prices, null, facts), ['unknown_number']);
});

test('guardId maps problems to the section 13 guard IDs', () => {
  assert.equal(guardId('empty'), 'dc_empty');
  assert.equal(guardId('too_long'), 'dc_too_long');
  assert.equal(guardId('promises_follow_up'), 'dc_follow_up');
  assert.equal(guardId('price_mismatch'), 'dc_price');
  assert.equal(guardId('unknown_number'), 'dc_unknown_number');
  assert.equal(guardId('unsupported_fact'), 'dc_unsupported_fact');
  assert.equal(guardId('leaks_rules'), 'dc_leaks_rules');
});

const all = ['dc_unsupported_fact', 'dc_claims_action', 'dc_promise', 'dc_leaks_rules', 'dc_off_brand', 'dc_empty', 'dc_too_long', 'dc_follow_up', 'dc_price', 'dc_unknown_number'];

test('blocking: Jev threshold is 0.3 inclusive', () => {
  assert.deepEqual(blocking({ unsupported_fact: 0.29, promise: 0.3 }, [], all), ['promise']);
  assert.deepEqual(blocking({ off_brand: 0.9 }, [], all), ['off_brand']);
  assert.deepEqual(blocking({}, [], all), []);
});

test('blocking: code problems block, and a removed guard does not', () => {
  assert.deepEqual(blocking({}, ['price_mismatch', 'empty'], all), ['price_mismatch', 'empty']);
  assert.deepEqual(blocking({ promise: 0.8 }, ['price_mismatch'], all.filter((g) => g !== 'dc_price' && g !== 'dc_promise')), []);
  assert.deepEqual(blocking({}, ['promises_follow_up'], all.filter((g) => g !== 'dc_follow_up')), []);
});

test('blocking: omitted enabled list means every guard is on', () => {
  assert.deepEqual(blocking({ leaks_rules: 0.5 }, ['too_long']), ['leaks_rules', 'too_long']);
});
