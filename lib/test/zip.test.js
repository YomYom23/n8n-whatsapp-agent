'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { findZip, inArea } = require('../zip');

test('findZip', () => {
  assert.equal(findZip('12 Main St, NY 10001'), '10001');
  assert.equal(findZip('12345 Main St, 10001-1234'), '10001');
  assert.equal(findZip('12345 Oak Ave'), '12345'); // known limit
  assert.equal(findZip('no zip here'), null);
  assert.equal(findZip('call 1234567 now'), null);
  assert.equal(findZip(''), null);
});

test('inArea', () => {
  assert.equal(inArea('10001', ['10001', '10002']), true);
  assert.equal(inArea('10003', ['10001', '10002']), false);
  assert.equal(inArea(null, ['10001']), false);
});
