'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TEXTS, stageQuestion } = require('../texts');

test('exact wording from the design', () => {
  assert.equal(TEXTS.handoff_notice(), "Thanks, I'm passing this to a member of our team, who'll reply here");
  assert.equal(TEXTS.prompt_injection(), 'I can help with questions about our cleaning and with bookings');
  assert.equal(TEXTS.unsupported_kind(), 'I can only read text messages here');
  assert.equal(TEXTS.template(), 'We have an update on your enquiry. Reply here to see it.');
  assert.equal(TEXTS.not_in_facts(), "I'll pass that to the team");
  assert.equal(TEXTS.stage_address(), "What's the address for the clean, including the ZIP code?");
  assert.equal(TEXTS.stage_new(), 'Which clean would you like?');
});

test('every line is a non-empty string, except the booked stage', () => {
  const args = { stage_offer: [['a', 'b']], stage_offer_later: [['a']], repeat: ['Q?'], out_of_area: ['10001'] };
  for (const [name, fn] of Object.entries(TEXTS)) {
    const out = fn(...(args[name] || []));
    assert.equal(typeof out, 'string', name);
    if (name !== 'stage_booked') assert.ok(out.length > 0, name);
  }
  assert.equal(TEXTS.stage_booked(), '');
});

test('variables are filled in', () => {
  assert.equal(TEXTS.stage_new(['Regular clean', 'Deep clean', 'Oven clean']), 'Which clean would you like? We offer Regular clean, Deep clean and Oven clean.');
  assert.match(TEXTS.stage_offer(['Mon 9:00 AM', 'Tue 9:00 AM', 'Wed 9:00 AM']), /1\) Mon 9:00 AM\n2\) Tue 9:00 AM\n3\) Wed 9:00 AM/);
  assert.match(TEXTS.stage_offer_later(['Thu 9:00 AM']), /^Here are some later times\.\n1\) Thu 9:00 AM/);
  assert.match(TEXTS.out_of_area('10001'), /10001/);
  assert.equal(TEXTS.repeat('Which clean would you like?'), 'Sure, here it is again. Which clean would you like?');
});

test('stageQuestion', () => {
  assert.equal(stageQuestion('address'), TEXTS.stage_address());
  assert.equal(stageQuestion('new'), 'Which clean would you like?');
  assert.equal(stageQuestion('offer', { labels: ['x'] }), TEXTS.stage_offer(['x']));
  assert.equal(stageQuestion('offer', { labels: ['x'], later: true }), TEXTS.stage_offer_later(['x']));
  assert.equal(stageQuestion('booked'), '');
  assert.equal(stageQuestion('closed'), '');
});

test('every line is plain ASCII (no curly quotes or long dashes)', () => {
  for (const [name, fn] of Object.entries(TEXTS)) {
    assert.ok(!/[^\x20-\x7e\n]/.test(fn(['a'], 'a')), name);
  }
});
