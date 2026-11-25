'use strict';
// The section 10 table: whether `send` may send a message right now.
// Pure: the conversation is re-read by the caller and the clock is passed in.

const config = require('./config');

function toMillis(value) {
  // no instanceof: a Date from n8n's Code-node sandbox is from another realm
  return value && typeof value.getTime === 'function' ? value.getTime() : new Date(value).getTime();
}

// True if the last customer message is no older than WINDOW_HOURS at `now`.
// No customer message at all counts as outside the window.
function within24h(lastCustomerAt, now) {
  if (lastCustomerAt === null || lastCustomerAt === undefined || lastCustomerAt === '') return false;
  const last = toMillis(lastCustomerAt);
  const current = toMillis(now);
  if (Number.isNaN(last) || Number.isNaN(current)) return false;
  return current - last <= config.WINDOW_HOURS * 3600000;
}

const SENDER_KINDS = ['bot', 'owner'];
const KINDS = ['normal', 'opt_out_confirmation', 'template'];

// Returns { action: 'send' | 'drop' | 'wait', reason?, notifyThread?, offerButtons?, draftCheck? }.
//   drop: not sent (reason says which rule). wait: kept as waiting.
//   notifyThread: the Slack thread is told. offerButtons: "Send template" / "Discard" offered.
//   draftCheck: on a send, the AI-written text must pass the draft check and 600-character cap.
// enabled: the node's generated @guards list (send_dnc, send_human_owned, send_24h). A rule whose
// guard is missing from it is skipped, for the guard-removal run. Omitted means every guard is on.
function decide({ conversation, onDnc: dnc, addedThisRun, senderKind, kind, now, enabled }) {
  if (!SENDER_KINDS.includes(senderKind)) throw new Error('unknown sender_kind: ' + senderKind);
  if (!KINDS.includes(kind)) throw new Error('unknown kind: ' + kind);
  const on = (id) => !Array.isArray(enabled) || enabled.includes(id);
  const onDnc = Boolean(dnc) && on('send_dnc');
  const rawOwned = Boolean(conversation && conversation.human_owned);
  const owned = rawOwned && on('send_human_owned'); // the guard covers bot sends only
  const inWindow = !on('send_24h') || within24h(conversation && conversation.last_customer_at, now);

  if (kind === 'opt_out_confirmation') {
    // Sent only in the same run that added the number; ignores ownership and the window.
    return addedThisRun
      ? { action: 'send' }
      : { action: 'drop', reason: 'opt_out_not_added_this_run' };
  }

  if (kind === 'template') {
    if (onDnc) return { action: 'drop', reason: 'dnc', notifyThread: true };
    return { action: 'send' }; // templates are allowed outside the window and with the owner
  }

  if (senderKind === 'owner') {
    if (onDnc) return { action: 'drop', reason: 'dnc', notifyThread: true };
    if (!rawOwned) return { action: 'drop', reason: 'not_with_owner', notifyThread: true };
    if (!inWindow) return { action: 'wait', reason: 'outside_24h', notifyThread: true, offerButtons: true };
    return { action: 'send' };
  }

  // Bot, normal
  if (onDnc) return { action: 'drop', reason: 'dnc' };
  if (owned) return { action: 'drop', reason: 'human_owned' };
  if (!inWindow) return { action: 'drop', reason: 'outside_24h' };
  return { action: 'send', draftCheck: true };
}

module.exports = { decide, within24h };
