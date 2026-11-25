'use strict';
// HubSpot target state (design section 15). Pure: the caller does the HubSpot work.

const EVENTS = ['enquiry', 'booked'];

// conversation: the conversations row (stage, hubspot_deal_id, deal_stage).
// event: 'enquiry' or 'booked'. opts.onDnc: the number is on do-not-contact.
// Returns { wantContact, dealAction: 'create' | 'move' | 'none', stage: 'enquiry' | 'booked' | null }.
// A contact already stored is found again by the caller; wantContact only says one may exist.
function targetState(conversation, event, opts) {
  if (!EVENTS.includes(event)) throw new Error('unknown crm event: ' + event);
  const onDnc = Boolean(opts && opts.onDnc);
  if (onDnc || conversation.stage === 'closed') {
    return { wantContact: false, dealAction: 'none', stage: null };
  }
  const stage = event;
  const dealId = conversation.hubspot_deal_id;
  const current = conversation.deal_stage;
  let dealAction;
  if (!dealId) dealAction = 'create';
  else if (stage === 'enquiry' && current === 'booked') dealAction = 'create'; // a new enquiry
  else if (current === stage) dealAction = 'none';
  else dealAction = 'move';
  return { wantContact: true, dealAction, stage };
}

module.exports = { targetState };
