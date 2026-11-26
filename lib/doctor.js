'use strict';
// Read-only checks of the Meta setup, for the doctor workflow (design section 3, step P9).
// plan() lists the checks; evaluate() reads one Graph response; report() puts them in order.
// Details come only from named response fields and pass through redact(), so a token or a full
// phone number never reaches the output.

const { maskNumber } = require('./mask');

const ENV_KEYS = ['META_GRAPH_VERSION', 'META_PHONE_NUMBER_ID', 'META_WABA_ID', 'META_APP_SECRET',
  'META_VERIFY_TOKEN', 'META_TEMPLATE_NAME', 'META_TEMPLATE_LANG', 'WEBHOOK_URL', 'DOCTOR_WEBHOOK_URL'];
const NEEDED_SCOPES = ['whatsapp_business_messaging', 'whatsapp_business_management'];
const PHONE_FIELDS = 'display_phone_number,verified_name,code_verification_status,quality_rating,platform_type,status,health_status';
const WEBHOOK_PATH = 'webhook/ingress-whatsapp';
const HANDSHAKE_CHALLENGE = 'doctor-handshake';
const RANK = { pass: 0, skip: 1, warn: 2, fail: 3 };

const blank = (v) => v === undefined || v === null || String(v).trim() === '';

// Long digit runs keep their last 4; anything shaped like a Meta token is hidden.
function redact(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/EAA[A-Za-z0-9]+/g, 'EAA...(hidden)')
    .replace(/\d{7,}/g, (d) => maskNumber(d))
    .slice(0, 400);
}

const result = (check, status, detail) => ({ check, status, detail: redact(detail) });

// { env_results, requests: [{ check, path, query }], handshake: { url, challenge } | { skip } }
function plan(env) {
  const e = env || {};
  const env_results = [];
  const version = String(e.META_GRAPH_VERSION || '');
  env_results.push(/^v\d+\.\d+$/.test(version)
    ? result('env:graph_version', 'pass', 'META_GRAPH_VERSION is ' + version)
    : result('env:graph_version', 'fail', 'META_GRAPH_VERSION should look like v25.0; it is ' + (version || 'not set')));
  const pnid = String(e.META_PHONE_NUMBER_ID || '');
  const pnidOk = /^\d+$/.test(pnid);
  env_results.push(pnidOk
    ? result('env:phone_number_id', 'pass', 'META_PHONE_NUMBER_ID is set')
    : result('env:phone_number_id', 'fail', 'META_PHONE_NUMBER_ID should be the numeric phone number ID from WhatsApp Manager; it is ' + (pnid ? 'not numeric' : 'not set')));
  for (const k of ['META_APP_SECRET', 'META_VERIFY_TOKEN']) {
    env_results.push(blank(e[k])
      ? result('env:' + k.toLowerCase().replace('meta_', ''), 'fail', k + ' is not set')
      : result('env:' + k.toLowerCase().replace('meta_', ''), 'pass', k + ' is set (value not shown)'));
  }
  const waba = String(e.META_WABA_ID || '');
  const wabaOk = /^\d+$/.test(waba);
  env_results.push(wabaOk
    ? result('env:waba_id', 'pass', 'META_WABA_ID is set')
    : result('env:waba_id', 'warn', 'META_WABA_ID is ' + (waba ? 'not numeric' : 'not set') + ', so the WhatsApp account checks are skipped'));

  const requests = [{ check: 'token', path: 'me', query: { fields: 'id,name' } },
    { check: 'token_scopes', path: 'me/permissions', query: {} }];
  if (pnidOk) requests.push({ check: 'phone_number', path: pnid, query: { fields: PHONE_FIELDS } });
  if (wabaOk) {
    requests.push({ check: 'waba_subscription', path: waba + '/subscribed_apps', query: {} });
    requests.push({ check: 'template', path: waba + '/message_templates',
      query: { name: String(e.META_TEMPLATE_NAME || ''), fields: 'name,status,category,language' } });
    requests.push({ check: 'waba_health', path: waba, query: { fields: 'name,account_review_status,health_status' } });
  }

  const base = String(e.DOCTOR_WEBHOOK_URL || e.WEBHOOK_URL || '');
  let handshake;
  if (!base) handshake = { skip: 'WEBHOOK_URL is not set' };
  else if (blank(e.META_VERIFY_TOKEN)) handshake = { skip: 'META_VERIFY_TOKEN is not set' };
  else handshake = { url: base.replace(/\/*$/, '/') + WEBHOOK_PATH, challenge: HANDSHAKE_CHALLENGE };
  if (!e.DOCTOR_WEBHOOK_URL && /^http:/.test(base)) {
    env_results.push(result('env:webhook_url', 'warn', 'WEBHOOK_URL is not HTTPS; Meta only calls HTTPS callback URLs'));
  } else if (base) {
    env_results.push(result('env:webhook_url', 'pass', 'webhook base URL is set'));
  }
  return { env_results, requests, handshake };
}

// The HTTP Request node's full response, or { error } when it got none.
function parse(response) {
  const r = response || {};
  if (r.statusCode === undefined) {
    const err = r.error;
    return { status: 0, body: null, message: 'no response: ' + ((err && (err.message || err.description)) || err || 'unknown error') };
  }
  let body = r.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { /* keep the text */ }
  }
  const gerr = body && typeof body === 'object' && body.error;
  const message = gerr ? (gerr.message || 'Graph error') + (gerr.code !== undefined ? ' (code ' + gerr.code + (gerr.error_subcode ? '/' + gerr.error_subcode : '') + ')' : '') : '';
  return { status: r.statusCode, body, code: gerr && gerr.code, message };
}

