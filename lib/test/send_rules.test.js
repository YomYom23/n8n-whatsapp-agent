'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decide, within24h } = require('../send_rules');

const NOW = '2026-03-10T12:00:00Z';
const FRESH = '2026-03-10T08:00:00Z';
const STALE = '2026-03-09T11:59:00Z';
const conv = (o = {}) => ({ human_owned: false, last_customer_at: FRESH, ...o });
const run = (o) => decide({ onDnc: false, addedThisRun: false, now: NOW, ...o });

test('within24h', () => {
  assert.equal(within24h('2026-03-09T12:00:00Z', NOW), true); // exactly 24h
  assert.equal(within24h(STALE, NOW), false);
  assert.equal(within24h(new Date(FRESH), new Date(NOW)), true);
  assert.equal(within24h(null, NOW), false);
  assert.equal(within24h('', NOW), false);
});

// Row: do-not-contact
test('dnc: bot normal dropped, owner normal dropped and thread told, template dropped and thread told', () => {
  assert.deepEqual(run({ conversation: conv(), onDnc: true, senderKind: 'bot', kind: 'normal' }), { action: 'drop', reason: 'dnc' });
  assert.deepEqual(run({ conversation: conv({ human_owned: true }), onDnc: true, senderKind: 'owner', kind: 'normal' }), { action: 'drop', reason: 'dnc', notifyThread: true });
  assert.deepEqual(run({ conversation: conv({ human_owned: true }), onDnc: true, senderKind: 'owner', kind: 'template' }), { action: 'drop', reason: 'dnc', notifyThread: true });
});

test('dnc: opt_out_confirmation sent only in the run that added the number', () => {
  assert.equal(run({ conversation: conv(), onDnc: true, addedThisRun: true, senderKind: 'bot', kind: 'opt_out_confirmation' }).action, 'send');
  const later = run({ conversation: conv(), onDnc: true, addedThisRun: false, senderKind: 'bot', kind: 'opt_out_confirmation' });
  assert.equal(later.action, 'drop');
});

// Row: conversation with the owner
test('with the owner: bot normal dropped, owner normal required, confirmation and template sent', () => {
  assert.deepEqual(run({ conversation: conv({ human_owned: true }), senderKind: 'bot', kind: 'normal' }), { action: 'drop', reason: 'human_owned' });
  assert.deepEqual(run({ conversation: conv({ human_owned: true }), senderKind: 'owner', kind: 'normal' }), { action: 'send' });
  assert.equal(run({ conversation: conv({ human_owned: true }), addedThisRun: true, senderKind: 'bot', kind: 'opt_out_confirmation' }).action, 'send');
  assert.equal(run({ conversation: conv({ human_owned: true }), senderKind: 'owner', kind: 'template' }).action, 'send');
});

test('not with the owner: owner normal is not sent and the thread is told', () => {
  assert.deepEqual(run({ conversation: conv(), senderKind: 'owner', kind: 'normal' }), { action: 'drop', reason: 'not_with_owner', notifyThread: true });
});

test('not with the owner: bot normal sent with the draft check', () => {
  assert.deepEqual(run({ conversation: conv(), senderKind: 'bot', kind: 'normal' }), { action: 'send', draftCheck: true });
});

test('opt_out_confirmation and template are not draft-checked', () => {
  assert.equal(run({ conversation: conv(), addedThisRun: true, senderKind: 'bot', kind: 'opt_out_confirmation' }).draftCheck, undefined);
  assert.equal(run({ conversation: conv(), senderKind: 'owner', kind: 'template' }).draftCheck, undefined);
  assert.equal(run({ conversation: conv({ human_owned: true }), senderKind: 'owner', kind: 'normal' }).draftCheck, undefined);
});

// Row: older than 24 hours
test('older than 24h: bot dropped, owner waits with buttons, template sent, confirmation sent', () => {
  assert.deepEqual(run({ conversation: conv({ last_customer_at: STALE }), senderKind: 'bot', kind: 'normal' }), { action: 'drop', reason: 'outside_24h' });
  assert.deepEqual(run({ conversation: conv({ last_customer_at: STALE, human_owned: true }), senderKind: 'owner', kind: 'normal' }),
    { action: 'wait', reason: 'outside_24h', notifyThread: true, offerButtons: true });
  assert.equal(run({ conversation: conv({ last_customer_at: STALE, human_owned: true }), senderKind: 'owner', kind: 'template' }).action, 'send');
  assert.equal(run({ conversation: conv({ last_customer_at: STALE }), addedThisRun: true, senderKind: 'bot', kind: 'opt_out_confirmation' }).action, 'send');
});

test('within 24h and owned: owner normal sent', () => {
  assert.equal(run({ conversation: conv({ human_owned: true }), senderKind: 'owner', kind: 'normal' }).action, 'send');
});

test('unknown sender or kind throws', () => {
  assert.throws(() => run({ conversation: conv(), senderKind: 'x', kind: 'normal' }));
  assert.throws(() => run({ conversation: conv(), senderKind: 'bot', kind: 'x' }));
});
