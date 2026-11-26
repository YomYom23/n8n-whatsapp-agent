'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { plan, evaluate, evaluateHandshake, report, redact, HANDSHAKE_CHALLENGE } = require('../doctor');

const ENV = {
  META_GRAPH_VERSION: 'v25.0', META_PHONE_NUMBER_ID: '100000000000000', META_WABA_ID: '200000000000000',
  META_APP_SECRET: 's3cret', META_VERIFY_TOKEN: 'vt', META_TEMPLATE_NAME: 'enquiry_update', META_TEMPLATE_LANG: 'en_US',
  WEBHOOK_URL: 'https://example.ngrok-free.app/',
};
const ok = (body) => ({ statusCode: 200, body });
const gerr = (status, code, message, sub) => ({ statusCode: status, body: { error: { message, code, error_subcode: sub, type: 'OAuthException' } } });
const HEALTHY_PHONE = { display_phone_number: '+1 555-010-1234', verified_name: 'Sparkle Clean', code_verification_status: 'VERIFIED',
  quality_rating: 'GREEN', platform_type: 'CLOUD_API', status: 'CONNECTED', health_status: { can_send_message: 'AVAILABLE', entities: [] } };

test('plan lists all six Graph checks and the handshake when the env is complete', () => {
  const p = plan(ENV);
  assert.deepEqual(p.requests.map((r) => r.check), ['token', 'token_scopes', 'phone_number', 'waba_subscription', 'template', 'waba_health']);
  assert.equal(p.requests[2].path, '100000000000000');
  assert.equal(p.requests[4].query.name, 'enquiry_update');
  assert.deepEqual(p.handshake, { url: 'https://example.ngrok-free.app/webhook/ingress-whatsapp', challenge: HANDSHAKE_CHALLENGE });
  assert.ok(p.env_results.every((r) => r.status === 'pass'));
});

test('without META_WABA_ID the account checks are left out, with a warning', () => {
  const p = plan({ ...ENV, META_WABA_ID: '' });
  assert.deepEqual(p.requests.map((r) => r.check), ['token', 'token_scopes', 'phone_number']);
  assert.equal(p.env_results.find((r) => r.check === 'env:waba_id').status, 'warn');
});

test('bad env values fail without showing secrets', () => {
  const p = plan({ ...ENV, META_GRAPH_VERSION: '25', META_PHONE_NUMBER_ID: 'abc', META_APP_SECRET: '' });
  const by = Object.fromEntries(p.env_results.map((r) => [r.check, r]));
  assert.equal(by['env:graph_version'].status, 'fail');
  assert.equal(by['env:phone_number_id'].status, 'fail');
  assert.equal(by['env:app_secret'].status, 'fail');
  assert.equal(by['env:verify_token'].detail.includes('vt'), false);
  assert.equal(p.requests.some((r) => r.check === 'phone_number'), false);
});

test('a plain-HTTP webhook URL warns; DOCTOR_WEBHOOK_URL overrides it', () => {
  assert.equal(plan({ ...ENV, WEBHOOK_URL: 'http://x/' }).env_results.find((r) => r.check === 'env:webhook_url').status, 'warn');
  const p = plan({ ...ENV, WEBHOOK_URL: 'http://localhost:5679/', DOCTOR_WEBHOOK_URL: 'http://localhost:5678' });
  assert.equal(p.handshake.url, 'http://localhost:5678/webhook/ingress-whatsapp');
  assert.equal(p.env_results.find((r) => r.check === 'env:webhook_url').status, 'pass');
  assert.equal(plan({ ...ENV, WEBHOOK_URL: '' }).handshake.skip, 'WEBHOOK_URL is not set');
});

test('token: works, expired, unreachable', () => {
  assert.equal(evaluate('token', ok({ id: '1', name: 'wa-agent' })).status, 'pass');
  const expired = evaluate('token', gerr(401, 190, 'Error validating access token: Session has expired'));
  assert.equal(expired.status, 'fail');
  assert.match(expired.detail, /invalid or expired/);
  assert.match(evaluate('token', { error: { message: 'ECONNREFUSED' } }).detail, /not reached, no response: ECONNREFUSED/);
});

test('token scopes: missing scope fails; unreadable scopes only warn', () => {
  const both = ok({ data: [{ permission: 'whatsapp_business_messaging', status: 'granted' }, { permission: 'whatsapp_business_management', status: 'granted' }] });
  assert.equal(evaluate('token_scopes', both).status, 'pass');
  const one = ok({ data: [{ permission: 'whatsapp_business_messaging', status: 'granted' }, { permission: 'whatsapp_business_management', status: 'declined' }] });
  assert.match(evaluate('token_scopes', one).detail, /missing whatsapp_business_management/);
  assert.equal(evaluate('token_scopes', gerr(400, 100, 'unsupported')).status, 'warn');
});

test('phone number: healthy passes and shows only the last 4 digits', () => {
  const r = evaluate('phone_number', ok(HEALTHY_PHONE));
  assert.equal(r.status, 'pass');
  assert.match(r.detail, /number ending 1234 \(Sparkle Clean\)/);
  assert.equal(r.detail.includes('555'), false);
});

