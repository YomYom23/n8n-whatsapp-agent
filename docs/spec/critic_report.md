# Stage 7: Critic Report

Target: `docs/designs/whatsapp-agent.md`, FeatureRange lines 1–493. Reviewers: `egm-design` and `egm-structural` (both against `feature-spec-standard.md`), and `egm-style`. No extra context files.

---

## Design Critic

### Blocker

1. **Send rules block messages the design requires (lines 304–312 vs 97–98, 104, 233, 320, 332).** (a) The STOP confirmation is blocked by the do-not-contact rule, and again by the human-owned rule during a handoff. (b) "Send template" goes through `send`, but the table never says how a template passes the 24-hour rule; sent as `owner`, it would just be stored as pending again. (c) A handoff notice is blocked once `human_owned` is set. CUJ 4 and CUJ 5 can't pass as written. *Fix:* give `send` a message class (`opt_out_confirmation`, `handoff_notice`, `template`, `normal`) with a rule table naming every exemption; state the order of operations in STOP and handoff; add one scenario per exemption.

### Major

2. **Processor ordering and locking are not sound (lines 216–227).** Read-then-mark isn't atomic. In the schedule branch, overlapping runs are possible, and "instance-wide limit, but only the processor is limited" contradicts itself. A stuck row only alerts; later rows for the same customer can run past it. A `failed` row leaves the customer with nothing. *Fix:* a lease row with execution ID and expiry, read back to confirm; hold later rows for a customer behind an unfinished one; stuck-row recovery; on `failed`, fallback line plus handoff; spike 3 tests overlapping runs.
3. **Duplicate fallback doesn't work (line 214).** A duplicate is a new `received` row. Ingress check-then-write races. *Fix:* the processor marks a row `done (duplicate)` if a `handling` or `done` row has the same `external_id`.
4. **No consolidated Risks & Mitigations section.** Missing entirely: a per-number rate limit (one spammer starves everyone and runs up model costs); a cost cap; escaping customer text posted to Slack (`<!channel>`, disguised links); prompt injection against the classifier; retention of phone numbers, text and payloads, and data-table size limits; the Sheets quota as a live limit; a long-lived system-user Meta token. *Fix:* a Risks & Limits table, plus a rate limit, daily cost cap, Slack escaping, retention period and quota ceiling.
5. **Alternatives Rule (lines 421, 442, 449, 451, 453–454).** Rejections give the decider, not the trade-off; reviewer positions aren't linked; the Postgres rejection rests on the unverified duplicate handling. *Fix:* technical reasons, links into `concepts_brief.md`, and what happens to the Postgres decision if spike 3 fails.
6. **The chosen code-packaging approach isn't in the Technical Plan (lines 453–454, 463, 476).** *Fix:* add a section on `lib/`, unit tests, the inlining build and the drift check.
7. **Missing spike fallbacks (line 120 vs 72, 197, 71).** No fallback if the template isn't approved, or if the Webhook node gives no raw body or Code nodes can't use `crypto`. *Fix:* `hello_world` or narrowed Goal 6 / CUJ 5; a verifying proxy (Caddy) for signatures; say which goals shrink.
8. **The "cancel" risk's worst case isn't covered (lines 233, 298).** A booked customer sends "Cancel", is opted out, the event stays, and a cleaner turns up. *Fix:* always alert the owner with booking details when STOP arrives while a booking exists or times are on offer; optionally mention the booking in the confirmation.
9. **One booking key per customer, forever (lines 346–358, 298).** Returning customers can't rebook. *Fix:* a key per booking episode and a defined way out of `booked`.
10. **"Closed" is undefined (lines 268–269).** No stage, no column, no rule for the next message, no way to undo a false positive. *Fix:* a `closed` stage with a reason, defined handling of later messages, and an owner reopen button.
11. **Price-check gaps (line 286).** "It's 120 for a deep clean", "USD 120", "120/hr" and amounts in words slip through; units aren't checked; service-name matching and sentence splitting are unspecified. *Fix:* treat any number near a price word, or not in the approved facts, as a problem; check units; plant drafts for each bypass form.
12. **Guard switches in live workflows (lines 366–368, 466).** The live check runs only in `conversation`, so ingress switches aren't covered. One env value is the whole trust boundary. "Problem removed from the result" doesn't fit gate and ingress guards. *Fix:* role check in every ingress workflow; require explicit `INSTANCE_ROLE=live` and fail closed; define switch behaviour per guard type.

### Nit

13. Pending owner messages after "Return to bot" are undefined (lines 332–333, 238).
14. "All alerts go through `slack-adapter`" contradicts the email fallback (line 405).
15. "Within a few seconds" isn't testable (line 80); state the worst-case reply time (lines 468–472).
16. Sources of the 0.5 / 0.3 thresholds and "ask once more" rules aren't given (lines 253, 285, 296).
17. `prompt_epoch` and `person_spoke_last` look redundant (line 376).
18. UTC slot IDs vs local opening hours: DST and labels not covered (lines 346, 401).
19. HubSpot eventual consistency: state that duplicates need a crash between create and store, and whether that's accepted (line 390).

**Overall:** strong for a portfolio design, but not yet compliant. Findings 1 and 4 are the main blockers; 2–3 need a real lease and duplicate backstop since Postgres is ruled out. Fix 1–7 before implementation; close 8–12 in the same revision.

---

## Structural reviewer

### Blocker

