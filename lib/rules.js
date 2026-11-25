'use strict';
// Rules applied in code to the classifier result (design sections 7 and 8).

const config = require('./config');

// Escape options that reset the unclear counter, raise it, or leave it alone (section 7).
const COUNTER_RAISED_BY = ['unclear', 'off_topic'];
const COUNTER_UNCHANGED_BY = ['repeat', 'booking_request'];

function isProbability(p) {
  return typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1;
}

function isPickAnswer(a) {
  return a !== null && typeof a === 'object' && typeof a.value === 'string' && isProbability(a.confidence);
}

// Throws if any question of the set has no usable field in the normalised result. A missing
// field is a failed call, never a probability of 0.
function checkComplete(result, questionSet) {
  if (result === null || typeof result !== 'object' || result.ok !== true) {
    throw new Error('classifier result is not ok');
  }
  for (const key of Object.keys(questionSet)) {
    if (config.HAZARD_ORDER.includes(key)) {
      if (!result.hazards || !isProbability(result.hazards[key])) throw new Error('missing field: hazards.' + key);
    } else if (config.DRAFT_JEV_PROBLEMS.includes(key)) {
      if (!result.problems || !isProbability(result.problems[key])) throw new Error('missing field: problems.' + key);
    } else if (!isPickAnswer(result[key])) {
      throw new Error('missing field: ' + key);
    }
  }
}

function fillMissing(result, questionSet) {
  for (const key of Object.keys(questionSet)) {
    if (config.HAZARD_ORDER.includes(key)) {
      result.hazards = result.hazards || {};
      if (!isProbability(result.hazards[key])) result.hazards[key] = 0;
    } else if (config.DRAFT_JEV_PROBLEMS.includes(key)) {
      result.problems = result.problems || {};
      if (!isProbability(result.problems[key])) result.problems[key] = 0;
    } else if (!isPickAnswer(result[key])) {
      result[key] = { value: key === 'answer' ? 'unclear' : 'not_stated', confidence: 0 };
    }
  }
}

function failure(error) {
  return { ok: false, error };
}

// Turns the node's Evaluate output into the normalised result. item.answers is keyed by question ID:
//   noul:   { type: 'noul', noul: 0.98 }
//   choice: { type: 'choice', choice: 'x', confidence: 0.76, probabilities: {...} }
// Returns { ok: true, hazards, answer, price_service, price_hours } (stage set, without the pick
// questions the set lacks), { ok: true, problems } (draft-check set), or { ok: false, error }
// when the item is unusable or any expected field is missing.
// enabled: the node's generated @guards list. Without 'missing_field' in it, a missing field is
// filled in (0 for a probability, 'unclear' or 'not_stated' for a pick) instead of failing the call:
// the behaviour the guard prevents, used only by the guard-removal run. Omitted means every guard is on.
function normalise(item, questionSet, enabled) {
  if (item === null || typeof item !== 'object') return failure('no evaluate output');
  if (item.error) return failure(String(item.error.message || item.error));
  const answers = item.answers;
  if (answers === null || typeof answers !== 'object') return failure('no answers in evaluate output');

  const result = { ok: true };
  for (const key of Object.keys(questionSet)) {
    const a = answers[key];
    if (a === null || typeof a !== 'object') continue;
    if (config.HAZARD_ORDER.includes(key)) {
      result.hazards = result.hazards || {};
      if (typeof a.noul === 'number') result.hazards[key] = a.noul;
    } else if (config.DRAFT_JEV_PROBLEMS.includes(key)) {
      result.problems = result.problems || {};
      if (typeof a.noul === 'number') result.problems[key] = a.noul;
    } else if (typeof a.choice === 'string') {
      const options = questionSet[key].criteria || {};
      // An option the question never offered counts as missing (guard offered_only).
      const offeredOnly = !Array.isArray(enabled) || enabled.includes('offered_only');
      if (!offeredOnly || Object.prototype.hasOwnProperty.call(options, a.choice)) {
        result[key] = { value: a.choice, confidence: a.confidence };
      }
    }
  }
  if (Array.isArray(enabled) && !enabled.includes('missing_field')) fillMissing(result, questionSet);
  try {
    checkComplete(result, questionSet);
  } catch (error) {
    return failure(error.message);
  }
  return result;
}

// Decides what a classifier result means at a stage. Returns { route, reason, unclearInARow }:
//   a hazard:           route = the hazard name, reason 'hazard'
//   an escape option:   route = the option (low confidence counts as 'unclear'), reason 'escape'
//                       or 'low_confidence'
//   a stage answer:     route 'stage_answer', reason = the answer's option ID
//   two unclear/off_topic in a row, or a failed call: route 'handoff', reason 'unclear' or 'jev_unavailable'
// unclearInARow is the counter to store. The address stage asks hazards only, so its message is
// always a stage answer.
// enabled: the node's generated @guards list; a hazard is checked only while 'hazard_<name>' is in it.
// Omitted means every guard is on.
function route(result, stage, conversation, enabled) {
  const before = Number((conversation && conversation.unclear_in_a_row) || 0);
  if (!result || result.ok !== true) return { route: 'handoff', reason: 'jev_unavailable', unclearInARow: before };

  for (const hazard of config.HAZARD_ORDER) {
    if (Array.isArray(enabled) && !enabled.includes('hazard_' + hazard)) continue;
    if (result.hazards[hazard] >= config.THRESHOLDS.hazard) {
      return { route: hazard, reason: 'hazard', unclearInARow: before };
    }
  }
  if (stage === 'address') return { route: 'stage_answer', reason: 'address_text', unclearInARow: 0 };

  const lowConfidence = result.answer.confidence < config.THRESHOLDS.answerConfidence;
  const option = lowConfidence ? 'unclear' : result.answer.value;
  const isEscape = config.ESCAPE_OPTIONS.includes(option);

  let unclearInARow = before;
  if (COUNTER_RAISED_BY.includes(option)) unclearInARow = before + 1;
  else if (!COUNTER_UNCHANGED_BY.includes(option)) unclearInARow = 0;

  if (COUNTER_RAISED_BY.includes(option) && unclearInARow >= config.LIMITS.unclearInARow) {
    return { route: 'handoff', reason: 'unclear', unclearInARow };
  }
  if (isEscape) return { route: option, reason: lowConfidence ? 'low_confidence' : 'escape', unclearInARow };
  return { route: 'stage_answer', reason: option, unclearInARow };
}

module.exports = { checkComplete, normalise, route };
