'use strict';
// Every fixed customer line (design sections 6, 8, 9, 10, 11; file 18). Each entry is a function
// returning the text, so the build script and callers treat them all alike.

const NOT_IN_FACTS_LINE = "I'll pass that to the team";

const TEXTS = {
  // Stage questions (section 9).
  stage_new: (services) =>
    'Which clean would you like?' +
    (Array.isArray(services) && services.length > 0 ? ' We offer ' + joinList(services) + '.' : ''),
  stage_address: () => "What's the address for the clean, including the ZIP code?",
  stage_address_again: () =>
    "Sorry, I couldn't find a ZIP code in that. What's the address for the clean, including the ZIP code?",
  stage_offer: (labels) => numbered('Here are the next times we have open:', labels),
  stage_offer_later: (labels) => numbered('Here are some later times.', labels),
  stage_booked: () => '',
  book_prompt: () => 'Would you like to book a clean?',

  // Gate and sending (sections 6, 10).
  opt_out_confirmation: () => "You're opted out and won't get any more messages from us. Reply START to turn them back on.",
  start_reply: () => 'Messages are back on. Reply STOP at any time to opt out.',
  handoff_notice: () => "Thanks, I'm passing this to a member of our team, who'll reply here",
  unsupported_kind: () => 'I can only read text messages here',

  // Routes (section 8).
  out_of_area: (zip) =>
    zip
      ? "Sorry, we don't clean in ZIP code " + zip + ' yet. If you have another address, send it and I will check.'
      : "Sorry, we don't clean in that area yet. If you have another address, send it and I will check.",
  prompt_injection: () => 'I can help with questions about our cleaning and with bookings',
  off_topic: () => "I'm the assistant for a cleaning company, so I can only help with our cleaning and bookings.",
  repeat: (lastQuestion) =>
    lastQuestion ? 'Sure, here it is again. ' + lastQuestion : "There's nothing more I need from you right now.",
  later: () => 'No problem. Message me whenever it suits you.',
  not_in_facts: () => NOT_IN_FACTS_LINE,
  draft_fallback: () => "Sorry, I can't answer that one properly. " + NOT_IN_FACTS_LINE,
  wrong_person_apology: () => "Sorry about that, we have the wrong number. We won't message you again.",
  facts_unavailable: () => "Sorry, I can't look that up right now. " + NOT_IN_FACTS_LINE,

  // Owner's template button (section 11). Sent outside the 24-hour window.
  template: () => 'We have an update on your enquiry. Reply here to see it.',
};

function joinList(items) {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}

function numbered(intro, labels) {
  const list = (labels || []).map((l, i) => i + 1 + ') ' + l).join('\n');
  return intro + '\n' + list + '\nReply with the number of the one that works best, or "none" if none of these suit you.';
}

// The question a stage asks, for stage logic and for 'repeat'. vars: { services, labels, later }.
function stageQuestion(stage, vars) {
  const v = vars || {};
  switch (stage) {
    case 'new':
      return TEXTS.stage_new(v.services);
    case 'address':
      return TEXTS.stage_address();
    case 'offer':
      return v.later ? TEXTS.stage_offer_later(v.labels) : TEXTS.stage_offer(v.labels);
    default:
      return '';
  }
}

module.exports = { TEXTS, stageQuestion, NOT_IN_FACTS_LINE };
