'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { canRelease, releaseUpdates, resumeText, reopenUpdates } = require('../release');

test('canRelease only with nothing waiting', () => {
  assert.equal(canRelease(0), true);
  assert.equal(canRelease(1), false);
  assert.equal(canRelease(3), false);
});

test('releaseUpdates clears only ownership, unclear count and offered times', () => {
  const u = releaseUpdates({ human_owned: true, stage: 'offer', unclear_in_a_row: 1, offered_slots: '[{"id":"a","label":"b"}]' });
  assert.deepEqual(u, { human_owned: false, unclear_in_a_row: 0, offered_slots: '[]', last_offered_day: '' });
  assert.equal('stage' in u, false);
  assert.equal('service' in u, false);
  assert.equal('address' in u, false);
});

test('releaseUpdates on a conversation already with the bot does nothing', () => {
  assert.deepEqual(releaseUpdates({ human_owned: false, stage: 'offer' }), {});
});

test('resumeText names the stage', () => {
  assert.equal(resumeText({ stage: 'offer' }), 'Bot resumes at: offer');
});

test('reopenUpdates restores the stage before closing and clears offers and unclear count', () => {
  const u = reopenUpdates({ stage: 'closed', stage_before_close: 'address', unclear_in_a_row: 2, offered_slots: '[1]' });
  assert.deepEqual(u, { stage: 'address', offered_slots: '[]', last_offered_day: '', unclear_in_a_row: 0 });
});
