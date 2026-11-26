'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { metaEvents, replayEvent, parseForm, twilioEvents } = require('../events');

const fixture = () => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'tests', 'fixtures', 'meta', 'text.json'), 'utf8'));
const wrap = (value) => ({ object: 'whatsapp_business_account', entry: [{ id: '1', changes: [{ field: 'messages', value }] }] });

test('metaEvents: a text message becomes one text event', () => {
  const { events, dropped } = metaEvents(fixture());
  assert.equal(dropped, 0);
  assert.deepEqual(events, [{
    source: 'meta', external_id: 'wamid.PLACEHOLDER', wa_id: '15550000001',
    timestamp: new Date(1764601200 * 1000).toISOString(), kind: 'text', text: 'hello', message_type: 'text',
  }]);
});

test('metaEvents: image, audio, reaction and interactive messages are unsupported with empty text', () => {
  for (const type of ['image', 'audio', 'reaction', 'interactive', 'sticker']) {
    const { events } = metaEvents(wrap({ messages: [{ id: 'w1', from: '1555', timestamp: '1', type, [type]: {} }] }));
    assert.equal(events[0].kind, 'unsupported', type);
    assert.equal(events[0].text, '');
    assert.equal(events[0].message_type, type);
  }
});

test('metaEvents: sent, delivered and read statuses are dropped; failed becomes send_failed', () => {
  const { events, dropped } = metaEvents(wrap({ statuses: [
    { id: 'w1', status: 'sent', recipient_id: '1555' },
    { id: 'w1', status: 'delivered', recipient_id: '1555' },
    { id: 'w1', status: 'read', recipient_id: '1555' },
    { id: 'w2', status: 'failed', recipient_id: '1555', timestamp: '1764601200', errors: [{ code: 131047, title: 'Re-engagement message' }] },
  ] }));
  assert.equal(dropped, 3);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    source: 'meta', external_id: 'w2:failed', wa_id: '1555', timestamp: new Date(1764601200 * 1000).toISOString(),
    kind: 'send_failed', text: '', error: { code: 131047, title: 'Re-engagement message' },
  });
});

test('metaEvents: other fields, empty and malformed bodies give no events', () => {
  assert.deepEqual(metaEvents({ entry: [{ changes: [{ field: 'account_update', value: {} }] }] }), { events: [], dropped: 1 });
  assert.deepEqual(metaEvents(null), { events: [], dropped: 0 });
  assert.deepEqual(metaEvents({}), { events: [], dropped: 0 });
  assert.equal(metaEvents(wrap({ messages: [{ type: 'text', text: { body: 'x' } }] })).dropped, 1);
});

test('metaEvents: several messages in one body keep their order', () => {
  const { events } = metaEvents(wrap({ messages: [
    { id: 'a', from: '1', timestamp: '1', type: 'text', text: { body: 'first' } },
    { id: 'b', from: '1', timestamp: '2', type: 'text', text: { body: 'second' } },
  ] }));
  assert.deepEqual(events.map((e) => e.text), ['first', 'second']);
});

test('replayEvent: accepts an internal event and defaults source and text', () => {
  assert.deepEqual(replayEvent({ external_id: 'r1', wa_id: '1555', kind: 'text', text: 'hi' }),
    { external_id: 'r1', wa_id: '1555', kind: 'text', text: 'hi', source: 'meta', timestamp: null });
  assert.equal(replayEvent({ external_id: 'r1', wa_id: '1555', kind: 'unsupported' }).text, '');
  assert.equal(replayEvent({ source: 'slack_events', external_id: 'Ev1', kind: 'owner_message', text: 'x' }).source, 'slack_events');
});

test('replayEvent: refuses missing IDs, unknown kinds and customer events without wa_id', () => {
  assert.equal(replayEvent(null), null);
  assert.equal(replayEvent({ wa_id: '1', kind: 'text' }), null);
  assert.equal(replayEvent({ external_id: 'r', wa_id: '1', kind: 'video' }), null);
  assert.equal(replayEvent({ external_id: 'r', kind: 'text' }), null);
});

test('parseForm decodes + and percent escapes and keeps order and repeats', () => {
  assert.deepEqual(parseForm('a=1&b=hello+world&c=50%25+off+%26+more&a=2&flag'), [['a', '1'], ['b', 'hello world'], ['c', '50% off & more'], ['a', '2'], ['flag', '']]);
  assert.deepEqual(parseForm(''), []);
  assert.equal(parseForm('a=%E0%A4%A'), null);
});

const twForm = (o) => Object.entries(o);
const INBOUND = { MessageSid: 'SM1', AccountSid: 'AC1', From: 'whatsapp:+15550101234', To: 'whatsapp:+14155238886',
  Body: 'Do you clean ovens?', NumMedia: '0', SmsStatus: 'received', WaId: '15550101234' };

test('twilioEvents: an incoming text becomes a text event keyed by MessageSid', () => {
  assert.deepEqual(twilioEvents(twForm(INBOUND), 'AC1'), { events: [{ source: 'twilio', external_id: 'SM1', wa_id: '15550101234',
    timestamp: null, kind: 'text', text: 'Do you clean ovens?', message_type: 'text' }], dropped: 0 });
});

test('twilioEvents: media, other message types and empty bodies are unsupported', () => {
  assert.equal(twilioEvents(twForm({ ...INBOUND, NumMedia: '1', Body: '' }), 'AC1').events[0].kind, 'unsupported');
  assert.equal(twilioEvents(twForm({ ...INBOUND, MessageType: 'location' }), 'AC1').events[0].kind, 'unsupported');
  assert.equal(twilioEvents(twForm({ ...INBOUND, Body: '' }), 'AC1').events[0].kind, 'unsupported');
});

test('twilioEvents: failed and undelivered status callbacks become send_failed; others are dropped', () => {
  const cb = { MessageSid: 'SM9', AccountSid: 'AC1', From: 'whatsapp:+14155238886', To: 'whatsapp:+15550101234', ErrorCode: '63016', ErrorMessage: 'Outside window' };
  assert.deepEqual(twilioEvents(twForm({ ...cb, MessageStatus: 'undelivered', SmsStatus: 'undelivered' }), 'AC1').events,
    [{ source: 'twilio', external_id: 'SM9:failed', wa_id: '15550101234', timestamp: null, kind: 'send_failed', text: '', error: { code: 63016, title: 'Outside window' } }]);
  assert.equal(twilioEvents(twForm({ ...cb, MessageStatus: 'failed' }), 'AC1').events[0].kind, 'send_failed');
  for (const s of ['queued', 'sent', 'delivered', 'read']) assert.deepEqual(twilioEvents(twForm({ ...cb, MessageStatus: s }), 'AC1').events, []);
});

test('twilioEvents: another account, a missing SID or a non-WhatsApp sender gives no events', () => {
  assert.deepEqual(twilioEvents(twForm(INBOUND), 'AC2').events, []);
  assert.deepEqual(twilioEvents(twForm({ ...INBOUND, MessageSid: '' }), 'AC1').events, []);
  assert.deepEqual(twilioEvents(twForm({ ...INBOUND, From: '+15550101234' }), 'AC1').events, []);
});
