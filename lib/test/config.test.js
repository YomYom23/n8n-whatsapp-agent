'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../config');

test('hazard order matches the design', () => {
  assert.deepEqual(config.HAZARD_ORDER, ['opt_out', 'wrong_person', 'abusive', 'prompt_injection', 'wants_human']);
});

test('thresholds and limits', () => {
  assert.equal(config.THRESHOLDS.hazard, 0.5);
  assert.equal(config.THRESHOLDS.answerConfidence, 0.5);
  assert.equal(config.THRESHOLDS.draftCheck, 0.3);
  assert.equal(config.LIMITS.unclearInARow, 2);
  assert.equal(config.LIMITS.zipAsks, 2);
  assert.equal(config.LIMITS.draftMaxChars, 600);
  assert.deepEqual(config.JEV.retryWaitsMs, [1000, 2000]);
  assert.equal(config.SLOTS.offered, 3);
});

test('escape options have no duplicates', () => {
  assert.equal(new Set(config.ESCAPE_OPTIONS).size, config.ESCAPE_OPTIONS.length);
});
