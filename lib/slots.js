'use strict';
// Slot logic ported from Lead Bot (src/lead_bot/slots.py), with the design's changes (section 12):
// the earliest free start on each of the first N days that have one, durations from the service.
// Pure: the current time and Luxon's DateTime class are passed in.

const config = require('./config');

// Lead Bot's slot ID format: 'slot-%Y%m%dT%H%MZ', in UTC.
const SLOT_ID_RE = /^slot-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})Z$/;

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']; // Luxon weekday 1..7
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function toMillis(value) {
  // no instanceof: a Date from n8n's Code-node sandbox is from another realm
  const ms = value && typeof value.getTime === 'function' ? value.getTime() : new Date(value).getTime();
  if (Number.isNaN(ms)) throw new Error('invalid time: ' + String(value));
  return ms;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// 'slot-20260310T140000Z' style ID for a start time (ms since epoch or Date).
function slotIdFor(start) {
  const d = new Date(toMillis(start));
  return 'slot-' + d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) +
    'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + 'Z';
}

// The start (ms since epoch) a slot ID stands for, or null if it is not a slot ID.
function startFromSlotId(slotId) {
  const m = SLOT_ID_RE.exec(String(slotId));
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const ms = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(ms);
  // Reject impossible dates such as month 13 that Date.UTC would roll over.
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d ||
      check.getUTCHours() !== h || check.getUTCMinutes() !== mi) return null;
  return ms;
}

// "Monday October 5 at 9:30 AM" from a Luxon DateTime already in the business zone.
// On the hour the minutes are left out ("at 8 AM"), as in Lead Bot.
function slotLabel(local) {
  const hour12 = local.hour % 12 || 12;
  const minutes = local.minute ? ':' + pad(local.minute) : '';
  const ampm = local.hour < 12 ? 'AM' : 'PM';
  const dayName = DAY_NAMES[local.weekday % 7];
  return dayName + ' ' + MONTH_NAMES[local.month - 1] + ' ' + local.day + ' at ' + hour12 + minutes + ' ' + ampm;
}

function parseHm(text) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(text));
  if (!m) throw new Error('bad time of day: ' + String(text));
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

function isFree(startMs, blockMs, busyMs) {
  const end = startMs + blockMs;
  // A period ending exactly at the start does not block it (end is exclusive).
  return !busyMs.some((b) => b.start < end && startMs < b.end);
}

// The earliest free start on each of the first `count` days that have one, after `afterDay`
// (a 'YYYY-MM-DD' business-local date) if given. Returns [{ id, label, day }], day being the
// business-local 'YYYY-MM-DD'.
function earliestPerDay({
  now,
  hours,
  busy = [],
  durationMinutes,
  gapMinutes = config.SLOTS.gapMinutes,
  minNoticeHours = config.SLOTS.minNoticeHours,
  daysAhead = config.SLOTS.daysAhead,
  count = config.SLOTS.offered,
  afterDay,
  tz,
  DateTime,
}) {
  const nowMs = toMillis(now);
  const earliestMs = nowMs + minNoticeHours * 3600000;
  const blockMs = (durationMinutes + gapMinutes) * 60000;
  const durationMs = durationMinutes * 60000;
  const busyMs = busy.map((b) => ({ start: toMillis(b.start), end: toMillis(b.end) }));
  const today = DateTime.fromMillis(nowMs, { zone: tz }).startOf('day');
  const chosen = [];

  for (let offset = 0; offset <= daysAhead && chosen.length < count; offset++) {
    const day = today.plus({ days: offset });
    const dayKey = day.toFormat('yyyy-LL-dd');
    if (afterDay && dayKey <= afterDay) continue;
    const rows = hours.filter((r) => r.weekday === WEEKDAYS[day.weekday - 1]);
    for (const row of rows) {
      const o = parseHm(row.open);
      const c = parseHm(row.close);
      const closeMs = day.set({ hour: c.hour, minute: c.minute }).toMillis();
      let startMs = day.set({ hour: o.hour, minute: o.minute }).toMillis();
      let found = null;
      // Each slot is a block of duration plus gap; the visit itself must end by closing time.
      while (startMs + durationMs <= closeMs) {
        if (startMs >= earliestMs && isFree(startMs, blockMs, busyMs)) {
          found = startMs;
          break;
        }
        startMs += blockMs;
      }
      if (found !== null) {
        chosen.push({
          id: slotIdFor(found),
          label: slotLabel(DateTime.fromMillis(found, { zone: tz })),
          day: dayKey,
        });
        break;
      }
    }
  }
  return chosen;
}

// True if the slot is a real slot ID that starts at or after now plus the minimum notice
// (not in the past and not inside the notice period).
// Booking check 3 (section 12): no busy period overlaps the slot's block (duration plus gap),
// the same block earliestPerDay uses. Returns false for an unreadable slot ID.
function slotIsFree({ slotId, durationMinutes, gapMinutes = config.SLOTS.gapMinutes, busy = [] }) {
  const startMs = startFromSlotId(slotId);
  if (startMs === null) return false;
  const busyMs = busy.map((b) => ({ start: toMillis(b.start), end: toMillis(b.end) }));
  return isFree(startMs, (durationMinutes + gapMinutes) * 60000, busyMs);
}

function stillAllowed({ slotId, now, minNoticeHours = config.SLOTS.minNoticeHours }) {
  const start = startFromSlotId(slotId);
  if (start === null) return false;
  return start >= toMillis(now) + minNoticeHours * 3600000;
}

module.exports = {
  slotIsFree, earliestPerDay, stillAllowed, slotIdFor, startFromSlotId, slotLabel };
