'use strict';
// Stage logic for the cleaning company (design section 9, and the routes table in section 8).

const config = require('./config');
const { serviceId, isBookable, NONE_OPTION, JUST_ASKING_OPTION } = require('./questions');

// Stored with every stage value. A row with another version hands off as unknown_stage.
const STAGE_VERSION = 1;

const STAGES = ['new', 'address', 'offer', 'booked', 'closed'];

const EMPTY_JSON_LIST = '[]';

function parseList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || value === '') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function addressKnown(conversation) {
  return Boolean(conversation.address) && Boolean(conversation.zip);
}

// Columns that start a fresh round of offering times.
function freshOffer() {
  return { offered_slots: EMPTY_JSON_LIST, last_offered_day: '', reoffer_used: false, slot_taken_count: 0 };
}

function counterUpdate(conversation, routeResult) {
  const before = Number(conversation.unclear_in_a_row || 0);
  return routeResult.unclearInARow !== before ? { unclear_in_a_row: routeResult.unclearInARow } : {};
}

function result(stage, reply, updates, extra) {
  return { stage, reply, updates, ...extra };
}

function handoff(conversation, reason, updates) {
  return result(conversation.stage, 'handoff:' + reason, updates || {});
}

function close(conversation, reason) {
  return result('closed', 'close:' + reason, {
    stage: 'closed',
    stage_version: STAGE_VERSION,
    stage_before_close: conversation.stage,
    closed_reason: reason,
  });
}

// What the bot says next for a service pick in the new stage.
function pickService(conversation, row) {
  const base = { service: row.service, unclear_in_a_row: 0 };
  if (addressKnown(conversation)) {
    return result('offer', 'offer_times', { ...base, stage: 'offer', stage_version: STAGE_VERSION, ...freshOffer() });
  }
  return result('address', 'ask_address', { ...base, stage: 'address', stage_version: STAGE_VERSION, zip_asks: 1 });
}

function newStage(conversation, routeResult, facts) {
  if (routeResult.reason === JUST_ASKING_OPTION) {
    return result('new', 'ask_book', { ...counterUpdate(conversation, routeResult) });
  }
  const row = (facts.services || []).find((s) => isBookable(s) && serviceId(s.service) === routeResult.reason);
  // A service the sheet no longer lists (it changed mid-run): ask again, nothing is stored.
  if (!row) return result('new', 'ask_service', {});
  return pickService(conversation, row);
}

function addressStage(conversation, routeResult, facts) {
  const zip = facts.zip || null;
  if (zip === null) {
    const asks = Number(conversation.zip_asks || 0);
    if (asks >= config.LIMITS.zipAsks) return handoff(conversation, 'zip_not_found');
    return result('address', 'ask_address_again', { zip_asks: asks + 1 });
  }
  // Guard zip_area: skipped only when the node's @guards list leaves it out (guard-removal run).
  const areaOn = !Array.isArray(facts.enabled) || facts.enabled.includes('zip_area');
  if (areaOn && !(facts.serviceAreas || []).includes(zip)) return result('address', 'out_of_area', {});
  return result('offer', 'offer_times', {
    stage: 'offer',
    stage_version: STAGE_VERSION,
    address: String(facts.customerText || '').trim(),
    zip,
    zip_asks: 0,
    unclear_in_a_row: 0,
    ...freshOffer(),
  });
}

function offerStage(conversation, routeResult) {
  const pick = routeResult.reason;
  if (pick === NONE_OPTION) {
    if (conversation.reoffer_used) return handoff(conversation, 'slots_exhausted');
    return result('offer', 'later_times', { reoffer_used: true, unclear_in_a_row: 0 });
  }
  const offered = parseList(conversation.offered_slots);
  if (!offered.some((slot) => slot.id === pick)) return result('offer', 'offer_times', { unclear_in_a_row: 0 });
  // The updates apply once the booking succeeds; a taken slot is handled by booking (section 12).
  return result(
    'booked',
    'booked_confirmation',
    { stage: 'booked', stage_version: STAGE_VERSION, unclear_in_a_row: 0, offered_slots: EMPTY_JSON_LIST },
    { book: pick }
  );
}

