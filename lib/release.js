'use strict';
// Return to bot and Reopen (design section 11). Pure: each function returns data for the caller.

// Return to bot is refused while owner messages are waiting.
function canRelease(pendingCount) {
  return Number(pendingCount) === 0;
}

// Clears human_owned, unclear_in_a_row and the offered times, and nothing else.
// A conversation already back with the bot gets no updates (a second click does nothing).
function releaseUpdates(conversation) {
  if (!conversation.human_owned) return {};
  return {
    human_owned: false,
    unclear_in_a_row: 0,
    offered_slots: '[]',
    last_offered_day: '',
  };
}

// The thread note after a release. Nothing is sent to the customer.
function resumeText(conversation) {
  return 'Bot resumes at: ' + conversation.stage;
}

// Restores the stage before closing, clears the offered times and unclear_in_a_row.
function reopenUpdates(conversation) {
  return {
    stage: conversation.stage_before_close,
    offered_slots: '[]',
    last_offered_day: '',
    unclear_in_a_row: 0,
  };
}

module.exports = { canRelease, releaseUpdates, resumeText, reopenUpdates };
