'use strict';
// Booking key, the result of the three checks, and the slot-taken path (design section 12).
// Pure: crypto is passed in.

// Google event IDs allow a-v and 0-9; a SHA-256 hex digest (0-9, a-f) always fits.
function eventId(waId, slotId, crypto) {
  return crypto.createHash('sha256').update('booking:' + waId + ':' + slotId).digest('hex');
}

// existing: the Google event fetched by its ID, or null/undefined if there is none
//           (an object with status 'cancelled' counts as cancelled).
// allowed: check 2 (not past, outside minimum notice). free: check 3 (no busy overlap).
// Check 1 comes first so our own event is never seen as busy.
function afterChecks({ existing, allowed, free }) {
  if (existing) return existing.status === 'cancelled' ? 'key_deleted' : 'already_booked';
  if (!allowed || !free) return 'taken';
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

module.exports = { eventId, afterChecks, onTaken };
