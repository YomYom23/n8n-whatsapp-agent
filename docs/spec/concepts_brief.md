# Concept Brief: n8n WhatsApp Agent with Lead Bot's Safety Design (Cleaning Company Demo)

**Author:** Yomi O Lebi
**Date:** 2026-11-19 (updated 2026-11-20)
**Mode:** Multi-lens brainstorm (7 lenses), two rounds

## Reviewer Status

| Lens | Round 1 | Round 2 |
| --- | --- | --- |
| egm-design (Skeptical Architect Brainstormer) | completed | completed |
| egm-codebase-details (Technical Accuracy and Reuse Brainstormer) | completed | completed |
| egm-zoom-out (Simplicity and Scope Brainstormer) | completed | completed |
| egm-comprehension (Naive Reader Brainstormer) | completed | completed |
| egm-implementation-readiness (Implementation Readiness Brainstormer) | completed | completed |
| egm-structural (Structure Brainstormer) | completed | completed |
| egm-inventive-catalyst (Inventive Catalyst Brainstormer) | completed | completed |

No reviewer had web access. Every claim below about what n8n, n8n data tables, n8n Cloud, Slack, HubSpot or Meta can do is **unverified** unless a local file proves it. These claims are listed as spikes, not facts. All reviewers say they did not open client.toml, client_secret*.json, google_token.json or lead_bot.db.

Round 2 looked only at the decisions dated 2026-11-20. One round-2 lens (codebase-details) did not read the older project brief or texts.toml; one (implementation-readiness) did not read Lead Bot's README or docs/.

---

## Overview

The concept is a self-hosted n8n workflow that answers WhatsApp messages for a fictional cleaning company. It answers questions from a Google Sheet of facts the owner can edit, books Google Calendar slots, and hands off to the owner on Slack. The owner can reply to the customer from a Slack thread and hand the conversation back to the bot with a button. Enquiries and bookings are copied to HubSpot as a side step that never affects the reply. It rebuilds Lead Bot's safety design in n8n:

- a classifier (Jev) reads each incoming message;
- plain code decides what happens at fixed cut-offs;
- Claude Haiku writes a reply only when no scripted reply fits, using only the facts sheet;
- a draft check (a second Jev call plus code backstops) runs before any AI-written reply is sent;
- the owner takes over whenever the system is unsure.

State for each conversation lives in n8n data tables. There are two headline proofs: a replay test reported per tier as "passed X of Y", and Meta delivery evidence (meta-setup.md from real failures, captured fixtures, hand-test counts). It is an Upwork portfolio piece aimed at WhatsApp Cloud API + n8n jobs such as "messages sent to the WhatsApp test number never reach n8n".

Round 1: all seven lenses agreed the safety design is worth building. The author has since decided most of what round 1 raised (see "Decided").

Round 2: all seven lenses say the new decisions are workable but bring five new problem areas:

1. Concurrency 1 may delay the Meta and Slack acknowledgements.
2. "Return to bot" with no reset can hand straight back to the owner, or act on an out-of-date offer.
3. The Slack relay has no path for the customer's messages back into the thread.
4. The gate order drops STOP during a handoff.
5. Several decided rules (price match, guard removal, crm-sync trigger, 24-hour handling) need a precise definition before they can be built or tested.

---

## Analysis

Findings are merged across lenses. The lenses that raised each one are listed in brackets.

### Round 1 findings: status after the 2026-11-20 decisions

**Resolved by a decision (one line each)**
- **A1. "One Jev call per message" was inaccurate.** Resolved: the draft check is decided as a second Jev call. Model calls per path are scripted 1, off-script 3 (classifier, Haiku, draft check).
- **A2. Guards can't be shown with live models alone.** Resolved: two tiers each reported separately, plus a guard-removal run. Round 2 R9 covers how the removal run interacts with layered guards.
- **A3. Headline proof skipped Meta delivery.** Resolved: Meta delivery is a second headline; the doctor workflow is built last.
- **A5. Dedupe and human-owned race.** Resolved: option (a), concurrency 1 with claim-first dedupe and re-checks before send; no Postgres. Round 2 R1 asks whether concurrency 1 delays the acknowledgement.
- **A6. No hand-back design.** Resolved: Slack relay, "Return to bot" button, no reset. The round-1 re-entry proposal (reset the stage and slots) was overridden by the author. Round 2 R2-R4 cover the consequences.
- **A7. Classifier choice.** Resolved by the author: Jev node inside `classify`, with HTTP Request as the fallback. Spike 1 still picks the node.
- **B4 (part).** Resolved: the length cap (600), the price rule and a cleaning-specific draft-check question set are decided. The guard list itself and the guard-to-scenario map are still open (R8).
- **B7.** Resolved: read the sheet once per run, same copy for writer and guard, no cache. A frozen facts snapshot for replay is still needed.
- **B9 (part).** Resolved: the message log is the data tables plus a Google Sheet. Dedupe row status (received, then done) is still open.
- **B10 (part).** Resolved: one recorded Cloud setup pass. What the pass covers is still open (R6).

