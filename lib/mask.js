'use strict';
// Masks a WhatsApp number for Slack posts and the Sheets log (design sections 11 and 15).

const MASK_CHAR = '*';
const KEEP_DIGITS = 4;

// Keeps only the last 4 digits. Non-digits (such as a leading +) are dropped first.
// A number with 4 digits or fewer is masked completely, so nothing leaks from a short value.
function maskNumber(waId) {
  if (waId === null || waId === undefined) return '';
  const digits = String(waId).replace(/\D/g, '');
  if (digits.length <= KEEP_DIGITS) return MASK_CHAR.repeat(digits.length);
  return MASK_CHAR.repeat(digits.length - KEEP_DIGITS) + digits.slice(-KEEP_DIGITS);
}

module.exports = { maskNumber };
