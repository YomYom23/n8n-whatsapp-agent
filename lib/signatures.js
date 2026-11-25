'use strict';
// Webhook signature checks (design section 4). Pure: the crypto module and the current time are passed in.
// Both functions return true or false and never throw on bad input.

const META_PREFIX = 'sha256=';
const SLACK_PREFIX = 'v0=';
// Slack refuses requests whose timestamp is more than 5 minutes away from now (past or future).
const SLACK_MAX_AGE_SECONDS = 300;

// No instanceof here: n8n runs Code nodes in a sandbox, so a Buffer made there comes from another
// realm and fails "instanceof Uint8Array". ArrayBuffer.isView works across realms.
function isBody(rawBody) {
  return typeof rawBody === 'string' || (rawBody != null && ArrayBuffer.isView(rawBody));
}

// Compares two hex strings in constant time, after comparing lengths.
function safeEqualHex(expectedHex, givenHex, crypto) {
  const expected = Buffer.from(expectedHex, 'utf8');
  const given = Buffer.from(givenHex.toLowerCase(), 'utf8');
  if (expected.length !== given.length) return false;
  return crypto.timingSafeEqual(expected, given);
}

function nowMs(now) {
  if (typeof now === 'number') return now;
  if (now && typeof now.getTime === 'function') return now.getTime(); // a Date, from any realm
  if (now && typeof now.toMillis === 'function') return now.toMillis();
  return NaN;
}

// Meta: X-Hub-Signature-256 is "sha256=" + HMAC-SHA256 hex of the raw request bytes with the app secret.
// The check must run over the raw bytes: Meta escapes non-ASCII text as unicode escape sequences,
// so re-serialising the parsed body changes the bytes.
function verifyMeta(rawBody, header, secret, crypto) {
  try {
    if (!isBody(rawBody) || typeof header !== 'string' || typeof secret !== 'string' || !secret) return false;
    if (!header.startsWith(META_PREFIX)) return false;
    const given = header.slice(META_PREFIX.length);
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    return safeEqualHex(expected, given, crypto);
  } catch (e) {
    return false;
  }
}

// Slack: X-Slack-Signature is "v0=" + HMAC-SHA256 hex of "v0:<timestamp>:<raw body>" with the signing secret.
// timestamp is X-Slack-Request-Timestamp (seconds); now is the current time in milliseconds (a Date also works).
function verifySlack(rawBody, timestamp, header, secret, now, crypto) {
  try {
    if (!isBody(rawBody) || typeof header !== 'string' || typeof secret !== 'string' || !secret) return false;
    const ts = String(timestamp === undefined || timestamp === null ? '' : timestamp).trim();
    if (!/^\d{1,15}$/.test(ts)) return false;
    const nowMillis = nowMs(now);
    if (!Number.isFinite(nowMillis)) return false;
    if (Math.abs(nowMillis / 1000 - Number(ts)) > SLACK_MAX_AGE_SECONDS) return false;
    if (!header.startsWith(SLACK_PREFIX)) return false;
    const given = header.slice(SLACK_PREFIX.length);
    const expected = crypto
      .createHmac('sha256', secret)
      .update('v0:' + ts + ':')
      .update(rawBody)
      .digest('hex');
    return safeEqualHex(expected, given, crypto);
  } catch (e) {
    return false;
  }
}

module.exports = { verifyMeta, verifySlack };
