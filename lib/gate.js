'use strict';
// Gate checks that run before any model call (design section 6).

// Carrier keyword sets from Lead Bot's text_script.py, without CANCEL and END, so a customer
// cancelling a booking is not opted out.
const STOP_KEYWORDS = new Set(['stop', 'stopall', 'unsubscribe', 'quit', 'revoke', 'optout']);
const START_KEYWORDS = new Set(['start', 'unstop']);

// Clear ways of saying "stop messaging me" (Lead Bot conversation.py OPT_OUT_PHRASES, ported as is).
const OPT_OUT_PHRASES = new RegExp(
  '\\b(stop texting|stop messaging|stop contacting|stop sending|stop these|do not text|don\'?t text|' +
    'do not contact|don\'?t contact|remove me|remove my number|take me off|unsubscribe|opt me out|' +
    'opt out|no more texts|no more messages)\\b',
  'i'
);
// "Stop" counts only as the first word: "can you stop by Tuesday" is not an opt-out.
const STARTS_WITH_STOP = /^\W*stop\b/i;

// A reply that is just a number (Lead Bot text_script.py PICKED_NUMBER): "2", "#2", "2.", "number 2".
const PICKED_NUMBER = /^\W*(?:number|option|#)?\s*(\d)\W*$/i;

// The whole message, trimmed and case-insensitive: 'stop', 'start' or null.
function keyword(text) {
  const word = String(text).trim().toLowerCase();
  if (STOP_KEYWORDS.has(word)) return 'stop';
  if (START_KEYWORDS.has(word)) return 'start';
  return null;
}

// True when the message asks to stop in the customer's own words. Curly apostrophes (what phone
// keyboards produce) are read as straight ones so "don’t text me" matches.
function isExplicitOptOut(text) {
  const plain = String(text).replace(/[‘’]/g, "'");
  return OPT_OUT_PHRASES.test(plain) || STARTS_WITH_STOP.test(plain);
}

// The 1-based number picked when the whole message is a number from 1 to offeredCount, else null.
function numberPick(text, offeredCount) {
  const match = PICKED_NUMBER.exec(String(text));
  if (match === null) return null;
  const number = Number(match[1]);
  return number >= 1 && number <= offeredCount ? number : null;
}

module.exports = { keyword, isExplicitOptOut, numberPick };
