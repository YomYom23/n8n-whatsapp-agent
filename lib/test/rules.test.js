'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../config');
const { stageQuestions, draftCheckQuestions } = require('../questions');
const { checkComplete, normalise, route } = require('../rules');

const services = [
  { service: 'Regular clean', aliases: '', bookable: 'yes' },
  { service: 'Deep clean', aliases: '', bookable: 'yes' },
];
const set = stageQuestions({ stage: 'new', services });

function hazards(overrides) {
  return { opt_out: 0.01, wrong_person: 0.01, abusive: 0.01, prompt_injection: 0.01, wants_human: 0.01, ...overrides };
}
function result(answerValue, confidence, overrides) {
  return {
    ok: true,
    hazards: hazards(overrides),
    answer: { value: answerValue, confidence },
    price_service: { value: 'not_stated', confidence: 0.9 },
    price_hours: { value: 'not_stated', confidence: 0.9 },
  };
}
const conv = (n) => ({ unclear_in_a_row: n });

function item() {
  return {
    answers: {
      opt_out: { type: 'noul', noul: 0.02 },
      wrong_person: { type: 'noul', noul: 0.01 },
      abusive: { type: 'noul', noul: 0 },
      prompt_injection: { type: 'noul', noul: 0.03 },
      wants_human: { type: 'noul', noul: 0.98 },
      answer: { type: 'choice', choice: 'deep_clean', confidence: 0.76, probabilities: { deep_clean: 0.76 } },
      price_service: { type: 'choice', choice: 'not_stated', confidence: 0.6, probabilities: {} },
      price_hours: { type: 'choice', choice: '3', confidence: 0.7, probabilities: {} },
    },
  };
}

test('checkComplete: a complete result passes', () => {
  checkComplete(result('deep_clean', 0.9), set);
});

test('checkComplete: a result missing abusive throws', () => {
  const r = result('deep_clean', 0.9);
  delete r.hazards.abusive;
  assert.throws(() => checkComplete(r, set), /abusive/);
});

test('checkComplete: missing answer, missing hazards object, bad probability and ok:false throw', () => {
  const r = result('deep_clean', 0.9);
  delete r.answer;
  assert.throws(() => checkComplete(r, set), /answer/);
  assert.throws(() => checkComplete({ ok: true }, set), /hazards/);
  assert.throws(() => checkComplete(result('x', 1.5), set), /answer/);
  assert.throws(() => checkComplete({ ok: false, error: 'e' }, set), /not ok/);
});

test('checkComplete: draft-check set needs every problem', () => {
  const draft = draftCheckQuestions();
  const problems = Object.fromEntries(config.DRAFT_JEV_PROBLEMS.map((k) => [k, 0.1]));
  checkComplete({ ok: true, problems }, draft);
  delete problems.promise;
  assert.throws(() => checkComplete({ ok: true, problems }, draft), /promise/);
});

test('normalise: maps node output to the section 7 shape', () => {
  const r = normalise(item(), set);
  assert.equal(r.ok, true);
  assert.deepEqual(r.hazards, { opt_out: 0.02, wrong_person: 0.01, abusive: 0, prompt_injection: 0.03, wants_human: 0.98 });
  assert.deepEqual(r.answer, { value: 'deep_clean', confidence: 0.76 });
  assert.deepEqual(r.price_hours, { value: '3', confidence: 0.7 });
});

test('normalise: address-stage set gives hazards only', () => {
  const r = normalise(item(), stageQuestions({ stage: 'address', services }));
  assert.deepEqual(Object.keys(r), ['ok', 'hazards']);
});

test('normalise: draft-check set gives problems', () => {
  const answers = Object.fromEntries(config.DRAFT_JEV_PROBLEMS.map((k) => [k, { type: 'noul', noul: 0.2 }]));
  const r = normalise({ answers }, draftCheckQuestions());
  assert.equal(r.ok, true);
  assert.equal(r.problems.leaks_rules, 0.2);
});

test('normalise: a missing field is a failed call, never 0', () => {
  const it = item();
  delete it.answers.abusive;
  const r = normalise(it, set);
  assert.equal(r.ok, false);
  assert.match(r.error, /abusive/);
});

test('normalise: an option the question never offered, no answers, or an error is a failure', () => {
  const it = item();
  it.answers.answer.choice = 'made_up';
  assert.equal(normalise(it, set).ok, false);
  assert.equal(normalise({}, set).ok, false);
  assert.equal(normalise(null, set).ok, false);
  assert.equal(normalise({ error: { message: 'boom' } }, set).error, 'boom');
});

test('route: first hazard in order wins when two are over threshold', () => {
  const r = route(result('deep_clean', 0.9, { wants_human: 0.9, abusive: 0.8, wrong_person: 0.6 }), 'new', conv(0));
  assert.equal(r.route, 'wrong_person');
  assert.equal(r.reason, 'hazard');
  assert.equal(route(result('deep_clean', 0.9, { prompt_injection: 0.5, wants_human: 1 }), 'new', conv(0)).route, 'prompt_injection');
});

