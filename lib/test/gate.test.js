'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { keyword, isExplicitOptOut, numberPick } = require('../gate');

test('keyword: stop forms', () => {
  for (const t of ['STOP', 'Stop', ' stop ', 'STOPALL', 'unsubscribe', 'QUIT', 'revoke', 'OptOut']) {
    assert.equal(keyword(t), 'stop', t);
  }
});

test('keyword: start forms', () => {
  assert.equal(keyword('UNSTOP'), 'start');
  assert.equal(keyword('start'), 'start');
});

test('keyword: CANCEL and END are not keywords, and punctuation or extra words disqualify', () => {
  for (const t of ['cancel', 'END', 'Stop.', 'cancel my booking', 'stop please', '']) {
    assert.equal(keyword(t), null, t);
  }
});

test('isExplicitOptOut: true cases', () => {
  for (const t of [
    'Stop.', 'please stop messaging me', 'stop texting me', 'STOP PLEASE', 'unsubscribe me',
    'remove me from your list', "don't text me again", 'take me off your list',
    'don’t text me again', 'no more messages',
  ]) {
    assert.equal(isExplicitOptOut(t), true, t);
  }
});

test('isExplicitOptOut: ordinary uses of stop are not opt-outs', () => {
  for (const t of ['can you stop by Tuesday', 'the water stopped', 'no', 'Tuesday works', "I'm not interested in the oven clean, just a regular one"]) {
    assert.equal(isExplicitOptOut(t), false, t);
  }
});

test('numberPick: accepted forms', () => {
  for (const t of ['2', '#2', '2.', 'option 2', ' 2 ', 'number 2', 'Option 2']) {
    assert.equal(numberPick(t, 3), 2, t);
  }
});

test('numberPick: out of range, multi-digit and sentences are null', () => {
  assert.equal(numberPick('4', 3), null);
  assert.equal(numberPick('0', 3), null);
  assert.equal(numberPick('22', 3), null);
  assert.equal(numberPick('2 kids will be home', 3), null);
  assert.equal(numberPick('2', 0), null);
});
