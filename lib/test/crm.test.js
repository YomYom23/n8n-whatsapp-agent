'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { targetState } = require('../crm');

test('no deal yet: create at the event stage, contact wanted', () => {
  assert.deepEqual(targetState({ stage: 'new' }, 'enquiry'), { wantContact: true, dealAction: 'create', stage: 'enquiry' });
  assert.deepEqual(targetState({ stage: 'booked', hubspot_deal_id: '' }, 'booked'), { wantContact: true, dealAction: 'create', stage: 'booked' });
});

test('deal at enquiry and a booking: move to booked', () => {
  assert.deepEqual(targetState({ stage: 'booked', hubspot_deal_id: '9', deal_stage: 'enquiry' }, 'booked'),
    { wantContact: true, dealAction: 'move', stage: 'booked' });
});

test('deal already booked and a new enquiry: create a new deal', () => {
  assert.deepEqual(targetState({ stage: 'offer', hubspot_deal_id: '9', deal_stage: 'booked' }, 'enquiry'),
    { wantContact: true, dealAction: 'create', stage: 'enquiry' });
});

test('deal already at the target stage: nothing to do', () => {
  assert.equal(targetState({ stage: 'offer', hubspot_deal_id: '9', deal_stage: 'enquiry' }, 'enquiry').dealAction, 'none');
  assert.equal(targetState({ stage: 'booked', hubspot_deal_id: '9', deal_stage: 'booked' }, 'booked').dealAction, 'none');
});

test('deal id stored but stage column empty: move (repairs a missed step)', () => {
  assert.equal(targetState({ stage: 'offer', hubspot_deal_id: '9', deal_stage: '' }, 'enquiry').dealAction, 'move');
});

test('no contact for do-not-contact numbers or closed conversations', () => {
  const none = { wantContact: false, dealAction: 'none', stage: null };
  assert.deepEqual(targetState({ stage: 'offer' }, 'enquiry', { onDnc: true }), none);
  assert.deepEqual(targetState({ stage: 'closed', hubspot_deal_id: '9', deal_stage: 'enquiry' }, 'booked'), none);
});

test('unknown event throws', () => {
  assert.throws(() => targetState({ stage: 'new' }, 'other'));
});