1. **Two rejections break the Alternatives Rule (lines 421, 442).** "The author chose…" with no trade-off and an unlinked reviewer attribution. *Fix:* give the trade-off (e.g. 421: client recognition and built-in credentials vs community-node risk; 442: resetting discards a given address and still-valid times), and link the review record if attribution stays.

### Major

2. **No Risks & Mitigations section.** Risk material is scattered across lines 62, 70–72, 233, 460–466, 471 and sections 4, 6, 7, 14–16. *Fix:* an H2 table (risk, impact, mitigation, where covered), covering at least: "cancel" opt-out, Jev/Haiku outage, template not approved, throughput limit, signature bypass, mock/adapter drift, HubSpot/Sheets outage, secret leaking into JSON, stuck processor, unreadable facts sheet.
3. **Heading hierarchy (lines 480, 485).** Additional Resources and Future Improvements are H3 under NFRs. *Fix:* make them H2.
4. **The document breaks its own spike rule (line 120 vs 72, 314, 390).** Template approval has no spike or fallback; Meta's out-of-window refusal (314) and HubSpot search lag (390) name no spike; Open Questions gives no spike numbers. *Fix:* number every open question; add the template-not-approved branch; name spikes at 314 and 390.
5. **The chosen `lib/` approach is never described (lines 453–454, 463, 476).** *Fix:* a Technical Plan subsection "Code layout and build"; point the two alternatives to it.
6. **Diagram vs workflow table (lines 133–164 vs 168–188).** `owner-release` has no arrow to `send`; crm queue skips the processor; `sheets_queue` missing; `conversation`, `ingress-replay`, adapters, `error`, `doctor` and outbound Slack/Calendar/Sheets calls not drawn. *Fix:* redraw from the table, or label it a simplified customer-message path.
7. **The core design choice has no rejected alternative (lines 407–454).** "Classifier plus code" vs "LLM agent with tools" isn't listed; nor Haiku as classifier, n8n's text-classifier node, or another writer model. *Fix:* a "Decision architecture" group with concrete trade-offs (first-match order, calibrated probabilities, one-guard-at-a-time removal).

### Nit

8. Unlinked attributions (lines 449, 451).
9. NFR sub-areas use bold labels, not headings (lines 460, 468, 474; also 194, 204).
10. Heading names differ from the standard ("The Problem", "Technical Plan (Architecture)").
11. Section order: Open Questions mid-requirements, NFRs after Alternatives behind a lone horizontal rule.
12. Spike definitions sit after line 493, so the spec can't be read alone; add a spike index to Open Questions.
13. File references aren't links; Lead Bot referenced by a local Windows path; line 409 repeats line 23.
14. Whitespace-only line inside a nested list (line 431).

Checked and fine: section cross-references, table column counts, closed code blocks, uniform CUJ format. **Verdict:** needs revision; fixing 1–7 should bring it into compliance.

---

## Style reviewer

### Major

1. **"Never delays" conflicts with the design (lines 51, 64).** `crm-sync` and `sheets-log` share the one-at-a-time processor. *Rewrite:* "never changes a reply; any delay is limited to the node's timeout", or move them out of the processor.
2. **Absolute claims about who acts (lines 19, 13).** Not every failure hands off (draft-check failure, HubSpot/Sheets, abusive, facts unreadable); Haiku's `NOT_IN_FACTS` picks a path. *Rewrite:* "When the classifier is unsure or unavailable, or a customer asks for a person, the conversation is handed to the owner. Other failures send fixed text and alert the owner." / "decides every route".
3. **Unsupported generalisation (line 31).** "A typical n8n AI agent…" has no source; Lead Bot's 67/67 and 431 tests aren't tied to the listed failures. *Rewrite:* cite an example and say how many tests cover those failures.
4. **"Proving" and "actually" overstate replay (lines 36, 42).** *Rewrite:* "showing that each guard catches its scripted failure scenario, and that the scenario fails when the guard is off."
5. **Goal 7 "always honoured" and "clear" aren't bounded (line 50).** Only keywords and listed phrases skip the model. *Rewrite:* "Opt-out keywords and phrases are honoured without a model call… Other opt-out wording is caught by the classifier's `opt_out` question."
6. **"Within a few seconds" can't be checked (line 80).** *Rewrite:* "the reply time is logged in `message_log`".
7. **Spike-coverage claim is broader than the content (line 120).** Lines 314 and 390 name no spike; spike 2 (line 197) has no second branch. *Rewrite:* add them, or narrow the claim.
8. **"With the reason for each" isn't true of every entry (line 409).** Lines 421, 442, 451. *Rewrite:* add a reason per entry.

### Nit

1. "In production" (line 202) vs the doc's own no-production rule → "in the live instance".
2. "The core" undefined (line 127) → "`conversation`".
3. Three names for the taken-slot limit (lines 92, 357, 376).
4. Repeated "any case" wording (line 233).
5. Counts listed out of order (line 27).
6. Marketing tone (line 38): drop.
7. "Headline 1/2" unexplained (lines 42, 45).
8. "Actually" filler (lines 45, 36).
9. "Without losing the conversation's place" is vague (line 49).
10. Unquantified amounts (lines 65, 225, 257, 320, 470).
11. Conditional in a Then clause (line 116).
12. "Clumsier" is subjective (line 441).
13. Emoji instead of the reaction name `white_check_mark` (line 330).
14. "The '12345 Oak Ave' limit" unexplained (line 489).
15. Additional Resources / Future Improvements should be H2; local Windows path (line 483); `lib/` not introduced (line 476).

**Overall:** dry, direct and concrete. The main weakness is claim calibration.
