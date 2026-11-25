'use strict';
// Booking key, the result of the three checks, and the slot-taken path (design section 12).
// Pure: crypto and Luxon's DateTime are passed in.

const slots = require('./slots');
const { TEXTS } = require('./texts');

// Google event IDs allow a-v and 0-9; a SHA-256 hex digest (0-9, a-f) always fits.
function eventId(waId, slotId, crypto) {
  return crypto.createHash('sha256').update('booking:' + waId + ':' + slotId).digest('hex');
}

// existing: the Google event fetched by its ID, or null/undefined if there is none
//           (an object with status 'cancelled' counts as cancelled).
// allowed: check 2 (not past, outside minimum notice). free: check 3 (no busy overlap).
// Check 1 comes first so our own event is never seen as busy.
// enabled: the node's @guards list (book_already, book_allowed, book_free); a check whose guard is
// missing is skipped, for the guard-removal run. Omitted means every guard is on.
function afterChecks({ existing, allowed, free, enabled }) {
  const on = (id) => !Array.isArray(enabled) || enabled.includes(id);
  if (existing && on('book_already')) return existing.status === 'cancelled' ? 'key_deleted' : 'already_booked';
  if ((!allowed && on('book_allowed')) || (!free && on('book_free'))) return 'taken';
  return 'book';
}

// Lead Bot's slot-taken path: fresh times once, then a handoff on the second time.
// The offered times are cleared so the next reply works out fresh ones from now.
function onTaken(conversation) {
  const count = Number(conversation.slot_taken_count) || 0;
  const updates = { slot_taken_count: count + 1 };
  if (count + 1 > 1) return { reply: 'handoff:slots_exhausted', updates };
  updates.offered_slots = '[]';
  updates.last_offered_day = '';
  return { reply: 'offer_times', updates };
}

// The service's booked length from the prices rows (section 12: duration_minutes, also for hourly).
function durationFor(services, serviceName) {
  const want = String(serviceName || '').trim().toLowerCase();
  const row = (services || []).find((r) => String(r.service || '').trim().toLowerCase() === want);
  const minutes = row ? Number(row.duration_minutes) : NaN;
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}

// Offer three times (mode 'offer') or the later times (mode 'later': after the last offered day).
// updates: column changes decided so far, kept and extended. Returns { action: 'send', text,
// question, updates } or { action: 'handoff', reason, updates } when no free time is left.
function offerReply({ mode, conversation, busy, hours, durationMinutes, now, tz, DateTime, updates }) {
  const c = conversation || {};
  const afterDay = mode === 'later' && c.last_offered_day ? String(c.last_offered_day).slice(0, 10) : undefined;
  const found = slots.earliestPerDay({ now, hours, busy, durationMinutes, afterDay, tz, DateTime });
  if (found.length === 0) return { action: 'handoff', reason: 'slots_exhausted', updates: {} };
  const labels = found.map((s) => s.label);
  const text = mode === 'later' ? TEXTS.stage_offer_later(labels) : TEXTS.stage_offer(labels);
  return {
    action: 'send', text, question: text,
    updates: { ...(updates || {}), offered_slots: JSON.stringify(found), last_offered_day: found[found.length - 1].day },
  };
}

// The confirmation once a slot is booked (or found already booked on a retry).
function bookedReply({ slotId, eventId: id, tz, DateTime, updates }) {
  const start = slots.startFromSlotId(slotId);
  const label = slots.slotLabel(DateTime.fromMillis(start, { zone: tz }));
  return {
    action: 'send', text: TEXTS.booked_confirmation(label), question: null,
    updates: { ...(updates || {}), booked_event_id: id, booked_label: label },
  };
}

module.exports = { eventId, afterChecks, onTaken, durationFor, offerReply, bookedReply };
