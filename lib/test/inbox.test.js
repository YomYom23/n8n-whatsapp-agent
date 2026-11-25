'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { leaseDecision, holdsLease, stuckRows, nextAction, keepLooping } = require('../inbox');

const NOW = '2026-12-01T15:00:00.000Z';
const plus = (s) => new Date(Date.parse(NOW) + s * 1000).toISOString();

test('leaseDecision: takes a missing, empty or expired lease, 60 s ahead', () => {
  for (const row of [null, { holder: '', expires_at: plus(30) }, { holder: 'x', expires_at: plus(-1) }, { holder: 'x', expires_at: NOW }, { holder: 'x', expires_at: null }]) {
    assert.deepEqual(leaseDecision(row, 'e1', NOW), { take: true, expires_at: plus(60) }, JSON.stringify(row));
  }
});

test('leaseDecision: renews its own lease and leaves a live lease of another execution alone', () => {
  assert.equal(leaseDecision({ holder: 'e1', expires_at: plus(30) }, 'e1', NOW).take, true);
  assert.deepEqual(leaseDecision({ holder: 'e2', expires_at: plus(30) }, 'e1', NOW), { take: false });
  assert.equal(leaseDecision({ holder: 42, expires_at: plus(30) }, '42', NOW).take, true);
});

test('leaseDecision: accepts a Date and refuses a bad clock', () => {
  assert.equal(leaseDecision(null, 'e1', new Date(NOW)).expires_at, plus(60));
  assert.throws(() => leaseDecision(null, 'e1', 'not a time'));
});

test('holdsLease: only the execution whose ID was read back', () => {
  assert.equal(holdsLease({ holder: 'e1' }, 'e1'), true);
  assert.equal(holdsLease({ holder: 'e2' }, 'e1'), false);
  assert.equal(holdsLease(null, 'e1'), false);
});

test('stuckRows: handling rows of other executions', () => {
  const rows = [
    { id: 1, status: 'handling', execution_id: 'old' },
    { id: 2, status: 'handling', execution_id: 'e1' },
    { id: 3, status: 'received' },
    { id: 4, status: 'done', execution_id: 'old' },
  ];
  assert.deepEqual(stuckRows(rows, 'e1').map((r) => r.id), [1]);
  assert.deepEqual(stuckRows([], 'e1'), []);
});

test('nextAction: the oldest received row by ID; null when nothing waits', () => {
  const rows = [
    { id: 7, status: 'received', external_id: 'b' },
    { id: 3, status: 'received', external_id: 'a' },
    { id: 1, status: 'done', external_id: 'z' },
  ];
  assert.deepEqual(nextAction(rows), { row: rows[1], action: 'handle' });
  assert.equal(nextAction([{ id: 1, status: 'done', external_id: 'a' }]), null);
  assert.equal(nextAction([]), null);
});

test('nextAction: a repeat of a handling or done external_id is a duplicate; failed and duplicate rows do not count', () => {
  assert.equal(nextAction([{ id: 1, status: 'done', external_id: 'a' }, { id: 2, status: 'received', external_id: 'a' }]).action, 'duplicate');
  assert.equal(nextAction([{ id: 1, status: 'handling', external_id: 'a' }, { id: 2, status: 'received', external_id: 'a' }]).action, 'duplicate');
  assert.equal(nextAction([{ id: 1, status: 'failed', external_id: 'a' }, { id: 2, status: 'received', external_id: 'a' }]).action, 'handle');
  assert.equal(nextAction([{ id: 1, status: 'duplicate', external_id: 'a' }, { id: 2, status: 'received', external_id: 'a' }]).action, 'handle');
});

test('nextAction: two received copies of one event: the first is handled, the second waits its turn', () => {
  const rows = [{ id: 1, status: 'received', external_id: 'a' }, { id: 2, status: 'received', external_id: 'a' }];
  assert.deepEqual(nextAction(rows), { row: rows[0], action: 'handle' });
  rows[0].status = 'done';
  assert.deepEqual(nextAction(rows), { row: rows[1], action: 'duplicate' });
});

test('keepLooping: stops at 45 s', () => {
  assert.equal(keepLooping(NOW, plus(44)), true);
  assert.equal(keepLooping(NOW, plus(45)), false);
});
