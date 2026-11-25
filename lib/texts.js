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

function bookableNames(services) {
  return (Array.isArray(services) ? services : [])
    .filter((r) => r.bookable === true || String(r.bookable || '').trim().toLowerCase() === 'yes')
    .map((r) => String(r.service || '').trim().toLowerCase())
    .filter(Boolean);
}

// Appends the follow-up question named by stages.next's 'then' to a reply (section 8: the stage
// question is added after a writer draft or fixed line). Returns { text, question }, where question
// is the new last_bot_question (null: unchanged).
function withThen(text, then, lastBotQuestion) {
  let follow = '';
  let question = null;
  if (then === 'ask_book') {
    follow = TEXTS.book_prompt();
    question = follow;
  } else if (then === 'last_question' && lastBotQuestion) {
    follow = lastBotQuestion;
  }
  const parts = [text, follow].map((s) => String(s || '').trim()).filter(Boolean);
  return { text: parts.join('\n\n'), question };
}

// The customer text for a stages.next reply code that needs no other workflow.
//   ctx: { services: prices rows, zip, lastBotQuestion, then }
// Returns { text, kind, question } (kind 'normal' or 'opt_out_confirmation'; question is the new
// last_bot_question or null for unchanged; text '' means send nothing), or null for the codes other
// workflows produce: writer, offer_times, later_times, booked_confirmation.
function fixedReply(reply, ctx) {
  const c = ctx || {};
  const done = (text, question, kind) => ({ text, kind: kind || 'normal', question: question || null });
  const thenDone = (text) => {
    const w = withThen(text, c.then, c.lastBotQuestion);
    return done(w.text, w.question);
  };
  if (typeof reply !== 'string') throw new Error('fixedReply: reply must be a string');
  if (reply.startsWith('handoff:')) return done(TEXTS.handoff_notice());
  if (reply === 'close:wrong_person') return done(TEXTS.wrong_person_apology());
  if (reply.startsWith('close:')) return done('');
  switch (reply) {
    case 'none':
      return done('');
    case 'ask_service': {
      const q = TEXTS.stage_new(bookableNames(c.services));
      return done(q, q);
    }
    case 'ask_address':
      return done(TEXTS.stage_address(), TEXTS.stage_address());
    case 'ask_address_again':
      return done(TEXTS.stage_address_again(), TEXTS.stage_address());
    case 'out_of_area':
      return done(TEXTS.out_of_area(c.zip));
    case 'ask_book':
      return done(TEXTS.book_prompt(), TEXTS.book_prompt());
    case 'fixed:opt_out':
      return done(TEXTS.opt_out_confirmation(), null, 'opt_out_confirmation');
    case 'fixed:prompt_injection':
      return done(TEXTS.prompt_injection());
    case 'fixed:off_topic':
      return thenDone(TEXTS.off_topic());
    case 'fixed:later':
      return done(TEXTS.later());
    case 'fixed:repeat':
      return done(TEXTS.repeat(c.lastBotQuestion));
    case 'fixed:unclear':
      // "Ask the stage question again" (section 8): the follow-up question is the whole reply.
      return thenDone('');
    case 'writer':
    case 'offer_times':
    case 'later_times':
    case 'booked_confirmation':
      return null;
    default:
      throw new Error('fixedReply: unknown reply code ' + reply);
  }
}

module.exports = { TEXTS, stageQuestion, withThen, fixedReply, NOT_IN_FACTS_LINE };