test('route: hazard below 0.5 does not fire', () => {
  assert.equal(route(result('deep_clean', 0.9, { opt_out: 0.49 }), 'new', conv(0)).route, 'stage_answer');
});

test('route: answer confidence 0.49 counts as unclear', () => {
  const r = route(result('deep_clean', 0.49), 'new', conv(0));
  assert.equal(r.route, 'unclear');
  assert.equal(r.reason, 'low_confidence');
  assert.equal(r.unclearInARow, 1);
  assert.equal(route(result('deep_clean', 0.5), 'new', conv(0)).route, 'stage_answer');
});

test('route: stage answer carries its option and resets the counter', () => {
  const r = route(result('deep_clean', 0.9), 'new', conv(1));
  assert.deepEqual(r, { route: 'stage_answer', reason: 'deep_clean', unclearInARow: 0 });
});

test('route: two off_topic in a row hand off', () => {
  const first = route(result('off_topic', 0.9), 'new', conv(0));
  assert.equal(first.route, 'off_topic');
  assert.equal(first.unclearInARow, 1);
  const second = route(result('off_topic', 0.9), 'new', conv(first.unclearInARow));
  assert.deepEqual(second, { route: 'handoff', reason: 'unclear', unclearInARow: 2 });
});

test('route: unclear then off_topic hands off; unclear then unclear hands off', () => {
  assert.equal(route(result('off_topic', 0.9), 'new', conv(1)).route, 'handoff');
  assert.equal(route(result('unclear', 0.9), 'offer', conv(1)).route, 'handoff');
});

test('route: later, other_question, price_question reset the counter', () => {
  for (const v of ['later', 'other_question', 'price_question']) {
    const r = route(result(v, 0.9), 'new', conv(1));
    assert.equal(r.route, v);
    assert.equal(r.unclearInARow, 0, v);
  }
});

test('route: repeat and booking_request leave the counter unchanged', () => {
  for (const v of ['repeat', 'booking_request']) {
    assert.equal(route(result(v, 0.9), 'new', conv(1)).unclearInARow, 1, v);
  }
});

test('route: hazards leave the counter unchanged', () => {
  assert.equal(route(result('deep_clean', 0.9, { opt_out: 0.9 }), 'new', conv(1)).unclearInARow, 1);
});

test('route: address stage reads hazards only, then the text is the answer', () => {
  const addr = normalise(item(), stageQuestions({ stage: 'address', services }));
  assert.equal(route(addr, 'address', conv(1)).route, 'wants_human');
  addr.hazards.wants_human = 0;
  assert.deepEqual(route(addr, 'address', conv(1)), { route: 'stage_answer', reason: 'address_text', unclearInARow: 0 });
});

test('route: a failed call hands off as jev_unavailable', () => {
  assert.deepEqual(route({ ok: false, error: 'x' }, 'new', conv(1)), { route: 'handoff', reason: 'jev_unavailable', unclearInARow: 1 });
});

// --- guard-removal switches (the node's generated @guards list) ---------------------------
const ALL_HAZARD_GUARDS = config.HAZARD_ORDER.map((h) => 'hazard_' + h);
const hz = (o = {}) => ({ opt_out: 0, wrong_person: 0, abusive: 0, prompt_injection: 0, wants_human: 0, ...o });
const okResult = (hazards) => ({ ok: true, hazards: hz(hazards), answer: { value: 'other_question', confidence: 0.9 } });

test('route enabled: a hazard left out of the list is not checked; the next one decides', () => {
  const r = okResult({ opt_out: 0.9, wants_human: 0.8 });
  assert.equal(route(r, 'new', {}, ALL_HAZARD_GUARDS).route, 'opt_out');
  assert.equal(route(r, 'new', {}, ALL_HAZARD_GUARDS.filter((g) => g !== 'hazard_opt_out')).route, 'wants_human');
  assert.equal(route(r, 'new', {}, []).route, 'other_question');
  assert.equal(route(r, 'new', {}).route, 'opt_out'); // omitted: every guard on
});

test('normalise enabled: without missing_field a missing field is filled in instead of failing', () => {
  const answers = {};
  for (const k of Object.keys(set)) {
    if (config.HAZARD_ORDER.includes(k)) answers[k] = { type: 'noul', noul: 0.1 };
  }
  answers.price_service = { type: 'choice', choice: 'not_stated', confidence: 1 };
  delete answers.abusive; // a hazard and the answer are missing
  assert.equal(normalise({ answers }, set).ok, false);
  assert.equal(normalise({ answers }, set, ['missing_field']).ok, false);
  const filled = normalise({ answers }, set, []);
  assert.equal(filled.ok, true);
  assert.equal(filled.hazards.abusive, 0);
  assert.deepEqual(filled.answer, { value: 'unclear', confidence: 0 });
  assert.deepEqual(filled.price_hours, { value: 'not_stated', confidence: 0 });
  assert.deepEqual(filled.price_service, { value: 'not_stated', confidence: 1 });
});

test('normalise enabled: an unusable item still fails even without missing_field', () => {
  assert.equal(normalise(null, set, []).ok, false);
  assert.equal(normalise({ error: { message: 'timeout' } }, set, []).ok, false);
});
