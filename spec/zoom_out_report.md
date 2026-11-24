# Stage 5: Initial Zoom Out Report

Target: `docs/designs/whatsapp-agent.md` (full file, lines 1–720). Reviewers: `egm-zoom-out`, `egm-inventive-catalyst`. No extra context files.

---

## Part A: Zoom Out reviewer

No Blockers. The objective and motivation are clear (lines 9–38). The repo has no code yet, so the reuse check did not apply.

### Major

1. **The build order puts the cheapest, most market-relevant proof behind the most expensive step (lines 29, 35, 511–523).** The delivery evidence (`meta-setup.md`, fixtures, hand test) is step B, but step A is almost the whole system. If time runs out inside A, neither headline ships. *Direction:* move most of B ahead of A. Build a minimal live `ingress-whatsapp` with a signature check and an echo reply, set Meta up while breaking it on purpose, write `meta-setup.md` and capture fixtures. Then build the safety system on top.
2. **The test and build infrastructure outweighs the product (lines 124–131, 186, 360–370, 496–507, 637–660, 667–690).** The design needs two instances, a Python mock of seven services, four fake adapters swapped in by workflow ID, a contract test, export and deploy scripts, a Node bundler with a drift check, and test-only switches in live workflows. *Direction:* (a) drop the bundler: keep the logic in the Code nodes and have `node --test` pull each node's text out of the exported JSON and run it with injected inputs; (b) let fake adapters return scenario data from one mock endpoint or pinned data; (c) pick one tooling language.
3. **The inbox, processor and two side queues add an async-queue layer the volume does not need (lines 145, 162, 212–227, 381, 386–397).** The design doesn't show that "Webhook responds immediately" plus concurrency 1 on `conversation` would fail; spike 3 tests exactly that. *Direction:* make that the default and keep the inbox only for duplicate checks; add the processor only if spike 3 requires it. Call `crm-sync` and `sheets-log` as fire-and-forget sub-workflows with continue-on-fail.
4. **The hand-back state machinery is heavy for what it buys (lines 92, 239, 337–339, 357, 376).** `prompt_epoch`, `person_spoke_last`, `offered_before_release`, `handoff_episode`, the unclear exemption, the expired-not-counted rule, the calendar lookup and the resume summary. *Direction:* keep the stage on release but drop the offered slots, so the next message in `offer` gets fresh times. Most of those fields then go away.
5. **Too much detail is fixed before the spikes that can overturn it (lines 70–72, 120, 190, 224–225, 249, 525–533).** *Direction:* run spikes 1–3 first, then cut the design to the chosen branches.
6. **The 24-hour template path has no fallback if Meta refuses the template (lines 49, 72, 102–104, 332, 515).** *Direction:* name a fallback (Meta's pre-approved `hello_world` template on test numbers, or cut step D), and consider whether CUJ 5 earns its cost.
7. **Guard switches sit in the live code path (lines 127, 366–368, 466, 610).** *Direction:* remove guards at deploy time on the dry-run instance only (`deploy_workflows.py --remove-guard X` bypasses the node in the imported JSON), so live workflows carry no switch logic or self-check.

### Nit

8. The Technical Plan drops to code level (lines 196–199, 207, 233, 286, 300, 330) and repeats Target Files (lines 575–630).
9. The Cloud argument is inconsistent (lines 65, 454 vs 528, 540, 466): the npm option is rejected for Cloud, but other parts may not run on Cloud either.
10. Some rejected alternatives give no reason (lines 421, 442, 449, 453–454).
11. The Sheets log duplicates `message_log` (lines 163, 185, 381, 397); it could be cut or written inline with continue-on-fail.
12. CANCEL and END come from SMS carrier rules (line 233). WhatsApp has no such requirement; dropping CANCEL removes the accepted risk.
13. Jev is never introduced (lines 15, 70).
14. The editor is public behind basic auth (line 550); keep it on localhost or the tunnel.
15. `doctor` (lines 187, 523) is speculative; could move to Future Improvements.

**Overall:** the safety core holds up, but the design builds a bespoke platform around it, mostly before the spikes that decide whether it's needed, and schedules the delivery story behind the biggest step. Needs revision, not rethinking.

---

## Part B: Inventive Catalyst reviewer

REVIEW mode: advisory severities only (Major / Nit).

### Major

1. **Test-only settings: environment or mock server at run time? (lines 127, 368, 414, 466, 545, 670).** Lines 368/414/466 say they exist only in the dry-run environment; line 545 and 670 say the harness loads them per scenario through the mock server. Line 466 says live *ignores* them, line 368 says live *hands off*. The live-ignores scenario can't run, since the harness only targets dry-run. Ingress guards run before `conversation`'s check. *Resolution:* one `lib/settings.js` used by every workflow; when `INSTANCE_ROLE !== 'dryrun'` it returns built-in constants and makes no network call. Pick one live behaviour and unit-test it under both roles. *Cost:* every settings-reading node includes it; dry-run depends on the mock for settings.
2. **HubSpot and Sheets work runs in the same one-at-a-time processor as replies (lines 183–185, 222, 393; Goal 8 line 51; Non-Goal line 64).** A slow HubSpot call delays replies, contradicting Goal 8. Retry ordering across queues is unstated. *Resolution:* per-workflow limit → drain side queues in a separate scheduled workflow; per-instance limit → strict inbox priority plus a `not_before` backoff column. *Cost:* a second schedule or priority logic; CRM lags more.
3. **One lane forced a shorter classifier retry (lines 222, 257).** A Jev blip over ~15 s hands off everyone who writes during it. Only per-customer order is required. *Resolution:* on failure, set the row back to `received` with `not_before = now + 60 s`; the processor skips rows whose `wa_id` has an earlier unfinished row. *Cost:* more complex row selection, its own scenario.
4. **Failure paths alert the owner but give them no way to act (lines 281, 289, 227, 220, 326).** `NOT_IN_FACTS` and blocked drafts promise a follow-up but don't hand off, so `owner-relay` refuses the owner's reply. Failed or stuck rows leave the customer with nothing, and later rows for the same customer can run out of order. *Resolution:* those cases open a handoff (or post a "Take over" button); a reconciliation step marks rows stuck >5 min as failed, hands off, and holds later rows for that `wa_id`. *Cost:* more handoffs; needs a circuit breaker for outages; must check execution state before marking failed.
5. **One booking key per customer means a customer can only book once (lines 350, 338, 376, 391).** Carried over from roofing; cleaning customers rebook. A second booking request finds the old event and is treated as booked; the single `hubspot_deal_id` would move the old deal. *Resolution:* key per enquiry (customer key + enquiry sequence), one deal per enquiry. *Cost:* new counter and a transition out of `booked`; needs unit tests; redefine enquiry-to-booking per enquiry.
6. **CANCEL stays a keyword and the misfire risk is accepted (lines 233, 436).** The list came from Twilio; WhatsApp imposes none. *Resolution:* (a) drop CANCEL and END from bare keywords (still caught by the `opt_out` hazard and phrases), stating the small narrowing of Goal 7; or (b) send the confirmation with a one-tap "I meant cancel my booking" button. *Cost:* (a) bare "cancel"/"end" opt-outs depend on a model; (b) a new inbound message kind and a do-not-contact exception path.
7. **The pending owner-message machinery assumes a template-then-wait two-step (lines 104, 238, 310, 332, 379, 444).** A utility template with a body variable could carry the owner's text in one send. Also: if the owner presses "Return to bot" before the customer replies, pending messages are stranded. *Resolution:* in S0 also try registering "Update from {{business}}: {{1}}"; if approved, most of the pending subsystem goes away; if not, state what happens to pending messages on release. *Cost:* variable limits, possible rejection, per-send billing.

### Nit

8. **Facts sheet freshness vs availability (lines 401, 452, 416).** Any Sheets outage gives every customer the "unavailable" line. Keep reading every run, but fall back to the last good copy (age-capped) when the read fails.
9. **Three overlapping flags track "who spoke last" (lines 337, 357, 376).** Replace `prompt_epoch`, `person_spoke_last` and `offered_before_release` with one increasing counter stamped on each offer.
10. **The fallback duplicate check is check-then-write and the backstop doesn't work (line 214).** A duplicate row has its own `received` status. Make the processor the single dedup point: it marks a row `done (duplicate)` if a `handling` or `done` row has the same `external_id`.

**Already resolved well:** adapters plus mock plus contract test; `// @lib` generated regions with `--check`; code-only routing and price checks; separate fixed and live scores.

**Overall:** careful on model safety and honest measurement. The weak points are constraints accepted as fixed that were side effects of other choices: the single lane pulling CRM/Sheets into the reply path, the contradictory settings rule, the one-booking key, and failure paths that only alert. Fixing 1–5 before step A removes the main contradictions without adding scope.