**Still open from round 1** (text kept short; see round 1 for detail)
- **A4. WhatsApp Trigger vs plain Webhook for ingress.** Leaning: a plain Webhook in an ingress workflow, HMAC over the raw body, status events dropped, internal message format, core workflow behind an Execute Workflow Trigger; build the Trigger once and record its behaviour. Waits on spike 2. Round 2 adds: Meta may report some send failures as `failed` status events, so "drop all status events" must become "drop all except `failed`" (R5).
- **B1. The old brief disagrees with the decisions.** Now wider than in round 1 (R12).
- **B2. Gate step before the classifier.** Still needed, with a changed order (R4).
- **B3. The full rule set.** Hazards at 0.5, pick-one below 0.5 is unclear, draft check at 0.3, first-match hazard order (opt_out, wrong_person, abusive, wants_human; conversation.py:196-207), two unclear in a row hands off. State must hold `unclear_in_a_row` and `slot_taken_count`. Keep all thresholds in one place.
- **B5. New hazards and changes from Lead Bot.** `prompt_injection` is new; `wrong_person` and `prompt_injection` need branches; the writer moves from OpenAI to Haiku; keep `NOT_IN_FACTS`. A "carried over / changed" table in the README. Round 2 adds to that table: owner relay, release without reset, START clearing do-not-contact, WhatsApp keyword handling and shorter Jev retries.
- **B6. Replay harness.** Stubs, fixed clock, assertions after completion, isolation, extended scenario format, scenarios from Day 2. Round 2 R6 adds that the Jev node may not be stubbable.
- **B8. Booking safety.** Port slots.py and the booking checks. **Correction:** Lead Bot's event ID is per lead (`lead-{id}`, conversation.py:429; booking.py:113), not per message, and "slot taken" is three checks, not just free/busy: an existing-event lookup by key, the booking-rules check that refuses past or too-soon slots, then free/busy (booking.py:115-135). Key events per customer. If the owner deletes that event, Google won't reuse the ID and Lead Bot hands off (booking.py:147-151); keep that as its own handoff reason.
- **B9 (rest).** Dedupe rows need a status and an alert on stale "received" rows.
- **B11. Plain definitions of terms** in the README. Add: relay, release, episode/thread, template message, two headlines.
- **B12. Stage table for cleaning** (about three stages plus escape options).
- **Nits from round 1** (deliverables, plan order, non-text messages, privacy of `wa_id`, pinned node versions, versioned stage values, README order, "working prototype" wording, repo name) all still apply.

### Round 2 findings

#### Blockers

**R1. Concurrency 1 may hold back the Meta and Slack acknowledgements.** [all seven lenses]
Decided item: Races ("acknowledge Meta at once, production concurrency 1"), Slack relay ("Slack retries if it doesn't get a 200 within about 3 seconds").
- If the n8n concurrency limit covers the whole instance and queues production webhook executions before they reply (unverified), Slack events, button clicks and Meta deliveries wait behind a running turn.
- An off-script turn is Jev, Haiku, Jev, plus Sheets and Calendar. The Jev SDK's default retries can take up to about 30 seconds (jev.py:46-48). Lead Bot retries a failed classifier call 3 times, 1 minute apart (worker.py:64-65); a 1-minute Wait would hold the whole queue.
- Whether Execute Workflow sub-workflows (`classify`, `crm-sync`) count against the limit is unverified. If they do and the parent waits, a limit of 1 could deadlock.
- Mitigation within the decision: apply concurrency 1 to processing, not receiving. Each entry point (Meta, Slack events, Slack interactivity) checks its signature, writes an inbox row and returns 200. One processor handles inbox rows one at a time, oldest first, as Lead Bot does (store.py:1141-1177). Customer messages, owner relays and release clicks go through the same queue so they can't interleave. Use short classifier retries (within about 15 seconds), then hand off with `jev_unavailable`; list this as a change from Lead Bot.
- Trade-off: one more workflow, and reply latency includes the poll interval if the processor runs on a schedule.
- Spike 3 (below) settles which form is needed. Measure throughput rather than quoting 10-20 per minute; the design lens thinks that is optimistic for off-script turns.

**R2. "Return to bot" with no reset can hand straight back to the owner.** [all seven lenses]
Decided item: release keeps stage and offered slots and clears only `unclear_in_a_row`; stale slots go through the "slot taken" path and "fresh times are offered".
- Lead Bot offers fresh times once and hands off with `slots_kept_filling` on the second taken slot (conversation.py:438-445). If `slot_taken_count` is already 1 (for example the handoff was caused by slots filling), the first stale pick after release hands back to the owner instead of offering fresh times.
- "None of those" hands off once a re-offer is already in the history (conversation.py:381-388), which may date from before the handoff.
- A past slot is not caught by free/busy: it is refused by the booking-rules check (booking.py:126-130). Free/busy alone would see an empty past slot as free. (The Decided text has been corrected to say this; see "Factual corrections".)
- On a re-ask in the offer stage, the stored slot labels are listed again (conversation.py:510), and some may be in the past.
- Mitigations that keep the decision as written: a separate "slot expired after release" path that drops past or busy slots before building options and offers fresh times **without** adding to `slot_taken_count`; same for the re-offer marker. Alternatively, the author could extend the decision so release also clears `slot_taken_count` and the re-offer marker. That changes the decided item and is the author's call (see "Needs author confirmation").
- Replay scenarios: release after `slots_kept_filling`; release then a digit pick of a past slot; release then "none of those".

**R3. Owner activity during a handoff makes the kept offer unsafe.** [design, codebase-details, inventive-catalyst, implementation-readiness, comprehension, zoom-out]
Decided item: release with no reset; Slack relay.
- In the offer stage a bare number books `offered[n-1]` without calling Jev (conversation.py:170-175). If the owner asked "how many bedrooms?" and the customer answered "2", that books the bot's old slot 2 after release. Free/busy won't stop it if the slot is free, and `crm-sync` then moves the deal to Booked.
- Jev is given "what the assistant last texted" (conversation.py:177-183). If relayed owner messages are logged as assistant turns, Jev reads the customer's answer against the owner's question while the stage options stay the same.
- If the owner booked the customer by hand, the re-check sees that event as busy and tells an already-booked customer the slot was taken; crm-sync never moves that deal to Booked.
- Mitigations within the decision:
  - Keep a `prompt_epoch` (or similar) that changes when the bot itself sends a stage question. Allow the digit shortcut and slot options only if no person has sent anything since. Otherwise read the first message normally, and if it isn't a clear stage answer, ask the stage question again without counting it as unclear.
  - Give Jev the last **bot** text, and the owner's last text as a separate field or not at all.
  - On release, post the kept state into the thread ("Bot resumes at: offered; Tue 10:00, Wed 14:00 (Mon 09:00 is now past)") so the owner sees the risk before it happens. Log stage, slots and counters at release with the Slack user and execution ID.
  - On release, look for a calendar event under this customer's key; if one exists, treat the conversation as booked. This corrects state without resetting it.
  - State in the README what the customer sees on resume (the bot re-asks the waiting question in the middle of a human chat), and which handoff reasons show the button at all (it does nothing after opt-out or wrong_person; Lead Bot closes after abuse).

