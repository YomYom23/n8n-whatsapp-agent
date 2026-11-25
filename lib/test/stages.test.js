'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { STAGE_VERSION, next } = require('../stages');

const services = [
  { service: 'Regular clean', aliases: '', bookable: 'yes' },
  { service: 'Deep clean', aliases: '', bookable: 'yes' },
  { service: 'Window quote', aliases: '', bookable: 'no' },
];
const facts = { services, serviceAreas: ['10001', '10002'], zip: null, customerText: '' };
const slots = JSON.stringify([{ id: 'slot-a', label: 'Mon 10:00 AM' }, { id: 'slot-b', label: 'Tue 10:00 AM' }]);

function conv(stage, extra) {
  return { stage, stage_version: STAGE_VERSION, service: '', address: '', zip: '', offered_slots: '[]',
    reoffer_used: false, unclear_in_a_row: 0, zip_asks: 0, ...extra };
}
const answer = (reason, n) => ({ route: 'stage_answer', reason, unclearInARow: n || 0 });
const rr = (route, n, reason) => ({ route, reason: reason || 'escape', unclearInARow: n || 0 });

test('hazards: opt_out, wrong_person, abusive, prompt_injection, wants_human', () => {
  const c = conv('offer', { offered_slots: slots });
  assert.deepEqual(next(c, rr('opt_out', 0, 'hazard'), facts), { stage: 'offer', reply: 'fixed:opt_out', updates: {} });
  const wp = next(c, rr('wrong_person', 0, 'hazard'), facts);
  assert.equal(wp.reply, 'close:wrong_person');
  assert.deepEqual(wp.updates, { stage: 'closed', stage_version: STAGE_VERSION, stage_before_close: 'offer', closed_reason: 'wrong_person' });
  const ab = next(c, rr('abusive', 0, 'hazard'), facts);
  assert.equal(ab.reply, 'close:abusive');
  assert.equal(ab.updates.closed_reason, 'abusive');
  assert.equal(next(c, rr('prompt_injection', 0, 'hazard'), facts).reply, 'fixed:prompt_injection');
  assert.equal(next(c, rr('wants_human', 0, 'hazard'), facts).reply, 'handoff:wants_human');
});

test('new: a service with no address goes to address and counts the first ask', () => {
  const r = next(conv('new'), answer('deep_clean'), facts);
  assert.equal(r.stage, 'address');
  assert.equal(r.reply, 'ask_address');
  assert.equal(r.updates.service, 'Deep clean');
  assert.equal(r.updates.stage, 'address');
  assert.equal(r.updates.zip_asks, 1);
});

test('new: a service with a known address goes straight to offer', () => {
  const r = next(conv('new', { address: '1 Main St', zip: '10001' }), answer('regular_clean'), facts);
  assert.equal(r.stage, 'offer');
  assert.equal(r.reply, 'offer_times');
  assert.equal(r.updates.service, 'Regular clean');
  assert.equal(r.updates.reoffer_used, false);
});

test('new: just_asking asks if they want to book; a non-bookable or unknown service asks again', () => {
  assert.equal(next(conv('new'), answer('just_asking'), facts).reply, 'ask_book');
  assert.deepEqual(next(conv('new'), answer('window_quote'), facts), { stage: 'new', reply: 'ask_service', updates: {} });
  assert.equal(next(conv('new'), answer('nonsense'), facts).reply, 'ask_service');
});

test('new: questions go to the writer then ask_book', () => {
  for (const route of ['price_question', 'other_question']) {
    const r = next(conv('new'), rr(route), facts);
    assert.equal(r.reply, 'writer');
    assert.equal(r.then, 'ask_book');
    assert.equal(r.stage, 'new');
  }
});

test('address: ZIP in area goes to offer and stores the text and ZIP', () => {
  const c = conv('address', { service: 'Deep clean', zip_asks: 1 });
  const r = next(c, answer('address_text'), { ...facts, zip: '10001', customerText: ' 12 Main St, NY 10001 ' });
  assert.equal(r.stage, 'offer');
  assert.equal(r.reply, 'offer_times');
  assert.equal(r.updates.address, '12 Main St, NY 10001');
  assert.equal(r.updates.zip, '10001');
  assert.equal(r.updates.zip_asks, 0);
});

test('address: out of area stays with the fixed reply and stores nothing', () => {
  const r = next(conv('address', { zip_asks: 1 }), answer('address_text'), { ...facts, zip: '99999' });
  assert.deepEqual(r, { stage: 'address', reply: 'out_of_area', updates: {} });
});

test('address: no ZIP asks once more, then hands off', () => {
  const first = next(conv('address', { zip_asks: 1 }), answer('address_text'), facts);
  assert.equal(first.reply, 'ask_address_again');
  assert.equal(first.updates.zip_asks, 2);
  const second = next(conv('address', { zip_asks: 2 }), answer('address_text'), facts);
  assert.equal(second.reply, 'handoff:zip_not_found');
});

