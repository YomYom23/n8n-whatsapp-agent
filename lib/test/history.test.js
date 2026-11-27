'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { orderHistory } = require('../history');

const T1 = '2026-11-27T01:30:46.027Z';
const T2 = '2026-11-27T01:31:11.027Z';

test('orderHistory: a turn logged reply-first reads customer then bot', () => {
  const rows = [
    { id: 7, logged_at: T1, direction: 'out', author: 'bot', text: 'times' },
    { id: 8, logged_at: T1, direction: 'in', author: 'customer', text: '10001' },
    { id: 9, logged_at: T1, direction: 'event', author: 'system', text: 'create' },
    { id: 10, logged_at: T2, direction: 'out', author: 'bot', text: 'booked' },
    { id: 11, logged_at: T2, direction: 'in', author: 'customer', text: '3' },
  ];
  assert.deepStrictEqual(orderHistory(rows).map((r) => r.text), ['10001', 'times', '3', 'booked']);
});

test('orderHistory: same time and direction falls back to id; bad input is empty', () => {
  const rows = [
    { id: 5, logged_at: T1, direction: 'out', author: 'owner', text: 'b' },
    { id: 4, logged_at: T1, direction: 'out', author: 'owner', text: 'a' },
  ];
  assert.deepStrictEqual(orderHistory(rows).map((r) => r.text), ['a', 'b']);
  assert.deepStrictEqual(orderHistory(null), []);
});

test('orderHistory: rows without logged_at use createdAt and do not change the input', () => {
  const rows = [
    { id: 2, createdAt: T2, direction: 'in', author: 'customer', text: 'later' },
    { id: 1, createdAt: T1, direction: 'in', author: 'customer', text: 'earlier' },
  ];
  assert.deepStrictEqual(orderHistory(rows).map((r) => r.text), ['earlier', 'later']);
  assert.strictEqual(rows[0].id, 2);
});