**R4. The relay has no path for the customer's messages, and the gate order drops STOP during a handoff.** [comprehension, structural, codebase-details, design, implementation-readiness, inventive-catalyst]
Decided item: Slack relay; "Do-not-contact is never cleared by the button, only by the customer sending START".
- While human-owned, Lead Bot only alerts the owner for each later message (worker.py:211-238). The decisions don't say the customer's messages are posted into the thread. Without that the owner can't hold a conversation, and won't see the reply that reopens the 24-hour window after a template.
- The recommended gate order (do-not-contact, then human-owned, then opt-out) means a STOP sent during a handoff never reaches the opt-out step. Lead Bot honours an opt-out after a handoff (worker.py:206-238).
- START is new design: in Lead Bot, STOP/START are Twilio keywords and START changes nothing (conversation.py:151-161). With do-not-contact checked first, START is dropped before it is read. Whether WhatsApp has any carrier-level keyword handling is unverified (likely not).
- The early exit for human-owned also skips updating the customer's last-message time, which the 24-hour check needs.
- Mitigation: gate order STOP/START keyword, then do-not-contact, then explicit opt-out text, then record `last_customer_at`, then human-owned (post the message into the thread and stop), then classify. Scenarios: STOP during a handoff; START after STOP; a customer message during a handoff appearing in the thread.
- Thread lifecycle is also undefined: whether a second handoff reuses the thread, what a thread reply does after release, and what happens to replies under non-handoff alerts (Lead Bot's `_question_for_team` alerts the owner but the bot keeps talking, conversation.py:369-372). Proposal: one thread per conversation, or an episode ID per handoff; only relay from the current episode while human-owned; any other thread reply gets "released, not sent" in the thread. Write this as a small state table.

#### Major

**R5. The 24-hour window needs a code pre-check, and the template flow is under-specified.** [design, zoom-out, implementation-readiness, inventive-catalyst, comprehension, structural]
- Meta's out-of-window error code is unverified, and the failure may arrive later as a `failed` status event, which ingress currently drops (unverified). Compare `last_customer_at` with the clock before sending (the replay's fixed clock in tests); keep Meta's refusal as a backstop; route `failed` status events to an alert.
- The template is a business-initiated send: it needs the do-not-contact re-check, and offering it in the thread means another button with its own action ID and dedupe.
- The customer's reply to the template arrives while human-owned is still set, so it goes to the thread (R4), not the bot. The owner then has to send the text again, or the workflow queues it and sends it automatically. Decide which.
- Wording: "We've replied to your message" goes out when the reply was **not** delivered. Suggest wording like "We have an answer to your question. Reply here and we'll send it."
- Spike early: whether a custom template can be registered and approved on a test-number WABA, its category, and how long approval takes. Register it on Day 1 so approval time doesn't block work.

**R6. The Jev node may block the fixed tier and the Cloud pass.** [design, codebase-details, implementation-readiness, inventive-catalyst, comprehension, zoom-out, structural]
- The fixed tier stubs model calls through mock base URLs. A community node may hard-code its endpoint (unverified), so it can't be pointed at the mock.
- The node may not install on Cloud (unverified), and the HTTP fallback is only built "if no candidate passes", so the Cloud pass may have no classifier.
- Mitigations within the decision: stub at the edge of `classify` (the dry-run instance points the `classify` workflow ID at a fixture variant); run one contract test suite against the node and, if built, the fallback; state up front what the Cloud pass covers (for example ingress, Slack, data tables, Meta delivery) and list what was not run, or build the fallback for the Cloud pass only. Decide whether a mix is allowed (node for stage questions, HTTP for the draft check).
- "Raise an error on a missing field" can be enforced by a Code node after the node inside `classify`, so it need not be a node-selection gate (zoom-out). The real gates are options set by expression and per-field confidence in one call.
- `classify`'s contract is "message in"; the draft check needs a second input shape (FACTS, QUESTION, REPLY).
- Lead Bot does not retry a failed draft check; it drops the draft (conversation.py:351-355). Only the classifier retries.
- Meta has one callback URL per app (unverified). Plan when to switch it to Cloud and back.

**R7. `crm-sync` needs a code trigger, local IDs and an outage rule.** [all seven lenses]
- No classifier field called "booking intent" exists; Lead Bot's questions depend on the stage (text_questions.py:32-134). Trigger Enquiry on a code event (for example "stage moved to offered") and name it.
- HubSpot search may lag behind a just-created record, and phone is not a unique key (both unverified), so lookup-before-create can still make duplicates. Store `hubspot_contact_id` and `hubspot_deal_id` on the conversation row and search only when they are empty. With concurrency 1 the data table is consistent.
- If crm-sync runs without waiting, it escapes concurrency 1 and an enquiry and a booking close together can race. Run CRM work as queued rows handled one at a time, converging on a target state worked out from the conversation (Enquiry or Booked), so "Booked while the Enquiry step failed" still ends as one contact and one deal.
- "HubSpot down, owner alerted" will flood Slack during an outage. Alert once per outage (for example not more than once an hour).
- Undefined: whether contacts are created for opted-out or wrong_person customers; whether "open deal" includes a Booked deal; what a repeat enquiry after a booking creates; bookings the owner makes by hand never reach Booked.
- Compute the enquiry-to-booking number from the data tables, not HubSpot, so a HubSpot outage doesn't skew it.
- Spikes: search lag, a unique phone property, custom pipeline stages on the free plan, private-app scopes.