test('offer: a slot books and moves to booked', () => {
  const r = next(conv('offer', { offered_slots: slots }), answer('slot-b'), facts);
  assert.equal(r.stage, 'booked');
  assert.equal(r.reply, 'booked_confirmation');
  assert.equal(r.book, 'slot-b');
  assert.equal(r.updates.stage, 'booked');
  assert.equal(r.updates.offered_slots, '[]');
});

test('offer: a slot that was not offered gets fresh times', () => {
  assert.equal(next(conv('offer', { offered_slots: slots }), answer('slot-z'), facts).reply, 'offer_times');
});

test('offer: none gives later times once, then hands off', () => {
  const c = conv('offer', { offered_slots: slots });
  const first = next(c, answer('none'), facts);
  assert.equal(first.reply, 'later_times');
  assert.equal(first.updates.reoffer_used, true);
  assert.equal(next({ ...c, reoffer_used: true }, answer('none'), facts).reply, 'handoff:slots_exhausted');
});

test('offer: booking_request offers fresh times', () => {
  const r = next(conv('offer', { offered_slots: slots }), rr('booking_request'), facts);
  assert.equal(r.reply, 'offer_times');
  assert.equal(r.updates.offered_slots, '[]');
});

test('booked: thanks needs no reply, change_booking hands off', () => {
  assert.deepEqual(next(conv('booked'), answer('thanks'), facts), { stage: 'booked', reply: 'none', updates: {} });
  assert.equal(next(conv('booked'), answer('change_booking'), facts).reply, 'handoff:change_booking');
});

test('booked: booking_request goes back to new and keeps the address', () => {
  const c = conv('booked', { address: '1 Main St', zip: '10001', service: 'Deep clean', offered_slots: '[]' });
  const r = next(c, rr('booking_request'), facts);
  assert.equal(r.stage, 'new');
  assert.equal(r.reply, 'ask_service');
  assert.equal(r.updates.service, '');
  assert.ok(!('address' in r.updates) && !('zip' in r.updates));
});

test('booking_request in new asks which clean (no service to offer for yet)', () => {
  assert.deepEqual(next(conv('new'), rr('booking_request'), facts), { stage: 'new', reply: 'ask_service', updates: {} });
});

test('closed: nothing is sent', () => {
  assert.deepEqual(next(conv('closed'), answer('x'), facts), { stage: 'closed', reply: 'none', updates: {} });
});

test('off_topic, unclear: fixed replies with the counter; handoff when the router says so', () => {
  const off = next(conv('new'), rr('off_topic', 1), facts);
  assert.equal(off.reply, 'fixed:off_topic');
  assert.deepEqual(off.updates, { unclear_in_a_row: 1 });
  assert.equal(off.then, 'ask_book');
  const unclear = next(conv('offer', { offered_slots: slots, unclear_in_a_row: 0 }), rr('unclear', 1, 'low_confidence'), facts);
  assert.equal(unclear.reply, 'fixed:unclear');
  assert.equal(unclear.then, 'last_question');
  const h = next(conv('new', { unclear_in_a_row: 1 }), { route: 'handoff', reason: 'unclear', unclearInARow: 2 }, facts);
  assert.equal(h.reply, 'handoff:unclear');
  assert.deepEqual(h.updates, { unclear_in_a_row: 2 });
  assert.equal(next(conv('new'), { route: 'handoff', reason: 'jev_unavailable', unclearInARow: 0 }, facts).reply, 'handoff:jev_unavailable');
});

test('later: fixed reply, counter reset; repeat resends the last question', () => {
  const later = next(conv('new', { unclear_in_a_row: 1 }), rr('later', 0), facts);
  assert.equal(later.reply, 'fixed:later');
  assert.deepEqual(later.updates, { unclear_in_a_row: 0 });
  assert.equal(next(conv('address'), rr('repeat'), facts).reply, 'fixed:repeat');
  assert.equal(next(conv('booked'), rr('repeat'), facts).reply, 'booked_confirmation');
});

test('unknown stage or version hands off as unknown_stage', () => {
  assert.equal(next(conv('mystery'), answer('x'), facts).reply, 'handoff:unknown_stage');
  assert.equal(next({ ...conv('new'), stage_version: STAGE_VERSION + 1 }, answer('deep_clean'), facts).reply, 'handoff:unknown_stage');
  assert.equal(next({ ...conv('new'), stage_version: undefined }, answer('deep_clean'), facts).reply, 'handoff:unknown_stage');
});

test('an opt-out is honoured even on an unknown stage', () => {
  assert.equal(next(conv('mystery'), rr('opt_out', 0, 'hazard'), facts).reply, 'fixed:opt_out');
});

test('offered_slots may be a JSON string or an array', () => {
  const arr = [{ id: 'slot-a', label: 'x' }];
  assert.equal(next(conv('offer', { offered_slots: arr }), answer('slot-a'), facts).book, 'slot-a');
});
