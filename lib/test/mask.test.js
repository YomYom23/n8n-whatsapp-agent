'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { maskNumber } = require('../mask');

test('keeps only the last 4 digits', () => {
  assert.equal(maskNumber('447911123456'), '********3456');
  assert.equal(maskNumber('15551234567'), '*******4567');
});

test('drops a leading plus and other non-digits', () => {
  assert.equal(maskNumber('+1 (555) 123-4567'), '*******4567');
});

test('short numbers are masked completely', () => {
  assert.equal(maskNumber('1234'), '****');
  assert.equal(maskNumber('12'), '**');
});

test('empty and missing input give an empty string', () => {
  assert.equal(maskNumber(''), '');
  assert.equal(maskNumber(null), '');
  assert.equal(maskNumber(undefined), '');
});

test('a number input works', () => {
  assert.equal(maskNumber(15551234567), '*******4567');
});

test('the masked value never contains more than 4 digits', () => {
  assert.equal(maskNumber('447911123456').replace(/\D/g, '').length, 4);
});