**R8. "Price must match the facts sheet exactly" has no contract and conflicts with the ported checks.** [all seven lenses]
- Ported as they are, Lead Bot's checks block every price: Jev `price_talk` (guard.py:35-38, blocks at 0.3), the `PRICE_WORDS` regex (guard.py:74-78, matches "cost", "fee", "pricing", `$\d`), and `price_question` going to a fixed `PRICE_LINE` that never reaches the writer (conversation.py:279-280).
- "Exactly" is undefined both ways. Too strict: "£80", "£80.00" and "80 pounds" are different strings. Too loose: a correct number on the wrong service ("deep clean £25" when £25 is the regular clean price) passes a number-only check. Derived totals ("£90 for two hours"), "from £X", ranges and VAT are not covered.
- Mitigation: keep prices in a typed price column (service, unit, amount) of the facts copy read once per run. Code pulls every money-like amount from the draft, normalises it, and requires each (service, amount) pair to be in the facts; anything else fails closed. Reword Jev's question to "states a price not tied to that service in FACTS, or computes a total". Write down that worked-out totals are blocked.
- Simpler option (design): answer `price_question` with a fixed reply built from the sheet's price rows, as Lead Bot does with `PRICE_LINE`, so the writer rarely states prices.
- Fixed-tier drafts: right price in another format (passes), wrong amount, wrong service, worked-out total, wrong currency.
- `INSURANCE_WORDS` matches "covers" and "insured" (guard.py:68-72), so cleaning text like "our clean covers ovens" or "fully insured" fails. Re-derive or drop that regex and `insurance_talk` when writing the cleaning question set, and publish the set. Keep `PROMISES_FOLLOW_UP` and `NOT_IN_FACTS`.

**R9. The guard-removal run conflicts with layered guards, and its switches are a live-instance hazard.** [design, codebase-details, zoom-out, implementation-readiness, inventive-catalyst, structural, comprehension]
- Lead Bot's backstops exist so a draft Jev under-scores is still caught (guard.py:10-14). A planted price is caught by both the price check and `unsupported_fact`; removing one still blocks the draft, so "its scenario must then fail" won't hold.
- Mitigation: plant drafts that trip exactly one guard, or remove both layers of a pair together; assert on the named problem list (guard.py:89-107); report "N of M guards shown to matter", and overlapping catches separately.
- Define "a guard": per Jev question, per regex, per ingress check (signature, dedupe, do-not-contact, human-owned). Removal means filtering the named problem out after checking, so the Jev request stays identical.
- The switches exist only in the dry-run instance's config, never in a header or payload. The core checks at the start of each run that every guard is on, and hands off if not; a replay scenario proves the setting is ignored on the live instance. Env access in Code nodes may be blocked (unverified).

**R10. The relay forwards everything in the thread; the signature proves the workspace, not the owner.** [zoom-out, inventive-catalyst, comprehension, implementation-readiness, codebase-details, design]
- Owner side-notes ("ok, calling her now"), edits, deletes, files and the bot's own alert, "outside 24h" and template-offer posts would all be relayed or loop.
- Mitigation: relay only plain new messages from an allowed list of Slack user IDs; ignore all subtypes and anything with a bot or app ID (field names unverified); optionally a documented note prefix (for example `//`) that is never relayed; react to each relayed message to confirm it was sent. Turn Slack formatting (`&amp;`, `<url|text>`, `<@U…>`) into plain text before sending.
- The "Return to bot" button needs the same allowed list. Any workspace member can likely click it (unverified).
- The pre-send human-owned check (Races) would block every owner relay, because relays only happen while human-owned is true. Use one `send` step with `sender_kind`: bot sends need human-owned false; owner sends need it true; both re-check do-not-contact and the 24-hour window; only bot sends go through the draft check and length cap. [structural, design]
- Spikes: Slack's URL-verification challenge, whether form-encoded interactivity bodies (`payload=`) sign the same way as JSON events, retry headers, and whether one workflow can hold two Webhook triggers.

**R11. Data tables and the workflow split are not defined for the new design.** [implementation-readiness, structural]
- Proposed tables:
  - `conversations`: wa_id (unique), stage, stage_version, offered_slots, unclear_in_a_row, slot_taken_count, reoffer_used, prompt_epoch, human_owned, owned_since, released_by, released_at, last_customer_at, slack_channel, slack_thread_ts, handoff_episode, hubspot_contact_id, hubspot_deal_id, deal_stage, booked_event_id;
  - `inbox`: source (meta, slack_event, slack_action), external_id, status (received, handling, done, failed), tries, claimed_at, execution_id;
  - `do_not_contact`: wa_id, source, at;
  - `message_log`: actor (customer, bot, person), slack_user, route, guard_problems, facts_version, workflow commit;
  - `handback_audit`; `crm_pending`; `outbox` (dry-run only); `guard_config` (dry-run only).
- Data tables don't export with workflows, so a setup script creates them. Spike whether data tables can filter by `slack_thread_ts` for the reverse lookup.
- The proposed workflow list (Recommended, below) has no Slack, CRM or doctor workflows; updated below.

