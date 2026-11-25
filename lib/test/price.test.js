'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { priceFacts, findAmounts, splitSentences, checkDraftPrices, checkNumbers } = require('../price');

const prices = [
  { service: 'Deep clean', aliases: ['deep cleaning'], unit: 'fixed', amountCents: 12000, durationMinutes: 240, bookable: true },
  { service: 'Regular clean', aliases: ['regular cleaning', 'standard clean'], unit: 'hour', amountCents: 3500, durationMinutes: 180, bookable: true },
];

test('findAmounts: every money form', () => {
  for (const t of ['$120.00', '$ 120', '120 dollars', 'USD 120', '120 USD', '120 bucks', '$120']) {
    assert.deepEqual(findAmounts(t), [12000], t);
  }
  assert.deepEqual(findAmounts('$1,200'), [120000]);
  assert.deepEqual(findAmounts('$35.50 and 5 dollars'), [3550, 500]);
  assert.deepEqual(findAmounts('$120 USD'), [12000]);
  assert.deepEqual(findAmounts('no money, 3 hours'), []);
});

test('splitSentences: splits at . ! ? and line breaks, not between digits', () => {
  assert.deepEqual(splitSentences('A is $80.50. B! C?\nD'), ['A is $80.50', 'B', 'C', 'D']);
  assert.deepEqual(splitSentences('Costs $80. Next'), ['Costs $80', 'Next']);
  assert.deepEqual(splitSentences(''), []);
});

test('checkDraftPrices', () => {
  assert.deepEqual(checkDraftPrices('A deep clean is $120.', prices, null), []);
  assert.deepEqual(checkDraftPrices('A deep clean costs $35.', prices, null), ['price_mismatch']);
  assert.deepEqual(checkDraftPrices('3 hours of regular cleaning is $105.', prices, 10500), []);
  assert.deepEqual(checkDraftPrices('3 hours of regular cleaning is $105.', prices, null), ['price_mismatch']);
  assert.deepEqual(checkDraftPrices('Prices start from $20.', prices, null), ['price_mismatch']);
});

test('checkDraftPrices: matching is per sentence, whole word, case-insensitive', () => {
  assert.deepEqual(checkDraftPrices('DEEP CLEAN is $120. Regular clean is $35.', prices, null), []);
  assert.deepEqual(checkDraftPrices('We do a deep clean. It is $120.', prices, null), ['price_mismatch']);
  assert.deepEqual(checkDraftPrices('A deep cleanse is $120.', prices, null), ['price_mismatch']);
  assert.deepEqual(checkDraftPrices('A deep clean is $120.00 or 120 dollars.', prices, null), []);
  assert.deepEqual(checkDraftPrices('No prices here.', prices, null), []);
});

test('checkNumbers', () => {
  assert.deepEqual(checkNumbers("It's 99/hr", 'Regular clean: $35 per hour'), ['unknown_number']);
  assert.deepEqual(checkNumbers("It's 35/hr", 'Regular clean: $35 per hour'), []);
  assert.deepEqual(checkNumbers('It is $1,200.00', 'Big job: $1200'), []);
  assert.deepEqual(checkNumbers('Cost is $20', 'Cost is $200'), ['unknown_number']);
  assert.deepEqual(checkNumbers('No numbers at all', ''), []);
});

test('priceFacts: lines and the one calculated total', () => {
  const r = priceFacts(prices, null, null);
  assert.deepEqual(r.lines, ['Deep clean: $120', 'Regular clean: $35 per hour']);
  assert.equal(r.totalCents, null);
  const t = priceFacts(prices, 'regular cleaning', 3);
  assert.equal(t.totalCents, 10500);
  assert.equal(t.lines[t.lines.length - 1], 'Regular clean for 3 hours: $105');
  assert.equal(priceFacts(prices, 'Deep clean', 3).totalCents, null);
  assert.equal(priceFacts(prices, 'Regular clean', null).totalCents, null);
});
