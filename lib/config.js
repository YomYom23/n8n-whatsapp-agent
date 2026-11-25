'use strict';
// Every number and fixed list the logic modules use (design section 7 onwards, file 7).
// Other lib modules read these through require('./config'), never as literals.

const HAZARD_ORDER = ['opt_out', 'wrong_person', 'abusive', 'prompt_injection', 'wants_human'];

// Escape options added to the `answer` question at every stage (section 7).
const ESCAPE_OPTIONS = ['price_question', 'booking_request', 'other_question', 'off_topic', 'repeat', 'later', 'unclear'];

// Draft-check problems asked of Jev (section 8). Lead Bot's insurance_talk and price_talk are dropped.
const DRAFT_JEV_PROBLEMS = ['unsupported_fact', 'claims_action', 'promise', 'leaks_rules', 'off_brand'];
// Draft problems found by code (section 8).
const DRAFT_CODE_PROBLEMS = ['empty', 'too_long', 'promises_follow_up', 'price_mismatch', 'unknown_number'];

const THRESHOLDS = {
  hazard: 0.5,         // first hazard at or above this decides the route
  answerConfidence: 0.5, // answer below this counts as unclear
  draftCheck: 0.3,     // a Jev draft problem at or above this blocks the draft
};

const LIMITS = {
  unclearInARow: 2,    // this many unclear/off_topic in a row hands off
  zipAsks: 2,          // address asked this many times without a ZIP hands off
  draftMaxChars: 600,
  historyMessages: 6,
  priceHoursMax: 8,    // price_hours options are 1..8 plus not_stated
};

const JEV = {
  timeoutMs: 4000,
  retryWaitsMs: [1000, 2000],
};

const SLOTS = {
  offered: 3,
  gapMinutes: 30,
  minNoticeHours: 12,
  daysAhead: 14,
};

const BRANCH_B = {
  scheduleSeconds: 5,
  leaseSeconds: 60,
  loopLimitSeconds: 45,
  stuckRowMinutes: 5,
};

const WINDOW_HOURS = 24; // Meta's customer-service window

module.exports = {
  HAZARD_ORDER,
  ESCAPE_OPTIONS,
  DRAFT_JEV_PROBLEMS,
  DRAFT_CODE_PROBLEMS,
  THRESHOLDS,
  LIMITS,
  JEV,
  SLOTS,
  BRANCH_B,
  WINDOW_HOURS,
};
