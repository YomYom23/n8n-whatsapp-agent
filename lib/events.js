'use strict';
// Turns webhook bodies into the internal event format (design section 4):
//   { source, external_id, wa_id, timestamp (ISO), kind, text, message_type?, error? }
// kind is 'text', 'unsupported' (images, voice notes, reactions, buttons and the rest) or
// 'send_failed' (a Meta status event with status 'failed'). Other status events are dropped.

function isoFromSeconds(seconds) {
  const n = Number(seconds);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
}

// body: the parsed Meta webhook body. Returns { events, dropped } where dropped counts the
// status events (sent, delivered, read) and changes for other fields that were skipped.
function metaEvents(body) {
  const events = [];
  let dropped = 0;
  const entries = body && Array.isArray(body.entry) ? body.entry : [];
  for (const entry of entries) {
    for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      const value = change && change.value;
      if (!change || change.field !== 'messages' || !value) {
        dropped++;
        continue;
      }
      for (const m of Array.isArray(value.messages) ? value.messages : []) {
        if (!m || !m.id || !m.from) {
          dropped++;
          continue;
        }
        const isText = m.type === 'text' && m.text && typeof m.text.body === 'string';
        events.push({
          source: 'meta',
          external_id: String(m.id),
          wa_id: String(m.from),
          timestamp: isoFromSeconds(m.timestamp),
          kind: isText ? 'text' : 'unsupported',
          text: isText ? m.text.body : '',
          message_type: String(m.type || 'unknown'),
        });
      }
      for (const s of Array.isArray(value.statuses) ? value.statuses : []) {
        if (!s || s.status !== 'failed' || !s.id) {
          dropped++;
          continue;
        }
        const err = Array.isArray(s.errors) && s.errors[0] ? s.errors[0] : {};
        events.push({
          source: 'meta',
          // a message can fail only once, so its ID plus the status is unique
          external_id: String(s.id) + ':failed',
          wa_id: String(s.recipient_id || ''),
          timestamp: isoFromSeconds(s.timestamp),
          kind: 'send_failed',
          text: '',
          error: { code: err.code == null ? null : err.code, title: String(err.title || err.message || '') },
        });
      }
    }
  }
  return { events, dropped };
}

const REPLAY_KINDS = ['text', 'unsupported', 'send_failed', 'owner_message', 'owner_action'];

// ingress-replay: the body is already an internal event. Returns the event, or null if a required
// field is missing or the kind is unknown. source defaults to 'meta', the path the event stands in for.
function replayEvent(body) {
  if (!body || typeof body !== 'object') return null;
  const { external_id: id, wa_id: waId, kind } = body;
  if (typeof id !== 'string' || id === '' || typeof kind !== 'string' || !REPLAY_KINDS.includes(kind)) return null;
  if ((kind === 'text' || kind === 'unsupported') && (typeof waId !== 'string' || waId === '')) return null;
  return {
    ...body,
    source: typeof body.source === 'string' && body.source ? body.source : 'meta',
    text: typeof body.text === 'string' ? body.text : '',
    timestamp: typeof body.timestamp === 'string' ? body.timestamp : null,
  };
}

module.exports = { metaEvents, replayEvent };
