'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ACTION_IDS, toPlain, escapeForSlack, isTeamNote, handoffPost, closeAlertPost,
} = require('../slack_text');

test('escapeForSlack: <!channel> cannot trigger a mention', () => {
  assert.equal(escapeForSlack('<!channel> hi'), '&lt;!channel&gt; hi');
});

test('escapeForSlack: ampersand first, links disguised, empty input', () => {
  assert.equal(escapeForSlack('a & b <http://x|y>'), 'a &amp; b &lt;http://x|y&gt;');
  assert.equal(escapeForSlack('&lt;'), '&amp;lt;');
  assert.equal(escapeForSlack(null), '');
  assert.equal(escapeForSlack(undefined), '');
});

test('toPlain: links', () => {
  assert.equal(toPlain('see <https://example.com/book|our page> now'), 'see our page (https://example.com/book) now');
  assert.equal(toPlain('see <https://example.com>'), 'see https://example.com');
  assert.equal(toPlain('<https://example.com|https://example.com>'), 'https://example.com');
  assert.equal(toPlain('mail <mailto:a@b.com|a@b.com>'), 'mail a@b.com');
});

test('toPlain: mentions and special mentions are removed', () => {
  assert.equal(toPlain('<@U123> thanks, see you Monday'), 'thanks, see you Monday');
  assert.equal(toPlain('hi <@U123|jev> and <!here> all'), 'hi and all');
  assert.equal(toPlain('in <#C1|general>'), 'in #general');
  assert.equal(toPlain('on <!date^1700000000^{date}|Nov 14>'), 'on Nov 14');
});

test('toPlain: entities, with &amp; decoded last', () => {
  assert.equal(toPlain('Tom &amp; Jerry &lt;3 &gt; 2'), 'Tom & Jerry <3 > 2');
  assert.equal(toPlain('&amp;amp;'), '&amp;');
  assert.equal(toPlain('&amp;lt;'), '&lt;');
});

test('toPlain: a typed-out entity is not treated as a link', () => {
  assert.equal(toPlain('&lt;b&gt; stays'), '<b> stays');
});

test('toPlain: plain text, emoji and empty input pass through', () => {
  assert.equal(toPlain('We can do 10am 😀'), 'We can do 10am 😀');
  assert.equal(toPlain(''), '');
  assert.equal(toPlain(null), '');
});

test('isTeamNote', () => {
  assert.equal(isTeamNote('// call her first'), true);
  assert.equal(isTeamNote('   //note'), true);
  assert.equal(isTeamNote('/ not a note'), false);
  assert.equal(isTeamNote('see http://x // later'), false);
  assert.equal(isTeamNote(''), false);
  assert.equal(isTeamNote(undefined), false);
});

test('action IDs are stable constants', () => {
  assert.equal(ACTION_IDS.RETURN_TO_BOT, 'return_to_bot');
  assert.equal(ACTION_IDS.MARK_BOOKED, 'mark_booked');
  assert.equal(ACTION_IDS.REOPEN, 'reopen');
  assert.equal(new Set(Object.values(ACTION_IDS)).size, Object.keys(ACTION_IDS).length);
});

const history = Array.from({ length: 8 }, (_, i) => ({ author: i % 2 ? 'bot' : 'customer', text: 'msg ' + i }));

test('handoffPost: masked number, reason, stage, slots, last 6 messages, two buttons', () => {
  const post = handoffPost({
    waId: '15551234567',
    reason: 'wants_human',
    stage: 'offer',
    offeredSlots: [{ id: 'a', label: 'Mon 3 Mar 08:00' }, { id: 'b', label: 'Tue 4 Mar 08:00' }],
    history,
    episode: 2,
  });
  const text = post.blocks[0].text.text;
  assert.ok(text.includes('*******4567'));
  assert.ok(!text.includes('15551234567'));
  assert.ok(text.includes('Stage: offer'));
  assert.ok(text.includes('Mon 3 Mar 08:00; Tue 4 Mar 08:00'));
  assert.ok(!text.includes('msg 0') && !text.includes('msg 1'));
  assert.ok(text.includes('msg 2') && text.includes('msg 7'));
  assert.ok(!post.text.includes('15551234567'));
  const actions = post.blocks[1].elements;
  assert.deepEqual(actions.map((b) => b.action_id), [ACTION_IDS.RETURN_TO_BOT, ACTION_IDS.MARK_BOOKED]);
  assert.deepEqual(actions.map((b) => b.text.text), ['Return to bot', 'Mark as booked']);
  assert.equal(actions[0].value, '2');
});

test('handoffPost: customer text is escaped', () => {
  const post = handoffPost({
    waId: '15551234567',
    reason: 'unclear',
    stage: 'new',
    history: [{ author: 'customer', text: '<!channel> click <http://evil|here> & go' }],
  });
  const text = post.blocks[0].text.text;
  assert.ok(text.includes('&lt;!channel&gt; click &lt;http://evil|here&gt; &amp; go'));
  assert.ok(!text.includes('<!channel>'));
});

test('handoffPost: long messages are cut and a missing history or slots is fine', () => {
  const post = handoffPost({ waId: '15551234567', reason: 'unclear', stage: 'new', history: [{ author: 'customer', text: 'x'.repeat(2000) }] });
  assert.ok(post.blocks[0].text.text.length < 3000);
  const bare = handoffPost({ waId: '15551234567', reason: 'zip_not_found', stage: 'new' });
  assert.ok(!bare.blocks[0].text.text.includes('Offered times'));
  assert.equal(bare.blocks[1].elements[0].value, undefined);
});

test('closeAlertPost: Reopen button, masked number, stage before closing', () => {
  const post = closeAlertPost({ waId: '15551234567', reason: 'wrong_person', stageBeforeClose: 'offer' });
  const text = post.blocks[0].text.text;
  assert.ok(text.includes('*******4567') && !text.includes('15551234567'));
  assert.ok(text.includes('Wrong person'));
  assert.ok(text.includes('offer'));
  assert.deepEqual(post.blocks[1].elements.map((b) => b.action_id), [ACTION_IDS.REOPEN]);
  assert.equal(post.blocks[1].elements[0].text.text, 'Reopen');
  assert.ok(post.text.length > 0);
});
