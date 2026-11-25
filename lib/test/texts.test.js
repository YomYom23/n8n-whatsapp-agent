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

const { fixedReply, withThen } = require('../texts');
const SERVICES = [
  { service: 'regular clean', bookable: 'yes' },
  { service: 'deep clean', bookable: 'yes' },
  { service: 'window clean', bookable: 'no' },
];

test('fixedReply: stage questions set last_bot_question', () => {
  assert.deepEqual(fixedReply('ask_service', { services: SERVICES }), {
    text: 'Which clean would you like? We offer regular clean and deep clean.', kind: 'normal',
    question: 'Which clean would you like? We offer regular clean and deep clean.',
  });
  assert.equal(fixedReply('ask_address', {}).question, TEXTS.stage_address());
  const again = fixedReply('ask_address_again', {});
  assert.equal(again.text, TEXTS.stage_address_again());
  assert.equal(again.question, TEXTS.stage_address());
  assert.deepEqual(fixedReply('ask_book', {}), { text: TEXTS.book_prompt(), kind: 'normal', question: TEXTS.book_prompt() });
});

test('fixedReply: opt-out is an opt_out_confirmation; out_of_area names the ZIP and keeps the question', () => {
  assert.equal(fixedReply('fixed:opt_out', {}).kind, 'opt_out_confirmation');
  assert.deepEqual(fixedReply('out_of_area', { zip: '99999' }), { text: TEXTS.out_of_area('99999'), kind: 'normal', question: null });
});

test('fixedReply: off_topic and unclear add the follow-up; unclear is only the question', () => {
  const q = 'Which clean would you like?';
  assert.equal(fixedReply('fixed:off_topic', { then: 'last_question', lastBotQuestion: q }).text, TEXTS.off_topic() + '\n\n' + q);
  assert.deepEqual(fixedReply('fixed:unclear', { then: 'last_question', lastBotQuestion: q }), { text: q, kind: 'normal', question: null });
  assert.deepEqual(fixedReply('fixed:unclear', { then: 'ask_book' }), { text: TEXTS.book_prompt(), kind: 'normal', question: TEXTS.book_prompt() });
  assert.equal(fixedReply('fixed:repeat', { lastBotQuestion: q }).text, TEXTS.repeat(q));
});

test('fixedReply: handoff, close and none', () => {
  assert.equal(fixedReply('handoff:wants_human', {}).text, TEXTS.handoff_notice());
  assert.equal(fixedReply('close:wrong_person', {}).text, TEXTS.wrong_person_apology());
  assert.equal(fixedReply('close:abusive', {}).text, '');
  assert.equal(fixedReply('none', {}).text, '');
});

test('fixedReply: codes for other workflows give null; unknown codes throw', () => {
  for (const r of ['writer', 'offer_times', 'later_times', 'booked_confirmation']) assert.equal(fixedReply(r, {}), null);
  assert.throws(() => fixedReply('fixed:nope', {}));
  assert.throws(() => fixedReply(undefined, {}));
});

test('withThen: appends after a draft; no follow-up for null or a missing last question', () => {
  assert.deepEqual(withThen('A deep clean is $120.', 'ask_book', ''), { text: 'A deep clean is $120.\n\n' + TEXTS.book_prompt(), question: TEXTS.book_prompt() });
  assert.deepEqual(withThen('Hi.', 'last_question', 'Q?'), { text: 'Hi.\n\nQ?', question: null });
  assert.deepEqual(withThen('Hi.', null, 'Q?'), { text: 'Hi.', question: null });
  assert.deepEqual(withThen('Hi.', 'last_question', ''), { text: 'Hi.', question: null });
});