function bookedStage(conversation, routeResult) {
  if (routeResult.reason === 'change_booking') return handoff(conversation, 'change_booking');
  return result('booked', 'none', counterUpdate(conversation, routeResult)); // "thanks" needs no reply
}

// Stage question to ask after a writer answer or fixed line.
function thenFor(stage) {
  if (stage === 'new') return 'ask_book';
  if (stage === 'booked') return null;
  return 'last_question';
}

function repeatReply(conversation) {
  if (conversation.stage === 'booked') return result('booked', 'booked_confirmation', {});
  return result(conversation.stage, 'fixed:repeat', {}); // resend conversation.last_bot_question
}

function bookingRequest(conversation) {
  if (conversation.stage === 'booked') {
    return result('new', 'ask_service', {
      stage: 'new',
      stage_version: STAGE_VERSION,
      service: '',
      ...freshOffer(),
    });
  }
  if (conversation.stage === 'new') {
    // No service is chosen yet, so there is nothing to offer times for: ask which clean.
    return result('new', 'ask_service', {});
  }
  return result('offer', 'offer_times', { stage: 'offer', stage_version: STAGE_VERSION, ...freshOffer() });
}

// Decides the next stage, reply and column updates for one customer message.
//   conversation: the conversations row (stage, stage_version, service, address, zip, offered_slots,
//                 reoffer_used, unclear_in_a_row, zip_asks, ...)
//   routeResult:  { route, reason, unclearInARow } from rules.route
//   facts:        { services: prices rows, serviceAreas: [zip, ...], zip: ZIP found in the message or null,
//                   customerText: the message, enabled: the node's @guards list (zip_area) }
// Returns { stage, reply, updates } (plus book: <slot id> when a time was picked, and then: which stage
// question follows a writer or fixed reply: 'ask_book', 'last_question' or null). reply is one of
// ask_service, ask_address, ask_address_again, out_of_area, offer_times, later_times,
// booked_confirmation, ask_book, writer, fixed:<name>, handoff:<reason>, close:<reason>, none.
// fixed:repeat resends conversation.last_bot_question.
function next(conversation, routeResult, facts) {
  const f = facts || {};
  const route = routeResult.route;

  // Hazards that do not depend on the stage come first, so an opt-out is honoured on any row.
  if (route === 'opt_out') return result(conversation.stage, 'fixed:opt_out', {});
  if (route === 'wrong_person') return close(conversation, 'wrong_person');
  if (route === 'abusive') return close(conversation, 'abusive');
  if (route === 'prompt_injection') return result(conversation.stage, 'fixed:prompt_injection', {});
  if (route === 'wants_human') return handoff(conversation, 'wants_human');

  if (!STAGES.includes(conversation.stage) || conversation.stage_version !== STAGE_VERSION) {
    return handoff(conversation, 'unknown_stage');
  }
  if (conversation.stage === 'closed') return result('closed', 'none', {});

  if (route === 'handoff') return handoff(conversation, routeResult.reason, counterUpdate(conversation, routeResult));

  const counter = counterUpdate(conversation, routeResult);
  const then = thenFor(conversation.stage);
  switch (route) {
    case 'stage_answer':
      if (conversation.stage === 'new') return newStage(conversation, routeResult, f);
      if (conversation.stage === 'address') return addressStage(conversation, routeResult, f);
      if (conversation.stage === 'offer') return offerStage(conversation, routeResult);
      return bookedStage(conversation, routeResult);
    case 'booking_request':
      return bookingRequest(conversation);
    case 'price_question':
    case 'other_question':
      return result(conversation.stage, 'writer', counter, { then });
    case 'off_topic':
      return result(conversation.stage, 'fixed:off_topic', counter, { then });
    case 'later':
      return result(conversation.stage, 'fixed:later', counter);
    case 'repeat':
      return repeatReply(conversation);
    case 'unclear':
      return result(conversation.stage, 'fixed:unclear', counter, { then });
    default:
      return handoff(conversation, 'unknown_stage');
  }
}

module.exports = { STAGE_VERSION, STAGES, next };
