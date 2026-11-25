'use strict';
// Checks that modules written separately agree on shapes: sheet rows -> price rows -> questions
// and price facts, and the slot free check used by booking.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parsePrices, priceFacts, serviceKey, checkDraftPrices } = require('../price');
const { stageQuestions, serviceId } = require('../questions');
const { slotIsFree, slotIdFor } = require('../slots');

function readCsv(name) {
  const [head, ...rows] = fs.readFileSync(path.join(__dirname, '..', '..', 'tests', 'facts', name), 'utf8').trim().split(/\r?\n/);
  const cols = head.split(',');
  return rows.map((line) => Object.fromEntries(line.split(',').map((v, i) => [cols[i], v])));
}

test('parsePrices reads the facts sheet copy', () => {
  const prices = parsePrices(readCsv('prices.csv'));
  const regular = prices.find((p) => p.service === 'Regular clean');
  assert.deepEqual(regular, { service: 'Regular clean', aliases: ['regular cleaning', 'standard clean'], unit: 'hour', amountCents: 3500, durationMinutes: 180, bookable: true });
  assert.equal(prices.find((p) => p.service === 'Deep clean').amountCents, 12000);
});

test('the price_service option ID gives the calculated total', () => {
  const prices = parsePrices(readCsv('prices.csv'));
  const q = stageQuestions({ stage: 'new', services: prices });
  assert.ok(Object.keys(q.price_service.criteria).includes('regular_clean'));
  const { lines, totalCents } = priceFacts(prices, 'regular_clean', 3);
  assert.equal(totalCents, 10500);
  assert.ok(lines.includes('Regular clean for 3 hours: $105'));
  assert.deepEqual(checkDraftPrices('3 hours of regular cleaning is $105.', prices, totalCents), []);
});

test('serviceKey matches questions.serviceId', () => {
  for (const name of ['Regular clean', 'Deep clean', 'Oven clean']) assert.equal(serviceKey(name), serviceId(name));
});

test('slotIsFree uses the block of duration plus gap', () => {
  const start = Date.parse('2026-12-02T14:00:00Z');
  const slotId = slotIdFor(start);
  assert.equal(slotIsFree({ slotId, durationMinutes: 120, gapMinutes: 30, busy: [] }), true);
  // busy starts 2h10m after the slot: inside the 2h30m block
  assert.equal(slotIsFree({ slotId, durationMinutes: 120, gapMinutes: 30, busy: [{ start: '2026-12-02T16:10:00Z', end: '2026-12-02T17:00:00Z' }] }), false);
  assert.equal(slotIsFree({ slotId, durationMinutes: 120, gapMinutes: 30, busy: [{ start: '2026-12-02T16:30:00Z', end: '2026-12-02T17:00:00Z' }] }), true);
  assert.equal(slotIsFree({ slotId: 'garbage', durationMinutes: 120, busy: [] }), false);
});
