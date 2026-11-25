'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRequest, buildFacts, isNotInFacts } = require('../writer_prompt');

const base = {
  model: 'test-model',
  maxTokens: 300,
  factsText: 'We clean on weekdays.',
  priceLines: ['Deep clean: $120'],
  conversation: { service: 'deep_clean', address: '12 Main St 10001', bookedTime: null },
  history: [],
  question: 'Do you clean on Sunday?',
};

test('request shape: model and max_tokens come from the input, no tools', () => {
  const r = buildRequest(base);
  assert.equal(r.model, 'test-model');
  assert.equal(r.max_tokens, 300);
  assert.equal('tools' in r, false);
  assert.deepEqual(r.messages, [{ role: 'user', content: 'Do you clean on Sunday?' }]);
});

test('system prompt carries the rules and every fact', () => {
  const s = buildRequest(base).system;
  assert.match(s, /NOT_IN_FACTS/);
  assert.match(s, /600 characters/);
  assert.match(s, /We clean on weekdays\./);
  assert.match(s, /Deep clean: \$120/);
  assert.match(s, /Address: 12 Main St 10001/);
  assert.match(s, /Nothing is booked yet\./);
  const booked = buildRequest({ ...base, conversation: { service: 'x', address: 'y', bookedTime: 'Mon 9 AM' } }).system;
  assert.match(booked, /Booked time: Mon 9 AM/);
});

test('price section is left out when there are no price lines', () => {
  assert.doesNotMatch(buildFacts({ ...base, priceLines: [] }), /Approved prices/);
  assert.equal(buildRequest(base).system.includes(buildFacts(base)), true);
});

test('history: last 6, alternating, opens with user, current question not duplicated', () => {
  const history = [];
  for (let i = 1; i <= 10; i++) history.push({ role: i % 2 ? 'user' : 'assistant', text: 'm' + i });
  history.push({ role: 'user', text: 'Do you clean on Sunday?' });
  const m = buildRequest({ ...base, history }).messages;
  assert.equal(m[0].role, 'user');
  assert.equal(m[m.length - 1].content, 'Do you clean on Sunday?');
  assert.equal(m[m.length - 1].role, 'user');
  for (let i = 1; i < m.length; i++) assert.notEqual(m[i].role, m[i - 1].role);
  assert.equal(m.filter((x) => x.content === 'Do you clean on Sunday?').length, 1);
  assert.ok(!m.some((x) => x.content.includes('m4')));
});

test('history: consecutive same-role messages merge, owner counts as assistant', () => {
  const m = buildRequest({
    ...base,
    history: [{ role: 'customer', text: 'a' }, { role: 'customer', text: 'b' }, { role: 'owner', text: 'c' }],
  }).messages;
  assert.deepEqual(m, [
    { role: 'user', content: 'a\nb' },
    { role: 'assistant', content: 'c' },
    { role: 'user', content: 'Do you clean on Sunday?' },
  ]);
});

test('isNotInFacts', () => {
  assert.equal(isNotInFacts('NOT_IN_FACTS'), true);
  assert.equal(isNotInFacts('  NOT_IN_FACTS.\n'), true);
  assert.equal(isNotInFacts('"not_in_facts"'), true);
  assert.equal(isNotInFacts('Sorry, NOT_IN_FACTS'), true);
  assert.equal(isNotInFacts('We clean on weekdays.'), false);
  assert.equal(isNotInFacts(''), false);
});
