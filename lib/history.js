'use strict';
// Conversation history from message_log rows, oldest first.
// A turn's bot reply is logged before the customer message that caused it (the in row is written
// at the end of the turn, with its route), and both carry the turn's logged_at. So rows are ordered
// by logged_at, then the customer's message before the bot's reply, then row id; not by id alone.

const DIRECTION_ORDER = { in: 0, out: 1 };

function rowTime(r) {
  const t = Date.parse(r.logged_at || r.createdAt || '');
  return Number.isFinite(t) ? t : 0;
}

// rows: message_log rows -> the in and out rows, in conversation order. Event rows are dropped.
function orderHistory(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && (r.direction === 'in' || r.direction === 'out'))
    .slice()
    .sort((a, b) => rowTime(a) - rowTime(b)
      || DIRECTION_ORDER[a.direction] - DIRECTION_ORDER[b.direction]
      || Number(a.id) - Number(b.id));
}

module.exports = { orderHistory };