function healthProblems(health) {
  if (!health || typeof health !== 'object') return { can: 'UNKNOWN', errors: [] };
  const errors = [];
  for (const ent of [health].concat(health.entities || [])) {
    for (const er of ent.errors || []) {
      errors.push((ent.entity_type ? ent.entity_type + ': ' : '') + (er.error_description || 'error ' + er.error_code) +
        (er.error_code ? ' (' + er.error_code + ')' : '') + (er.possible_solution ? '. Fix: ' + er.possible_solution : ''));
    }
  }
  return { can: health.can_send_message || 'UNKNOWN', errors: Array.from(new Set(errors)) };
}

function graphFailure(check, p) {
  if (p.status === 0) return result(check, 'fail', 'Graph API not reached, ' + p.message);
  if (p.code === 190) return result(check, 'fail', 'the Meta token is invalid or expired' + ' (' + p.message + '). Make a new system-user token and update the Meta credential.');
  return result(check, 'fail', 'Graph API answered ' + p.status + ': ' + (p.message || 'no error message'));
}

function evaluate(check, response, env) {
  const e = env || {};
  const p = parse(response);
  const ok = p.status >= 200 && p.status < 300 && p.body && typeof p.body === 'object';

  if (check === 'token_scopes') {
    if (!ok || !Array.isArray(p.body.data)) {
      return result(check, 'warn', "couldn't read the token's scopes, so they are unverified" + (p.message ? ': ' + p.message : ''));
    }
    const granted = p.body.data.filter((x) => x.status === 'granted').map((x) => x.permission);
    const missing = NEEDED_SCOPES.filter((s) => !granted.includes(s));
    return missing.length
      ? result(check, 'fail', 'the token is missing ' + missing.join(', '))
      : result(check, 'pass', 'the token has ' + NEEDED_SCOPES.join(' and '));
  }
  if (!ok) {
    if (check === 'phone_number' && p.code === 100) {
      return result(check, 'fail', 'META_PHONE_NUMBER_ID is wrong, or the token has no access to that number (' + p.message + ')');
    }
    return graphFailure(check, p);
  }
  const b = p.body;

  if (check === 'token') {
    return result(check, 'pass', 'the Meta token works' + (b.name ? ' (' + b.name + ')' : ''));
  }
  if (check === 'phone_number') {
    const fails = [];
    const warns = [];
    if (b.platform_type && b.platform_type !== 'CLOUD_API') fails.push('the number is on ' + b.platform_type + ', not the Cloud API');
    if (b.status && b.status !== 'CONNECTED') fails.push('the number\'s status is ' + b.status);
    if (b.code_verification_status && b.code_verification_status !== 'VERIFIED') warns.push('code verification is ' + b.code_verification_status);
    if (b.quality_rating === 'RED' || b.quality_rating === 'YELLOW') warns.push('quality rating is ' + b.quality_rating);
    const h = healthProblems(b.health_status);
    if (h.can === 'BLOCKED') fails.push('Meta says it can\'t send: ' + (h.errors.join('; ') || 'no reason given'));
    else if (h.can === 'LIMITED') warns.push('Meta says sending is limited: ' + (h.errors.join('; ') || 'no reason given'));
    const about = 'number ending ' + String(b.display_phone_number || '').replace(/\D/g, '').slice(-4) +
      (b.verified_name ? ' (' + b.verified_name + ')' : '') + ', status ' + (b.status || '?') +
      ', quality ' + (b.quality_rating || '?') + ', can send: ' + h.can;
    if (fails.length) return result(check, 'fail', fails.concat(warns).join('; ') + '. ' + about);
    if (warns.length) return result(check, 'warn', warns.join('; ') + '. ' + about);
    return result(check, 'pass', about);
  }
  if (check === 'waba_subscription') {
    const apps = Array.isArray(b.data) ? b.data : [];
    if (!apps.length) {
      return result(check, 'fail', 'the WhatsApp account is not subscribed to any app, so Meta sends no message webhooks even with the callback URL set. Subscribe it with POST /<WABA_ID>/subscribed_apps (docs/meta-setup.md).');
    }
    const names = apps.map((a) => (a.whatsapp_business_api_data && a.whatsapp_business_api_data.name) || 'unnamed app');
    return result(check, 'pass', 'subscribed app(s): ' + names.join(', '));
  }
  if (check === 'template') {
    const name = String(e.META_TEMPLATE_NAME || '');
    const lang = String(e.META_TEMPLATE_LANG || '');
    const all = (Array.isArray(b.data) ? b.data : []).filter((t) => t.name === name);
    const t = all.find((x) => x.language === lang);
    if (!t) {
      return result(check, 'fail', 'template ' + name + ' in ' + lang + ' not found' +
        (all.length ? '; it exists in ' + all.map((x) => x.language).join(', ') : '') + '. Send template needs it.');
    }
    const about = 'template ' + name + ' (' + lang + ') is ' + t.status + ', category ' + (t.category || '?');
    if (t.status === 'APPROVED') {
      return t.category && t.category !== 'UTILITY'
        ? result(check, 'warn', about + '; Meta moved it out of Utility, so each send is billed as ' + t.category)
        : result(check, 'pass', about);
    }
    if (t.status === 'PENDING' || t.status === 'IN_APPEAL') return result(check, 'warn', about + '; Send template fails until it is approved');
    return result(check, 'fail', about + '; Send template fails until a template is approved');
  }
  if (check === 'waba_health') {
    const h = healthProblems(b.health_status);
    const review = b.account_review_status;
    const about = 'WhatsApp account' + (b.name ? ' ' + b.name : '') + ': review ' + (review || '?') + ', can send: ' + h.can;
    if (h.can === 'BLOCKED') return result(check, 'fail', about + '. ' + (h.errors.join('; ') || 'no reason given'));
    if (h.can === 'LIMITED' || (review && review !== 'APPROVED')) {
      return result(check, 'warn', about + (h.errors.length ? '. ' + h.errors.join('; ') : ''));
    }
    return result(check, 'pass', about);
  }
  return result(check, 'fail', 'unknown check ' + check);
}

