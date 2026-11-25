'use strict';
// Price facts and the code checks on prices in AI drafts (design section 8, file 12).

// One money amount: "$80", "$ 80", "$1,200", "$80.00", "80 dollars", "80 bucks", "80 USD", "USD 80".
const NUM = '(\\d{1,3}(?:,\\d{3})+|\\d+)(\\.\\d+)?';
const MONEY = new RegExp(
  '\\$\\s*' + NUM +
    '|' + NUM + '\\s*(?:dollars?|bucks|usd)\\b' +
    '|\\busd\\s*' + NUM,
  'gi'
);

function toCents(whole, fraction) {
  return Math.round(parseFloat(whole.replace(/,/g, '') + (fraction || '')) * 100);
}

// Every money amount in the text, in order, as integer cents.
function findAmounts(text) {
  const out = [];
  const re = new RegExp(MONEY.source, 'gi');
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    if (m[1] !== undefined) out.push(toCents(m[1], m[2]));
    else if (m[3] !== undefined) out.push(toCents(m[3], m[4]));
    else out.push(toCents(m[5], m[6]));
  }
  return out;
}

// Split at . ! ? and line breaks, but not at a '.' between two digits.
function splitSentences(text) {
  return String(text || '')
    .split(/(?<!\d)\.|\.(?!\d)|[!?]|\r?\n|\r/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Whole-word, case-insensitive: the name may not touch a letter or digit on either side.
function containsName(sentence, name) {
  const n = String(name || '').trim();
  if (n === '') return false;
  const body = n.split(/\s+/).map(escapeRegExp).join('\\s+');
  return new RegExp('(?<![A-Za-z0-9])' + body + '(?![A-Za-z0-9])', 'i').test(sentence);
}

function formatDollars(cents) {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
}

// "Regular clean", "regular_clean" and "REGULAR-CLEAN" all give "regular_clean", so the classifier's
// price_service option ID (questions.serviceId) matches the sheet's service name.
function serviceKey(s) {
  return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// Sheet rows (section 16: amount in dollars, aliases semicolon-separated, bookable yes/no)
// to the price rows this module works on.
function parsePrices(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    service: String(r.service || '').trim(),
    aliases: Array.isArray(r.aliases)
      ? r.aliases.map((a) => String(a).trim()).filter(Boolean)
      : String(r.aliases || '').split(';').map((a) => a.trim()).filter(Boolean),
    unit: String(r.unit || '').trim().toLowerCase(),
    amountCents: Math.round(parseFloat(String(r.amount).replace(/[$,\s]/g, '')) * 100),
    durationMinutes: parseInt(r.duration_minutes != null ? r.duration_minutes : r.durationMinutes, 10),
    bookable: r.bookable === true || String(r.bookable || '').trim().toLowerCase() === 'yes',
  }));
}

function titleCase(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// The approved price lines for a price_question, and the one calculated total.
// service: the price_service the classifier named (a service ID such as regular_clean, or a name or alias), or null.
// hours: a number, or null for not_stated.
function priceFacts(prices, service, hours) {
  const rows = Array.isArray(prices) ? prices : [];
  const lines = rows.map((r) => {
    const amount = '$' + formatDollars(r.amountCents);
    return titleCase(r.service) + ': ' + (r.unit === 'hour' ? amount + ' per hour' : amount);
  });
  let totalCents = null;
  if (service && typeof hours === 'number' && Number.isFinite(hours) && hours > 0) {
    const row = rows.find(
      (r) => r.unit === 'hour' && [r.service].concat(r.aliases || []).some((n) => serviceKey(n) === serviceKey(service))
    );
    if (row) {
      totalCents = Math.round(row.amountCents * hours);
      lines.push(
        titleCase(row.service) + ' for ' + hours + (hours === 1 ? ' hour' : ' hours') + ': $' + formatDollars(totalCents)
      );
    }
  }
  return { lines, totalCents };
}

// Every amount must equal the amount of a price row named in the same sentence, or the calculated total.
function checkDraftPrices(draft, prices, totalCents) {
  const rows = Array.isArray(prices) ? prices : [];
  for (const sentence of splitSentences(draft)) {
    const amounts = findAmounts(sentence);
    if (amounts.length === 0) continue;
    const allowed = new Set();
    if (typeof totalCents === 'number') allowed.add(totalCents);
    for (const r of rows) {
      if ([r.service].concat(r.aliases || []).some((n) => containsName(sentence, n))) allowed.add(r.amountCents);
    }
    if (amounts.some((a) => !allowed.has(a))) return ['price_mismatch'];
  }
  return [];
}

function numbersIn(text) {
  const out = [];
  const re = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    let s = m[0].replace(/,/g, '');
    if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
    out.push(s);
  }
  return out;
}

// Every number in the draft must appear as a number in the approved facts text.
function checkNumbers(draft, factsText) {
  const known = new Set(numbersIn(factsText));
  return numbersIn(draft).every((n) => known.has(n)) ? [] : ['unknown_number'];
}

module.exports = { parsePrices, serviceKey, priceFacts, findAmounts, splitSentences, checkDraftPrices, checkNumbers };
