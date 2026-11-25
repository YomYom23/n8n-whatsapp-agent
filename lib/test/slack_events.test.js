'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { slackEvents, slackAction, slackFormPayload } = require('../events');

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'tests', 'fixtures', 'slack', name), 'utf8'));

test('slackEvents: url_verification returns the challenge', () => {
  assert.deepEqual(slackEvents(fixture('url_verification.json')), { challenge: 'dryrun-challenge-123', events: [], dropped: [] });
});

test('slackEvents: a plain thread reply becomes an owner_message with the event_id as external ID', () => {
  const r = slackEvents(fixture('thread_message.json'));
  assert.equal(r.events.length, 1);
  const e = r.events[0];
  assert.equal(e.kind, 'owner_message');
  assert.equal(e.external_id, 'Ev0DRYRUN01');
  assert.equal(e.slack_thread_ts, '1732480000.000001');
  assert.equal(e.slack_user, 'UOWNER0001');
  assert.match(e.text, /Thursday works/);
});

test('slackEvents: edits, bots, joins, files and top-level messages are dropped', () => {
  const base = fixture('thread_message.json');
  const variant = (patch) => ({ ...base, event: { ...base.event, ...patch } });
  for (const patch of [{ subtype: 'message_changed' }, { subtype: 'message_deleted' }, { subtype: 'file_share' }, { subtype: 'channel_join' },
    { bot_id: 'B1' }, { app_id: 'A1' }, { thread_ts: undefined }, { thread_ts: base.event.ts }, { type: 'reaction_added' }]) {
    assert.equal(slackEvents(variant(patch)).events.length, 0, JSON.stringify(patch));
  }
  assert.equal(slackEvents({ type: 'app_rate_limited' }).events.length, 0);
  assert.equal(slackEvents(null).events.length, 0);
});

test('slackAction: a button on the thread starter uses the message as the thread', () => {
  const e = slackAction(fixture('block_action.json'));
  assert.equal(e.kind, 'owner_action');
  assert.equal(e.action_id, 'return_to_bot');
  assert.equal(e.slack_thread_ts, '1732480000.000001');
  assert.equal(e.slack_user, 'UOWNER0001');
  assert.equal(e.value, '1');
});

test('slackAction: a button inside a thread uses the thread; each click has its own external ID', () => {
  const p = fixture('block_action.json');
  p.container = { ...p.container, message_ts: '1732480000.000009', thread_ts: '1732480000.000001' };
  const a = slackAction(p);
  assert.equal(a.slack_thread_ts, '1732480000.000001');
  const p2 = JSON.parse(JSON.stringify(p));
  p2.actions[0].action_ts = '1764601301.000300';
  assert.notEqual(slackAction(p2).external_id, a.external_id);
});

test('slackAction: other payload types or no action give null', () => {
  assert.equal(slackAction({ type: 'view_submission' }), null);
  assert.equal(slackAction({ type: 'block_actions', actions: [] }), null);
  assert.equal(slackAction(null), null);
});

test('slackFormPayload: decodes the payload field of a form body, spaces as +', () => {
  const body = { type: 'block_actions', message: { text: 'a b&c=d' } };
  const raw = 'foo=1&payload=' + encodeURIComponent(JSON.stringify(body)).replace(/%20/g, '+');
  assert.deepEqual(slackFormPayload(raw), body);
  assert.equal(slackFormPayload('foo=1'), null);
  assert.equal(slackFormPayload('payload=%7Bbad'), null);
});
