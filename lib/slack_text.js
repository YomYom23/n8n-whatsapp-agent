'use strict';
// Slack text helpers (design section 11): owner mrkdwn to plain text, escaping customer text,
// the // team note rule, and the Block Kit posts for handoff and close alerts.

const { LIMITS } = require('./config');
const { maskNumber } = require('./mask');

// Stable action IDs. The interactivity workflow routes on these, so they must not change.
const ACTION_IDS = {
  RETURN_TO_BOT: 'return_to_bot',
  MARK_BOOKED: 'mark_booked',
  REOPEN: 'reopen',
  SEND_TEMPLATE: 'send_template',
  DISCARD_WAITING: 'discard_waiting',
};

// Not in config.js: each quoted history message is cut to this many characters (a Slack section holds 3000).
const HISTORY_TEXT_MAX_CHARS = 300;

const HANDOFF_REASON_LABELS = {
  wants_human: 'Customer asked for a person',
  unclear: 'Bot could not understand the customer',
  jev_unavailable: 'AI service unavailable',
  change_booking: 'Customer wants to change a booking',
  slots_exhausted: 'No times left to offer',
  booking_key_deleted: 'Booking calendar entry was deleted',
  unknown_stage: 'Conversation in an unknown stage',
  zip_not_found: 'ZIP code not found after asking',
};

const CLOSE_REASON_LABELS = {
  wrong_person: 'Wrong person',
  abusive: 'Abusive messages',
};

const AUTHOR_LABELS = { customer: 'Customer', bot: 'Bot', owner: 'Owner', system: 'System' };

// Escapes customer text so it cannot trigger mentions (<!channel>) or disguised links.
function escapeForSlack(text) {
  if (text === null || text === undefined) return '';
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Turns one <...> token of Slack mrkdwn into plain text.
function plainToken(inner) {
  const bar = inner.indexOf('|');
  const target = bar === -1 ? inner : inner.slice(0, bar);
  const label = bar === -1 ? '' : inner.slice(bar + 1);
  if (target.startsWith('@')) return ''; // user mention: nothing sensible for a customer
  if (target.startsWith('#')) return label ? '#' + label : '';
  if (target.startsWith('!')) return label && !/^(here|channel|everyone)$/.test(target.slice(1)) ? label : '';
  if (/^(mailto|tel):/i.test(target)) return label || target.replace(/^(mailto|tel):/i, '');
  if (!label || label === target) return target;
  return label + ' (' + target + ')';
}

// Slack mrkdwn from the owner to plain text for the customer.
// Links, mentions, special mentions and the three HTML entities (&amp; last, so &amp;lt; stays &lt;).
function toPlain(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/<([^<>]+)>/g, (m, inner) => plainToken(inner))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

// A thread message starting with // is a note for the team and is never sent to the customer.
function isTeamNote(text) {
  if (text === null || text === undefined) return false;
  return String(text).trim().startsWith('//');
}

function truncate(text, max) {
  return text.length > max ? text.slice(0, max - 3) + '...' : text;
}

function quote(text) {
  return text
    .split('\n')
    .map((line) => '> ' + line)
    .join('\n');
}

function button(label, actionId, value, style) {
  const b = { type: 'button', text: { type: 'plain_text', text: label }, action_id: actionId };
  if (value !== undefined && value !== null && value !== '') b.value = String(value);
  if (style) b.style = style;
  return b;
}

function sectionBlock(mrkdwn) {
  return { type: 'section', text: { type: 'mrkdwn', text: mrkdwn } };
}

function slotLabels(offeredSlots) {
  if (!Array.isArray(offeredSlots)) return [];
  return offeredSlots.map((s) => (s && typeof s === 'object' ? s.label : s)).filter((l) => l);
}

// The first post of a handoff thread.
// { waId, reason, stage, offeredSlots: [{ id, label }], history: [{ author, text }], episode } -> { text, blocks }
// Customer-originated text is escaped. The number is masked except its last 4 digits.
function handoffPost({ waId, reason, stage, offeredSlots, history, episode } = {}) {
  const masked = maskNumber(waId);
  const reasonLabel = HANDOFF_REASON_LABELS[reason] || escapeForSlack(reason || 'unknown');
  const lines = [
    '*Handoff: ' + reasonLabel + '*',
    'Customer: ' + masked,
    'Stage: ' + escapeForSlack(stage || 'unknown'),
  ];
  const slots = slotLabels(offeredSlots);
  if (slots.length) lines.push('Offered times: ' + slots.map(escapeForSlack).join('; '));

  const recent = Array.isArray(history) ? history.slice(-LIMITS.historyMessages) : [];
  if (recent.length) {
    lines.push('', 'Last messages:');
    for (const m of recent) {
      const author = AUTHOR_LABELS[m && m.author] || escapeForSlack((m && m.author) || 'Unknown');
      const body = truncate(escapeForSlack(m && m.text), HISTORY_TEXT_MAX_CHARS);
      lines.push(author + ':', quote(body));
    }
  }
  lines.push('', 'Reply in this thread to message the customer. Start a reply with // for a note that is not sent.');

  return {
    text: 'Handoff (' + reasonLabel + ') for ' + masked,
    blocks: [
      sectionBlock(lines.join('\n')),
      {
        type: 'actions',
        elements: [
          button('Return to bot', ACTION_IDS.RETURN_TO_BOT, episode, 'primary'),
          button('Mark as booked', ACTION_IDS.MARK_BOOKED, episode),
        ],
      },
    ],
  };
}

// The alert posted when a conversation is closed (wrong_person or abusive), with a Reopen button.
// { waId, reason, stageBeforeClose } -> { text, blocks }
function closeAlertPost({ waId, reason, stageBeforeClose } = {}) {
  const masked = maskNumber(waId);
  const reasonLabel = CLOSE_REASON_LABELS[reason] || escapeForSlack(reason || 'unknown');
  const lines = [
    '*Conversation closed: ' + reasonLabel + '*',
    'Customer: ' + masked,
    'Stage before closing: ' + escapeForSlack(stageBeforeClose || 'unknown'),
    '',
    'Later messages from this customer are posted in this thread and get no reply. Reopen to put the conversation back.',
  ];
  return {
    text: 'Conversation closed (' + reasonLabel + ') for ' + masked,
    blocks: [
      sectionBlock(lines.join('\n')),
      { type: 'actions', elements: [button('Reopen', ACTION_IDS.REOPEN)] },
    ],
  };
}

module.exports = {
  ACTION_IDS,
  toPlain,
  escapeForSlack,
  isTeamNote,
  handoffPost,
  closeAlertPost,
};