test('phone number: a business-verification block fails with Meta\'s reason (error 131031 case)', () => {
  const blocked = { ...HEALTHY_PHONE, health_status: { can_send_message: 'BLOCKED', entities: [
    { entity_type: 'BUSINESS', can_send_message: 'BLOCKED', errors: [{ error_code: 141010, error_description: 'The Business has not passed business verification.', possible_solution: 'Verify the business in Security Center.' }] }] } };
  const r = evaluate('phone_number', ok(blocked));
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /BUSINESS: The Business has not passed business verification\. \(141010\)\. Fix: Verify/);
});

test('phone number: wrong platform or status fails; quality and limited sending warn', () => {
  assert.equal(evaluate('phone_number', ok({ ...HEALTHY_PHONE, platform_type: 'ON_PREMISE' })).status, 'fail');
  assert.equal(evaluate('phone_number', ok({ ...HEALTHY_PHONE, status: 'DISCONNECTED' })).status, 'fail');
  assert.equal(evaluate('phone_number', ok({ ...HEALTHY_PHONE, quality_rating: 'YELLOW' })).status, 'warn');
  assert.equal(evaluate('phone_number', ok({ ...HEALTHY_PHONE, health_status: { can_send_message: 'LIMITED' } })).status, 'warn');
  assert.match(evaluate('phone_number', gerr(400, 100, 'Unsupported get request', 33)).detail, /META_PHONE_NUMBER_ID is wrong/);
});

test('WABA subscription: none subscribed fails with the fix', () => {
  assert.match(evaluate('waba_subscription', ok({ data: [] })).detail, /not subscribed to any app/);
  const r = evaluate('waba_subscription', ok({ data: [{ whatsapp_business_api_data: { id: '9', name: 'wa-agent' } }] }));
  assert.equal(r.status, 'pass');
  assert.match(r.detail, /wa-agent/);
});

test('template: approved utility passes; marketing and pending warn; missing or rejected fails', () => {
  const t = (status, category, language = 'en_US') => ok({ data: [{ name: 'enquiry_update', status, category, language }] });
  assert.equal(evaluate('template', t('APPROVED', 'UTILITY'), ENV).status, 'pass');
  assert.match(evaluate('template', t('APPROVED', 'MARKETING'), ENV).detail, /billed as MARKETING/);
  assert.equal(evaluate('template', t('PENDING', 'UTILITY'), ENV).status, 'warn');
  assert.equal(evaluate('template', t('REJECTED', 'UTILITY'), ENV).status, 'fail');
  assert.match(evaluate('template', t('APPROVED', 'UTILITY', 'en_GB'), ENV).detail, /not found; it exists in en_GB/);
});

test('WABA health: blocked fails, review pending warns', () => {
  assert.equal(evaluate('waba_health', ok({ name: 'Sparkle', account_review_status: 'APPROVED', health_status: { can_send_message: 'AVAILABLE' } })).status, 'pass');
  assert.equal(evaluate('waba_health', ok({ account_review_status: 'PENDING', health_status: { can_send_message: 'AVAILABLE' } })).status, 'warn');
  assert.equal(evaluate('waba_health', ok({ health_status: { can_send_message: 'BLOCKED', errors: [{ error_code: 131031, error_description: 'Business account locked' }] } })).status, 'fail');
});

test('a JSON body that arrives as text is still read', () => {
  assert.equal(evaluate('token', { statusCode: 200, body: '{"id":"1"}' }).status, 'pass');
});

test('handshake: challenge echoed passes; 404, 403 and no response fail; skip stays skip', () => {
  const h = plan(ENV).handshake;
  assert.equal(evaluateHandshake(h, { statusCode: 200, body: HANDSHAKE_CHALLENGE }).status, 'pass');
  assert.equal(evaluateHandshake(h, { statusCode: 200, data: HANDSHAKE_CHALLENGE }).status, 'pass'); // text response format
  assert.equal(evaluateHandshake(h, { statusCode: 200, data: 'something else' }).status, 'fail');
  assert.match(evaluateHandshake(h, { statusCode: 404, body: '' }).detail, /published/);
  assert.match(evaluateHandshake(h, { statusCode: 403, body: '' }).detail, /refused/);
  assert.equal(evaluateHandshake(h, { error: { message: 'timeout' } }).status, 'fail');
  assert.equal(evaluateHandshake({ skip: 'WEBHOOK_URL is not set' }, undefined).status, 'skip');
});

test('report puts the summary first and takes the worst status', () => {
  const rows = report(ENV, [ok({ id: '1' }), ok({ data: [] }), ok(HEALTHY_PHONE), ok({ data: [] }),
    ok({ data: [{ name: 'enquiry_update', status: 'APPROVED', category: 'UTILITY', language: 'en_US' }] }),
    ok({ account_review_status: 'APPROVED', health_status: { can_send_message: 'AVAILABLE' } })],
  { statusCode: 200, body: HANDSHAKE_CHALLENGE });
  assert.equal(rows[0].check, 'summary');
  assert.equal(rows[0].status, 'fail'); // missing scopes and no subscribed app
  assert.match(rows[0].detail, /2 fail/);
  assert.equal(rows.length, 1 + 6 + 6 + 1);
});

test('redact hides tokens and long digit runs', () => {
  assert.equal(redact('token EAAGm0PX4ZCpsBAKZB1234 bad'), 'token EAA...(hidden) bad');
  assert.equal(redact('to 15551234567'), 'to *******4567');
  assert.equal(redact(undefined), '');
});
