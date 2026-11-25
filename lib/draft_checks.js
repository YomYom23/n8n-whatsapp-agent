'use strict';
// Code checks on AI drafts and the blocking decision (design section 8, file 17).
const { THRESHOLDS, LIMITS } = require('./config');
const { checkDraftPrices, checkNumbers } = require('./price');

// Ported from Lead Bot guard.py PROMISES_FOLLOW_UP: only code may promise a follow-up.
const PROMISES_FOLLOW_UP = new RegExp(
  '\\b(pass|passing|forward|relay)\\w*\\b.{0,40}\\b(team|inspector|someone|office)\\b|' +
    "\\b(someone|the team|our team|they)('ll| will) (call|follow up|get back|reach out)",
  'i'
);

// Code problem name -> guard ID (section 13 guard table). Jev problems map to 'dc_' + name.
const CODE_GUARDS = {
  empty: 'dc_empty',
  too_long: 'dc_too_long',
  promises_follow_up: 'dc_follow_up',
  price_mismatch: 'dc_price',
  unknown_number: 'dc_unknown_number',
};

function guardId(problem) {
  return CODE_GUARDS[problem] || 'dc_' + problem;
}

// Names of the code checks the draft fails. factsText is everything the writer was given.
function codeProblems(draft, prices, totalCents, factsText) {
  const text = typeof draft === 'string' ? draft : '';
  const problems = [];
  if (text.trim() === '') problems.push('empty');
  if (text.length > LIMITS.draftMaxChars) problems.push('too_long');
  if (PROMISES_FOLLOW_UP.test(text)) problems.push('promises_follow_up');
  problems.push(...checkDraftPrices(text, prices, totalCents));
  problems.push(...checkNumbers(text, factsText));
  return problems;
}

// The problems that block the draft: Jev problems at THRESHOLDS.draftCheck or above, plus every
// code problem, each only while its guard ID is in 'enabled' (the node's generated @guards list).
// An omitted 'enabled' means every guard is on.
function blocking(jevProblems, codeProblemNames, enabled) {
  const on = (problem) => !Array.isArray(enabled) || enabled.includes(guardId(problem));
  const out = [];
  for (const [name, probability] of Object.entries(jevProblems || {})) {
    if (typeof probability === 'number' && probability >= THRESHOLDS.draftCheck && on(name)) out.push(name);
  }
  for (const name of codeProblemNames || []) {
    if (on(name)) out.push(name);
  }
  return out;
}

module.exports = { codeProblems, blocking, guardId };