**R12. The brief and the old brief now contradict the decisions in several places.** [structural; structural rates the old brief a Blocker]
- In this brief, the following were stale and are now marked or rewritten in this update: the Overview's single "main evidence"; the A6 reset proposal; A7's HTTP-by-default; A5 option (b); B4's 300-character cap; B7's caching open point; the inventive table's "HTTP Request by default"; the Ideal Final Result's "core nodes only"; the Non-Goal "unless the race spike shows it is needed" vs "No Postgres"; Goals missing relay and CRM; spike 5's "choose the path".
- One item in the Decided list still reads oddly beside the others: "Main evidence: replay scenarios" now sits next to "Meta delivery as a second headline". Not changed here because it is in the Decided list; the author may want to rename it "first headline".
- The old brief (C:/Users/Yomi/whatsapp-n8n-agent-brief.md) still says: Haiku default classifier with Jev via HTTP (line 131); "one classifier call" (42); WhatsApp Trigger entry (54); Sheet-or-table state and a do-not-contact sheet (56, 57, 69); email or Slack alerts with no relay (62); undefined "qualified lead" (66, 107); replay against a "copy of the workflow" (95); "Live test" (96); a missing section reference (109); only main and error workflows (115); settled decisions listed as open (128-134); no days for relay, crm-sync, doctor or Cloud. Add a banner "Superseded where it conflicts with concepts_brief.md, Decided list", or rewrite it.

**R13. Scope has roughly doubled against the 7-day plan.** [zoom-out]
- The 7-day plan had none of: split ingress with HMAC, dry-run instance with mock server and fixed clock, two tiers plus removal run, two Slack endpoints, the template, the two-step deal, the doctor, the Cloud pass. The zoom-out lens estimates 15-20 working days.
- Mitigation: publish a cut-line order where each step leaves something showable, so a slip cuts from the end: (a) safety path, gate, ingress and fixed tier; (b) meta-setup.md and hand test; (c) handoff alert plus "Return to bot"; (d) Slack text relay with 24-hour handling; (e) crm-sync; (f) live-model tier and removal run; (g) doctor and Cloud pass. Rewrite the day table to match.

**R14. The Sheets log has no fixed place in the flow.** [design, zoom-out, implementation-readiness, inventive-catalyst, codebase-details, comprehension]
- crm-sync runs "after the message is logged", so a Sheets failure would skip it.
- Mitigation: the data-table log is the source of truth and the per-message trace for replay assertions. The Sheets append runs after the send, its errors are caught and recorded in the data-table log, and it never blocks the reply or crm-sync (queue it with crm work if Sheets latency or quota matters, unverified).
- The Sheet holds phone numbers and owner text: mask `wa_id` and say so in the privacy notes.

#### Nits

- **600-character cap scope.** [all seven lenses] Lead Bot caps the draft, then appends the stage question (conversation.py:366-367, 508-511). Say whether 600 applies to the draft or the whole message, whether it counts characters or UTF-16 units, and that owner relays are exempt. Decide whether to keep `plain_punctuation`, which existed for SMS cost (conversation.py:346-348). The WhatsApp maximum is unverified.
- **Define one passed hand test** and keep the doctor out of the headline, since it is built last. [comprehension]
- **Doctor:** read-only Graph calls, manual trigger only, never a webhook; token scopes unverified; never echo tokens. **Cloud pass:** notes only, no Cloud-specific build. [zoom-out, structural, design]
- **Fixture redaction changes the body,** so re-sign fixtures with the test secret after removing numbers. [design]
- **Token budget:** the full facts sheet goes to Haiku and the draft check on every off-script turn. Cap sheet size and history, and set a budget for live-tier runs. [design]
- **Rollback:** store stage_version and the workflow export's git commit on each log row; unknown stage values hand off. [implementation-readiness]
- **Slack app manifest** must include the events and interactivity URLs and their scopes. [structural]

### Inventive contradictions and resolutions

Round 1 rows (one row updated to match the decisions):

| Contradiction | Resolution (principle) | Trade-off |
| --- | --- | --- |
| Signature-verified ingress vs a replayable test | Split into ingress and core (segmentation). Replay signs with a test secret; a forged-signature scenario proves the check works. | Two entry paths; prove both produce the same internal message. The HMAC depends on raw-body access. |
| Parallel executions vs exactly-once dedupe and human-owned | Separate in time: acknowledge at once, concurrency 1, claim row first, check flags again before send. | Throughput cap; one extra read on every send. |
| State the owner can see vs state the machine owns | Self-service through an intermediary: a Slack "Return to bot" action runs a small release workflow. | A second public endpoint with a Slack signature check. |
| Portable to Cloud vs an unverified community Jev node | Extraction: a `classify` sub-workflow with a contract. **Superseded:** the author chose the Jev node as the plan, HTTP Request as fallback only (see R6). | Cloud pass may need the fallback built. |
| Proof that guards catch things vs well-behaved models | Separation by condition: a writer fixture mode in the test instance only, plus a guard-removal run. | The fixture path must be impossible to switch on in the live instance; report injected and natural catches separately. |
| Showing delivery debugging vs replayed payloads | Split the proof: replay (logic), hand test (delivery), doctor (setup checks). | The doctor needs token scopes and upkeep as Meta changes. |
| Stubbed send vs testing the real workflow | A separate dry-run Docker instance with an outbox table, running the same workflow export. Never a payload flag. | The two instances can drift apart. |

Round 2 rows:

| Contradiction | Resolution (principle) | Trade-off |
| --- | --- | --- |
| Concurrency 1 vs Slack's ~3 s ack and Meta's ack | Ingress only verifies, claims and answers; one processor works the inbox in order (segmentation, intermediary) | One more workflow; poll latency |
| No reset vs a context the owner has changed | `prompt_epoch` blocks the digit shortcut until the bot asks again; re-ask without counting it as unclear | One column, one scenario |
| Kept slots vs stale slots | Check slots when read; expired slots don't count as taken (beforehand cushioning) | One Calendar call per resumed conversation |
| Thread relay vs owner side-notes and loops | Allowed user IDs, ignore bot IDs and subtypes, optional note prefix, confirm reaction | Owner must learn the prefix |
| Relay through the bot number vs the 24 h window | Pre-send window check in code; Meta's refusal and `failed` status as backstops | Rule held in two places |
| Pre-send human-owned check vs owner relays | One send step with `sender_kind` that flips the human-owned condition | One extra parameter on every send |
| Side CRM vs lookup-before-create races | Local ID map plus a queue that converges on target state (self-service) | HubSpot updates arrive late |
| Exact price vs natural wording | Extract and normalise amounts, check (service, amount) against a typed price set, fail closed | More false blocks and owner alerts |
| Jev node vs stubbing and Cloud | Fixture variant of `classify` in dry-run; one contract suite for node and fallback | Two classifier paths to keep in step |
| Guard removal vs production safety | Switches only in dry-run config; start-of-run check that all guards are on | One check per run |

