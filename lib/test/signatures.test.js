'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { verifyMeta, verifySlack } = require('../signatures');

const SECRET = 'app-secret';
const BS = '\\'; // one backslash
const metaSig = (body, secret = SECRET) => 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

test('verifyMeta: body with emoji signed correctly is true', () => {
  const body = JSON.stringify({ text: { body: 'hi 😀 café' } });
  assert.equal(verifyMeta(body, metaSig(body), SECRET, crypto), true);
  const bytes = Buffer.from(body, 'utf8');
  assert.equal(verifyMeta(bytes, metaSig(bytes), SECRET, crypto), true);
});

test('verifyMeta: escaped body is checked over the raw bytes, not a re-serialised copy', () => {
  const raw = '{"text":{"body":"caf' + BS + 'u00e9 ' + BS + 'ud83d' + BS + 'ude00"}}';
  assert.equal(verifyMeta(Buffer.from(raw), metaSig(raw), SECRET, crypto), true);
  const reserialised = JSON.stringify(JSON.parse(raw));
  assert.notEqual(reserialised, raw);
  assert.equal(verifyMeta(reserialised, metaSig(raw), SECRET, crypto), false);
});

test('verifyMeta: header of the wrong length is false without throwing', () => {
  const body = '{"a":1}';
  assert.equal(verifyMeta(body, 'sha256=abcd', SECRET, crypto), false);
  assert.equal(verifyMeta(body, metaSig(body) + '00', SECRET, crypto), false);
});

test('verifyMeta: missing prefix, wrong secret, tampered body are false', () => {
  const body = '{"a":1}';
  assert.equal(verifyMeta(body, metaSig(body).slice(7), SECRET, crypto), false);
  assert.equal(verifyMeta(body, metaSig(body, 'other'), SECRET, crypto), false);
  assert.equal(verifyMeta(body + ' ', metaSig(body), SECRET, crypto), false);
});

test('verifyMeta: bad input never throws', () => {
  for (const args of [
    [undefined, undefined, undefined],
    [null, null, SECRET],
    ['x', 123, SECRET],
    ['x', 'sha256=zz', SECRET],
    ['x', 'sha256=', SECRET],
    ['x', metaSig('x'), ''],
    [{}, metaSig('x'), SECRET],
  ]) {
    assert.equal(verifyMeta(args[0], args[1], args[2], crypto), false);
  }
  assert.equal(verifyMeta('x', metaSig('x'), SECRET, undefined), false);
});

test('verifyMeta: uppercase hex digits are accepted', () => {
  const body = 'x';
  const sig = 'sha256=' + metaSig(body).slice(7).toUpperCase();
  assert.equal(verifyMeta(body, sig, SECRET, crypto), true);
});

const slackSig = (body, ts, secret) => 'v0=' + crypto.createHmac('sha256', secret).update('v0:' + ts + ':' + body).digest('hex');

test('verifySlack: the example from Slack documentation', () => {
  const secret = '8f742231b10e8888abcd99yyyzzz85a5';
  const ts = '1531420618';
  const body = 'token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c';
  const sig = 'v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503';
  assert.equal(verifySlack(body, ts, sig, secret, 1531420618 * 1000, crypto), true);
  assert.equal(verifySlack(body, ts, sig.replace('a2114', 'b2114'), secret, 1531420618 * 1000, crypto), false);
});

test('verifySlack: form body, string or Buffer, fresh timestamp', () => {
  const now = 1700000000000;
  const ts = '1700000000';
  const body = 'payload=%7B%22text%22%3A%22caf%C3%A9%20%F0%9F%98%80%22%7D';
  const sig = slackSig(body, ts, 'sign');
  assert.equal(verifySlack(body, ts, sig, 'sign', now, crypto), true);
  assert.equal(verifySlack(Buffer.from(body), 1700000000, sig, 'sign', now, crypto), true);
  assert.equal(verifySlack(body, ts, sig, 'sign', new Date(now), crypto), true);
});

test('verifySlack: refuses timestamps older or further ahead than 5 minutes', () => {
  const body = 'a=b';
  const now = 1700000000000;
  const at = (offsetSeconds) => {
    const ts = String(1700000000 + offsetSeconds);
    return verifySlack(body, ts, slackSig(body, ts, 'sign'), 'sign', now, crypto);
  };
  assert.equal(at(-299), true);
  assert.equal(at(-300), true);
  assert.equal(at(-301), false);
  assert.equal(at(300), true);
  assert.equal(at(301), false);
});

test('verifySlack: wrong length, missing prefix, wrong secret, bad timestamp are false', () => {
  const now = 1700000000000;
  const ts = '1700000000';
  const sig = slackSig('a=b', ts, 'sign');
  assert.equal(verifySlack('a=b', ts, 'v0=abc', 'sign', now, crypto), false);
  assert.equal(verifySlack('a=b', ts, sig.slice(3), 'sign', now, crypto), false);
  assert.equal(verifySlack('a=b', ts, sig, 'other', now, crypto), false);
  assert.equal(verifySlack('a=b', 'abc', sig, 'sign', now, crypto), false);
  assert.equal(verifySlack('a=b', '', sig, 'sign', now, crypto), false);
  assert.equal(verifySlack('a=b', ts, sig, 'sign', undefined, crypto), false);
});

test('verifySlack: bad input never throws', () => {
  assert.equal(verifySlack(undefined, undefined, undefined, undefined, undefined, crypto), false);
  assert.equal(verifySlack('a=b', '1700000000', 'v0=00', 'sign', 1700000000000, undefined), false);
});

test('verifyMeta and verifySlack accept a body and Date from another realm (n8n Code-node sandbox)', () => {
  const vm = require('node:vm');
  const crypto = require('node:crypto');
  const ctx = vm.createContext({});
  const text = '{"text":"hi"}';
  const foreignBody = vm.runInContext('new Uint8Array([' + Array.from(Buffer.from(text)).join(',') + '])', ctx);
  assert.equal(foreignBody instanceof Uint8Array, false); // really another realm
  const sig = 'sha256=' + crypto.createHmac('sha256', 's').update(text).digest('hex');
  assert.equal(verifyMeta(foreignBody, sig, 's', crypto), true);
  const ts = 1700000000;
  const ssig = 'v0=' + crypto.createHmac('sha256', 's').update('v0:' + ts + ':' + text).digest('hex');
  const foreignNow = vm.runInContext('new Date(' + ts * 1000 + ')', ctx);
  assert.equal(verifySlack(foreignBody, String(ts), ssig, 's', foreignNow, crypto), true);
});
