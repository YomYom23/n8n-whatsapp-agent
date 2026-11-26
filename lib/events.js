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

// Slack Events API body (design section 4). Returns { challenge } for Slack's URL check, otherwise
// { events, dropped }: only new plain messages posted as a reply in a thread become owner_message
// events. Edits, deletions, file shares, joins (any subtype) and messages from a bot or app are dropped.
// The external ID is Slack's event_id, so a Slack retry is a duplicate. Field names follow Slack's
// documented format (spike 4 was not run against a live app).
function slackEvents(body) {
  if (!body || typeof body !== 'object') return { events: [], dropped: ['not an object'] };
  if (body.type === 'url_verification') return { challenge: String(body.challenge || ''), events: [], dropped: [] };
  const e = body.event;
  if (body.type !== 'event_callback' || !e || typeof e !== 'object') return { events: [], dropped: ['not an event callback'] };
  const why = e.type !== 'message' ? 'not a message'
    : e.subtype ? 'subtype ' + e.subtype
    : e.bot_id || e.app_id ? 'from a bot or app'
    : !e.thread_ts || e.thread_ts === e.ts ? 'not a thread reply'
    : typeof body.event_id !== 'string' || !body.event_id ? 'no event_id'
    : null;
  if (why) return { events: [], dropped: [why] };
  return {
    events: [{
      source: 'slack', external_id: body.event_id, kind: 'owner_message', wa_id: '',
      slack_channel: e.channel || '', slack_thread_ts: e.thread_ts, slack_ts: e.ts, slack_user: e.user || '',
      text: typeof e.text === 'string' ? e.text : '', timestamp: null,
    }],
    dropped: [],
  };
}

// A Slack block_actions payload (the JSON in the form field "payload") -> one owner_action event, or
// null. The thread is the message's thread, or the message itself for buttons on a thread's first post.
// Each click has its own action_ts, so a double click is two events; the handler makes the second a no-op.
function slackAction(payload) {
  if (!payload || typeof payload !== 'object' || payload.type !== 'block_actions') return null;
  const a = Array.isArray(payload.actions) ? payload.actions[0] : null;
  if (!a || typeof a.action_id !== 'string') return null;
  const c = payload.container || {};
  const m = payload.message || {};
  const thread = c.thread_ts || m.thread_ts || c.message_ts || m.ts;
  if (!thread) return null;
  const user = (payload.user && payload.user.id) || '';
  return {
    source: 'slack', external_id: 'action:' + (a.action_ts || '') + ':' + user + ':' + a.action_id, kind: 'owner_action', wa_id: '',
    action_id: a.action_id, value: a.value === undefined ? '' : String(a.value), slack_user: user,
    slack_channel: c.channel_id || (payload.channel && payload.channel.id) || '', slack_thread_ts: thread,
    slack_ts: c.message_ts || m.ts || '', text: '', timestamp: null,
  };
}

// A form-encoded body as [[name, value], ...] in body order, or null if a part can't be decoded.
// Written by hand: n8n's Code-node sandbox has no URLSearchParams.
function parseForm(rawForm) {
  const out = [];
  const dec = (s) => decodeURIComponent(s.replace(/\+/g, ' '));
  try {
    for (const pair of String(rawForm || '').split('&')) {
      if (pair === '') continue;
      const eq = pair.indexOf('=');
      out.push(eq === -1 ? [dec(pair), ''] : [dec(pair.slice(0, eq)), dec(pair.slice(eq + 1))]);
    }
  } catch (e) {
    return null;
  }
  return out;
}

// The JSON in the "payload" field of a form-encoded Slack interactivity body, or null.
function slackFormPayload(rawForm) {
  const pair = (parseForm(rawForm) || []).find((p) => p[0] === 'payload');
  if (!pair) return null;
  try {
    return JSON.parse(pair[1]);
  } catch (e) {
    return null;
  }
}

const TWILIO_FAILED = ['failed', 'undelivered'];
const waIdFromAddress = (addr) => String(addr || '').replace(/^whatsapp:/, '').replace(/\D/g, '');

// A Twilio WhatsApp webhook (the Twilio route, used while Meta's own number can't send). params is
// parseForm's output. Two kinds of request arrive at the same URL:
//   - an incoming message (From = whatsapp:+<number>): one 'text' or 'unsupported' event, keyed by MessageSid;
//   - a status callback for a message we sent (it has MessageStatus): 'failed' and 'undelivered' become
//     send_failed, keyed by MessageSid + ':failed' as for Meta; other statuses are dropped.
// A request for another Twilio account (AccountSid differs from accountSid) gives no events.
function twilioEvents(params, accountSid) {
  const f = {};
  for (const [k, v] of params || []) if (!(k in f)) f[k] = v;
  if (accountSid && f.AccountSid !== accountSid) return { events: [], dropped: 1 };
  const sid = f.MessageSid || f.SmsMessageSid || '';
  if (!sid) return { events: [], dropped: 1 };
  const status = f.MessageStatus || '';
  if (status && status !== 'received') {
    if (!TWILIO_FAILED.includes(status)) return { events: [], dropped: 1 };
    return { events: [{
      source: 'twilio', external_id: sid + ':failed', wa_id: waIdFromAddress(f.To), timestamp: null,
      kind: 'send_failed', text: '',
      error: { code: f.ErrorCode ? Number(f.ErrorCode) : null, title: String(f.ErrorMessage || status) },
    }], dropped: 0 };
  }
  const waId = waIdFromAddress(f.From) || String(f.WaId || '').replace(/\D/g, '');
  if (!waId || !/^whatsapp:/.test(String(f.From || ''))) return { events: [], dropped: 1 };
  const media = Number(f.NumMedia || 0) > 0;
  const type = f.MessageType || (media ? 'media' : 'text');
  const isText = !media && type === 'text' && typeof f.Body === 'string' && f.Body !== '';
  return { events: [{
    source: 'twilio', external_id: sid, wa_id: waId, timestamp: null,
    kind: isText ? 'text' : 'unsupported', text: isText ? f.Body : '', message_type: String(type),
  }], dropped: 0 };
}

module.exports = { metaEvents, replayEvent, slackEvents, slackAction, slackFormPayload, parseForm, twilioEvents };