### Ideal Final Result

One command prints "passed X of Y" for the fixed tier, and every defined guard has a scenario that fails when only that guard is removed. A separately reported live-model tier and hand-test counts sit beside it. The core doesn't care how a message arrives and uses built-in nodes except, if spike 1 picks one, the Jev node inside `classify`. Every event (customer message, owner relay, release click) goes through one ordered queue, so the bot and the owner never talk over each other. Release keeps state but only trusts what the bot itself asked. Side effects (HubSpot, Sheets) follow the conversation's state instead of racing it. The owner never touches n8n, only Slack. A meta-setup.md built from real failures, and the doctor run, answer "why don't my messages reach n8n?".

---

## Goals vs. Non-Goals

**Goals**
- Rebuild Lead Bot's safety design in n8n, stating clearly what was carried over and what changed.
- Show, with a fixed-tier replay, that each defined guard catches a planted case, reported as "passed X of Y", with a guard-removal run.
- Report live-model results separately from planted-input results.
- Show Meta delivery competence as a second headline: a signature-checked ingress, meta-setup.md built from real failures, fixtures captured from real webhooks, and hand-test counts.
- Hand off to the owner on Slack whenever unsure; let the owner reply from the Slack thread through the business number; hand back with one button.
- Record enquiries and bookings in HubSpot as a two-step deal without ever affecting the customer's reply.
- Keep the core portable to n8n Cloud wherever that is practical, record one Cloud setup pass, and document what it did not cover.
- Measure only. Call it a working prototype on a WhatsApp test number.

**Non-Goals**
- Production use or production claims.
- HubSpot or the Sheets log in the safety path: a CRM or Sheets failure must never block or change a reply to the customer.
- Porting roofing-specific stages and guards as they are.
- Auto-expiring the human-owned flag (most lenses; not formally decided).
- Postgres or locking beyond concurrency 1 with claim-first dedupe (decided: no Postgres).
- Running the owner's text through the AI draft check.

---

## Alternatives Weighed