// The GET handshake that Meta makes when the callback URL is saved, made against ingress-whatsapp.
function evaluateHandshake(handshake, response) {
  if (!handshake || handshake.skip) return result('webhook_handshake', 'skip', (handshake && handshake.skip) || 'not planned');
  const r = response || {};
  if (r.statusCode === undefined) {
    const err = r.error;
    return result('webhook_handshake', 'fail', 'could not reach ' + handshake.url + ': ' + ((err && err.message) || err || 'no response'));
  }
  const raw = r.body !== undefined ? r.body : r.data; // a text response arrives as data
  const body = typeof raw === 'string' ? raw.trim() : JSON.stringify(raw);
  if (r.statusCode === 200 && body === handshake.challenge) {
    return result('webhook_handshake', 'pass', 'ingress-whatsapp answered the verify request with the challenge');
  }
  if (r.statusCode === 404) return result('webhook_handshake', 'fail', 'nothing at ' + handshake.url + ' (404): is ingress-whatsapp published?');
  if (r.statusCode === 403) return result('webhook_handshake', 'fail', 'ingress-whatsapp refused the verify token (403)');
  return result('webhook_handshake', 'fail', 'ingress-whatsapp answered ' + r.statusCode + ' instead of the challenge');
}

// Summary first, then the env checks, the Graph checks in plan order, and the handshake.
function report(env, responses, handshakeResponse) {
  const p = plan(env);
  const checks = p.env_results
    .concat(p.requests.map((req, i) => evaluate(req.check, (responses || [])[i], env)))
    .concat([evaluateHandshake(p.handshake, handshakeResponse)]);
  const counts = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const c of checks) counts[c.status] += 1;
  const worst = checks.reduce((w, c) => (RANK[c.status] > RANK[w] ? c.status : w), 'pass');
  const summary = { check: 'summary', status: worst,
    detail: counts.pass + ' pass, ' + counts.warn + ' warn, ' + counts.fail + ' fail, ' + counts.skip + ' skip' };
  return [summary].concat(checks);
}

module.exports = { ENV_KEYS, HANDSHAKE_CHALLENGE, plan, evaluate, evaluateHandshake, report, redact };
