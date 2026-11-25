'use strict';
// Branch B of design section 5: the processor's lease and its choice of the next inbox row.
// Pure: the caller reads the rows with Data table nodes and passes the clock in.
const { BRANCH_B } = require('./config');

function toMillis(value) {
  // no instanceof: a Date from n8n's Code-node sandbox is from another realm
  if (value && typeof value.getTime === 'function') return value.getTime();
  if (value === null || value === undefined || value === '') return NaN;
  return new Date(value).getTime();
}

// Whether this execution may write itself into the lease: no row, no holder, an expired lease,
// or a lease it already holds. Returns { take, expires_at } (expires_at only when take is true).
function leaseDecision(leaseRow, executionId, now) {
  const nowMs = toMillis(now);
  if (!Number.isFinite(nowMs)) throw new Error('leaseDecision: bad now');
  const holder = leaseRow && leaseRow.holder ? String(leaseRow.holder) : '';
  const expires = leaseRow ? toMillis(leaseRow.expires_at) : NaN;
  const free = !leaseRow || holder === '' || !Number.isFinite(expires) || expires <= nowMs || holder === String(executionId);
  return free ? { take: true, expires_at: new Date(nowMs + BRANCH_B.leaseSeconds * 1000).toISOString() } : { take: false };
}

// Read-back check after writing the lease: continue only if this execution's ID is there.
function holdsLease(leaseRow, executionId) {
  return Boolean(leaseRow) && String(leaseRow.holder || '') === String(executionId);
}

// Rows left in 'handling' by an execution that no longer holds the lease (marked failed, owner alerted).
function stuckRows(rows, executionId) {
  return (rows || []).filter((r) => r.status === 'handling' && String(r.execution_id || '') !== String(executionId));
}

// The oldest received row (by row ID, which follows arrival order) and what to do with it:
// { row, action: 'duplicate' } if another row with the same external_id is handling or done,
// { row, action: 'handle' } otherwise, or null when nothing is waiting.
function nextAction(rows) {
  const all = rows || [];
  const waiting = all.filter((r) => r.status === 'received').sort((a, b) => Number(a.id) - Number(b.id));
  if (waiting.length === 0) return null;
  const row = waiting[0];
  const seen = all.some(
    (r) => r.id !== row.id && r.external_id === row.external_id && (r.status === 'handling' || r.status === 'done')
  );
  return { row, action: seen ? 'duplicate' : 'handle' };
}

// Whether the loop may take another row: stops after loopLimitSeconds so the next run can take over.
function keepLooping(startedAt, now) {
  return toMillis(now) - toMillis(startedAt) < BRANCH_B.loopLimitSeconds * 1000;
}

module.exports = { leaseDecision, holdsLease, stuckRows, nextAction, keepLooping };