**Rejected (with reasons, by lens consensus)**
- **Replaying through a "copy of the workflow that sends nothing" (as the brief says).** Rejected: copies drift apart, and a copy may fight the live subscription for the callback URL. Use a split ingress/core with a dry-run instance or Send sub-workflow instead.
- **Cutting HubSpot (all seven reviewers).** Rejected by author: CRMs were named in 31 of the 362 jobs searched and the portfolio has no CRM work yet.
- **Other "qualified lead" definitions.** Rejected by author in favour of the two-step Enquiry → Booked deal: "booking confirmed" alone misses customers who drop off; "asked to book" alone shows no pipeline; a postcode/service/home-size qualifying check adds a conversation stage the reviewers advised against.
- **Resetting the conversation on hand-back (reviewers' proposal).** Rejected by author: the bot continues from where the conversation was.
- **A `/resume` slash command or editing the data table as the main hand-back.** Rejected by author in favour of a "Return to bot" button; editing the table stays as the fallback only.
- **Owner contacts the customer from their own line while the bot goes quiet.** Rejected by author in favour of the Slack relay, which keeps the whole conversation on the business's WhatsApp number in the demo.
- **A test-mode switch in the request header or payload.** Rejected: anyone could forge it in production. The same applies to guard-removal switches (R9).
- **Reading a missing classifier field as 0.0.** Rejected: unsafe; a missing field must hand off, as jev.py does.
- **An n8n Switch that sends to all matching outputs for hazards.** Rejected: it breaks the first-match order. Use first-match or a Code node.
- **One combined "passed X of Y" mixing planted and live results.** Rejected: it breaks the honesty rule.
- **Making a community Jev node required with no fallback.** Rejected: it blocks the build and hurts Cloud portability.
- **HTTP Request node as the default classifier, with a Jev node only if it passes the contract tests (reviewers' recommendation).** Rejected by author: the Jev node stays the plan, and HTTP Request is kept only as the fallback inside `classify`.
- **Postgres-based dedupe and per-number locks (round-1 option b).** Rejected by author (decided "No Postgres").
- **"Never state a price" (Lead Bot's rule).** Replaced by author with "any price stated must match the facts sheet exactly".
- **Caching the facts sheet.** Rejected by author: read once per run, no cache.

**Open (not yet decided)**
- WhatsApp Trigger node vs plain Webhook node for production ingress. Leaning Webhook for ingress, with the Trigger built and documented once. Waits on spike 2.
- Which Jev node (n8n-nodes-typesafe-jev, n8n-nodes-jev-classification or the reported official TypeSafe node), and whether the node and HTTP fallback may be mixed. Waits on spike 1.
- Where concurrency 1 applies: the whole instance, or a processing workflow behind ingress workflows that answer at once (R1). Waits on spike 3.
- Whether the processor runs on a schedule or is triggered per row.

---

## Key Decisions & Staging for Next Steps

**Decided (by the author)**
- Demo business: cleaning company.
- Classifier: Jev. Off-script writer: Claude Haiku.
- Jev is called through an n8n Jev node, not an HTTP Request node (decided 2026-11-20). The node still sits inside a `classify` sub-workflow with a fixed contract, so the rest of the workflow doesn't depend on it. Spike 1 still decides *which* node: it must accept options set by expression, return probability or confidence for every field in one call, raise an error on a missing field, and handle the fixed draft-check question set. If no candidate passes, an HTTP Request node goes inside `classify` as the fallback. The README states that a community node may not install on n8n Cloud.
- Hosting: self-hosted n8n in Docker with a public HTTPS URL.
- Owner alerts: Slack.
- HubSpot stays in scope (decided 2026-11-20) as a `crm-sync` sub-workflow that runs after the message is logged, outside the safety path. If HubSpot fails, the customer's reply is unaffected and the owner gets an alert. It has its own replay scenarios, with the HubSpot call stubbed in the fixed tier.
- Qualified lead = two steps in HubSpot (decided 2026-11-20). When the classifier reads booking intent or times are offered, `crm-sync` looks up the contact by phone number, creates it if missing, and creates one deal at an "Enquiry" stage (or reuses the open one). When the calendar event is created, the deal moves to "Booked". The lookup before create prevents duplicate contacts and deals on repeat messages or retried runs. The hand test reports enquiries and bookings, so enquiry-to-booking is a measured number. Replay scenarios: first enquiry (contact and deal created), repeat enquiry (no duplicate), booking (deal moves to Booked), HubSpot down (reply still sent, owner alerted).
- Owner reply path: Slack relay (decided 2026-11-20). Each handed-off conversation gets one Slack thread. The owner replies in that thread and n8n sends the text to the customer through the bot's number. This is new design, not a Lead Bot rebuild, and it needs:
  - a data table row linking the Slack thread (`thread_ts`) to the customer's WhatsApp ID;
  - a second public webhook for Slack events, with Slack's signing-secret check (HMAC over the raw body plus a timestamp check);
  - dedupe on Slack's event ID, because Slack retries if it doesn't get a 200 within about 3 seconds;
  - ignoring messages posted by the bot itself in the thread, or the relay loops;
  - re-checking do-not-contact before every relayed send, so a customer who sent STOP gets nothing;
  - the 24-hour window: if the customer's last message is older than 24 hours, a free-form relay is refused by Meta. The workflow must catch that and tell the owner in the thread instead of failing silently. One approved template (wording: "We have an update on your enquiry. Reply here to see it.") is registered for this case (decided 2026-11-20): the owner is offered it in the thread, and when the customer replies the 24-hour window reopens and the relay works again;
  - logging relayed owner messages in the same message log, marked as sent by a person;
  - owner text is not passed through the AI draft check (a person wrote it), and the README says so;
  - hand-back through a "Return to bot" button on the handoff alert (decided 2026-11-20). Slack sends button clicks to a separate interactivity URL, which needs the same signing-secret check. The click clears the human-owned flag and is logged with who clicked it. Only Slack user IDs on an allowed list can click it; a second click on an already-released conversation does nothing. The data table stays editable in n8n as a documented fallback if Slack is down;
  - release does **not** reset the conversation (decided by author 2026-11-20, overriding the reviewers' reset proposal). Stage and offered slots are kept, so the bot picks up where it left off. Two consequences the build must handle:
    - offered slots may be stale (in the past, or booked by the owner during the handoff). A slot pick after release still goes through Lead Bot's booking checks before booking: the booking-rules check, which refuses past or too-soon slots, then the free/busy re-check (booking.py:126-135; free/busy alone does not catch a past slot). A slot that is gone or in the past is treated like Lead Bot's "slot taken" path and fresh times are offered (in Lead Bot that path offers fresh times once and hands off on the second taken slot, conversation.py:438-445; see R2);
    - `unclear_in_a_row` may already be at the handoff limit, so one more unclear message would hand straight back to the owner. Release clears that one counter and nothing else (decided 2026-11-20);
  - the bot does not message the customer at the moment of release; it waits for their next message. Do-not-contact is never cleared by the button, only by the customer sending START;
  - replay scenarios for: a "Return to bot" click (next customer message is answered by the bot), a click with a bad signature (ignored), a double click (no change), a reply from the bot itself (ignored), a Slack retry (deduped), a bad Slack signature (dropped), a relay to an opted-out customer (blocked) and a relay outside 24 hours (owner told).
- State in n8n data tables; facts in a Google Sheet.
- Headline 1: replay scenarios showing each guard catching something.
- Replay runs in two tiers, each reported as its own "passed X of Y" (decided 2026-11-20): a fixed tier with stubbed classifier outputs and drafts that are bad on purpose, which proves each guard fires, and a live-model tier with real Jev and Haiku and sending still stubbed. A guard-removal run (each guard switched off, its scenario must then fail) goes with the fixed tier.
- Smaller items, all decided 2026-11-20 (author accepted the proposed set):
  - **Races:** acknowledge Meta at once, production concurrency 1, claim the message ID row before any side effect, re-check human-owned and do-not-contact before every send, re-check free/busy before booking. The throughput cap goes in Limits. No Postgres.
  - **Draft check:** the Lead Bot way, a second Jev call plus code backstops, with the questions rewritten for a cleaning company.
  - **Price guard:** "never state a price" is dropped. Replaced by "any price stated must match the facts sheet exactly".
  - **Reply length cap:** 600 characters.
  - **Facts:** read the sheet once per run and pass the same copy to writer and guard. No cache.
  - **Message log:** a Google Sheets log as well as the data tables.
  - **Doctor workflow:** build it, after everything else.
  - **n8n Cloud:** one recorded setup pass on the free trial, written up in meta-setup.md.
- Meta delivery evidence is a second headline next to the replay score (decided 2026-11-20): `docs/meta-setup.md` written from real failures (including ones caused on purpose), replay fixtures captured from real webhooks from the author's phone with numbers removed, and a separately reported hand-test count on the test number.
- Honesty rule: only measured results, never called production.

- Round 2 resolutions, all accepted by the author 2026-11-20 (they refine the decisions above; where they differ, these win):
  - **Acknowledgement (R1):** ingress workflows (`ingress-whatsapp`, `ingress-slack-events`, `ingress-slack-interactivity`) check the signature, write the event to an inbox data table and return 200 at once. A separate processor takes inbox rows one at a time. Concurrency 1 applies to the processor, not to ingress. Spike 3 confirms the mechanism (schedule vs per-row trigger).
  - **Stale slots after release (R2):** a slot that went stale during a handoff (in the past, too soon, or now busy) takes a new "expired after release" path: fresh times are offered and `slot_taken_count` and the re-offer marker are not incremented. Release still clears only `unclear_in_a_row`.
  - **Bare-number picks after release (R3):** after release, a bare "2" is not treated as a slot pick until the bot itself has offered times again (a `prompt_epoch` or equivalent marker). Jev's context uses the bot's last message, not the owner's.
  - **Gate order (R4):** after dedupe: STOP/START keyword, then do-not-contact, then explicit opt-out text, then record `last_customer_at`, then human-owned (post the customer's message into the owner's Slack thread and stop), then classify. Keywords come before do-not-contact so START can be read. Flags are checked again before send; booking checks run again before booking.
  - **Customer messages during a handoff (R4):** posted into the Slack thread. Each handoff opens a new thread.
  - **START (R4):** START removes the number from do-not-contact. This is new design: Lead Bot left STOP/START to Twilio, and WhatsApp is believed to have no carrier-level keyword handling (unverified; spike 2).
  - **Who may click or relay (R10):** an allowed list of Slack user IDs. Clicks and thread replies from anyone else are ignored and logged. (A Slack signature proves the workspace, not the person.)
  - **Owner relays vs the human-owned re-check (R10):** every send carries `sender_kind` (bot or owner). Owner sends skip the human-owned check; no send skips do-not-contact or the 24-hour check.
  - **Booking intent (R7):** add a booking-intent answer to this project's classifier question set (not present in Lead Bot). Enquiry fires on that answer or when times are offered, whichever comes first.
  - **Template wording (R5):** "We have an update on your enquiry. Reply here to see it." The old wording claimed a reply was delivered when it was not.
  - **Headlines (R12):** the replay score is headline 1; Meta delivery evidence is headline 2.

**Recommended to adopt now (strong consensus, author to confirm)**
- Split into workflows:
  - ingress: `ingress-whatsapp`, `ingress-slack-events`, `ingress-slack-interactivity`, `ingress-replay` (protected by a secret, off outside testing);
  - conversation: queue processor, `classify` (takes a question-set name: stage questions or draft check), `answer` (writer plus draft check), `book`, `handoff` (opens a new thread);
  - owner side: `owner-relay`, `owner-release` (routes on the button's action ID: return to bot, send template);
  - shared and side: `send` (with `sender_kind`), `log` (data tables plus Sheet), `crm-sync`, `doctor` (manual trigger only), `error`.
- Check the 24-hour window in code before every relay and template send (R5).
- Store HubSpot contact and deal IDs on the conversation row; search HubSpot only when they are empty; one alert per outage (R7).
- Guard-removal switches exist only in the dry-run instance (R9).
- Define the data tables (R11) and create them with a setup script.
- Publish the cut-line order (R13) and rewrite the day plan to match.
- Reconcile the old brief with the decisions, or put a "superseded" banner on it (R12).

**Open questions and spikes (proposed order)**
0. **Start now, in the background: template approval.** Can a custom template be registered and approved on the test-number WABA, in which category, and how long does approval take? Register it on Day 1 so waiting doesn't block the 24-hour scenarios.
1. **Jev contract and node.** Capture the raw HTTP request and response from the SDK in a scratch environment, never inside lead-bot. Test each candidate node for: options set by expression, probability per field, confidence for the pick-one question, behaviour on a missing field (a Code node after it may enforce the error), a second fixed question set for the draft check, a configurable base URL (needed to stub it), and whether it installs on Cloud.
2. **Meta ingress.** Webhook GET handshake. HMAC over the raw body with non-ASCII text and emoji; `crypto` access in Code nodes. Compare with the WhatsApp Trigger (does it register the callback URL itself, does it check the signature).
3. **Concurrency, acknowledgement and data tables.** Is the concurrency limit per instance or per workflow? Does a Webhook set to respond immediately answer before a queued execution starts? Do waited-on sub-workflows count against the limit (deadlock risk)? Test: three Meta posts and one Slack post while a run sits in a 20-second Wait, timing each 200. Also: data table behaviour on a duplicate key and parallel upsert, filtering by `slack_thread_ts`, and availability on Cloud.
4. **Slack events and interactivity.** URL-verification challenge; signing of JSON event bodies and form-encoded interactivity bodies over the raw body; retry headers; which fields mark the bot's own posts and message subtypes; user IDs on clicks; whether one workflow can hold two Webhook triggers.
5. **Meta 24-hour behaviour.** Does an out-of-window send fail at once (which error code) or later as a `failed` status event?
6. **HubSpot.** Search lag after create, a unique phone property, custom pipeline stages ("Enquiry", "Booked") on the free plan, private-app scopes.
7. **Stub mechanism.** Env-based base URLs and a mock server, a fixture variant of `classify`, pinned data behaviour, the executions API for waiting on completion, a fixed clock, env access from Code nodes for the dry-run-only guard switches.
8. **Define for cleaning:** the stage table, the guard list with one-guard-only planted drafts, the draft-check question set (including what replaces `price_talk`, `PRICE_WORDS` and the insurance checks), the price normalisation and (service, amount) rule, the threshold config, the 600-character cap scope, the release behaviour for stale state, and the thread state table.
9. Then build the echo bot (with the status filter) and the first workflow, writing scenarios and meta-setup.md notes from Day 1, following the cut-line order.
10. Last: the doctor workflow (read-only Graph calls; token scopes unverified) and the recorded Cloud setup pass, including when to move Meta's single callback URL to Cloud and back.
