'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { metaEvents, replayEvent } = require('../events');

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
