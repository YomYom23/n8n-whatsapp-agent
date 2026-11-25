'use strict';
// US ZIP codes in an address (design section 9, file 13).

// 5 digits, optionally a dash and 4 more, not part of a longer digit run.
const ZIP = /(?<!\d)(\d{5})(?:-\d{4})?(?!\d)/g;

// The 5-digit part of the last ZIP-shaped group, or null. The last one wins because a street
// number usually comes first. Known limit: "12345 Oak Ave" with no ZIP code returns "12345".
function findZip(text) {
  let last = null;
  const re = new RegExp(ZIP.source, 'g');
  let m;
  while ((m = re.exec(String(text || ''))) !== null) last = m[1];
  return last;
}

function inArea(zip, serviceAreas) {
  if (!zip || !Array.isArray(serviceAreas)) return false;
  return serviceAreas.some((z) => String(z).trim() === String(zip));
}

module.exports = { findZip, inArea };
