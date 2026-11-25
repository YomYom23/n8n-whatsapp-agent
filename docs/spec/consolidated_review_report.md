# Consolidated Review: WhatsApp Agent Design

Target: `docs/designs/whatsapp-agent.md` (720 lines). Mode: consolidated, all rubrics, no extra context files. Split at line 494 (FeatureRange 1–493, DetailedRange 494–720).

Stage reports: `zoom_out_report.md` (Stage 5), `comprehension_report.md` (6), `critic_report.md` (7), `intermediate_zoom_out_report.md` (8), `implementation_readiness_report.md` (9).

**Verdict:** needs revision, not rethinking. The safety core holds up (code decides routes, the model only writes, drafts are checked twice, the owner takes over on doubt, fixed and live scores kept apart), and the codebase reviewer confirmed most of the Lead Bot port matches the source. But two mechanisms everything depends on can't be built as written: the one-at-a-time processor and the same-ID deploy. Several flows contradict each other, and the interfaces between the author's workflows and the agent's code are undefined.

**The main tension across stages.** Stages 7 and 9 mostly propose *adding* machinery: a lease, per-customer holds, send classes, a `closed` stage, episode keys, risk controls. Stages 5 and 8 propose *removing* the parts those fixes repair. Four simplifications from Stage 8 resolve roughly 25 findings with less design. Decide them first (D1–D4 below); many later tasks shrink or disappear depending on the answer.

---

## Decisions to make first

| ID | Decision | Simpler option (Stage 5/8) | Additive option (Stage 7/9) | Findings it settles |
|---|---|---|---|---|
| D1 | Event ordering and duplicates | Serial dispatch: Webhook responds immediately, concurrency 1, n8n's execution queue; inbox kept only as a duplicate table; CRM/Sheets fire-and-forget | Keep the processor, add a lease row, per-customer holds, stuck-row recovery, backoff, processor-level dedup | CB-B2, CD2, CD3, IC2, IC3, IC10, CR7, CSt1, ZO3, IZ1 |
| D2 | Guard removal for the replay | Remove guards at deploy time on dry-run only (`--remove-guard X`); no switches in live workflows | `lib/settings.js` in every workflow, role check in ingress, fail closed on missing role | ZO7, IC1, CD12, CR2, CR3, IR2, CB-M1, IZ2 |
| D3 | 24-hour template path (CUJ 5) | Cut it: outside the window the thread is told "customer must message first"; record the behaviour in `meta-setup.md` | Keep it, add a `template` send class, a fallback if not approved, and rules for pending messages on release; or try a one-send variable template | ZO6, IC7, CD1b, CD7, CD Nit 13, CS4, CR13, IZ3, CB-N13 |
| D4 | State after "Return to bot" | Clear the offered slots on release and keep the stage | Merge the three flags into one counter (IC9), or define each flag | ZO4, IC9, CR4, CR8, CD Nit 17, CSt Nit 3, IZ7, CB-M11 (part) |
| D5 | Keep the `lib/` bundler? | Drop it: logic lives in Code nodes; tests extract it from the exported JSON | Keep it, document it, fix module format and Code-node mode | ZO2a, IZ10, CD6, CS5, CR11, CB-M10, IR13 |

The author already chose option 2 (`lib/` plus a build script) for D5. Stage 8 notes shared modules are a real argument for keeping it. If kept, the work is the documentation in task M2.

---

## 🔴 Blockers

| ID | Action | Raw findings |
|---|---|---|
| B1 | **Fix the send rules so required messages can go out.** STOP confirmation is blocked by do-not-contact and by human-owned; the handoff notice is blocked once `human_owned` is set; the template has no way past the 24-hour rule. Simplest fix: send the handoff notice before setting `human_owned`, one exemption flag for the opt-out confirmation, and a stated order of operations. The template depends on D3. | CD1, CR1, IZ4 |
| B2 | **Give event ordering a mechanism that works in n8n (D1).** Self-hosted n8n has no per-workflow concurrency setting, no data-table trigger, and Schedule Triggers overlap; the duplicate fallback doesn't dedupe. Either adopt serial dispatch, or a schedule processor with a lease row and processor-level dedup. Spike 3 must also test overlapping runs and whether queued executions survive a restart. | CB-B2, CD2, CD3, IC10, CR7, IZ1, ZO3 |
| B3 | **Make deployment preserve workflow, credential and data-table IDs.** The public API assigns new workflow IDs; credential and table IDs differ per instance; exporting from dry-run overwrites live adapters with fakes; live adapters can't be edited anywhere. Use `n8n import:workflow --separate` or an ID remap, credential lookup by name, export of fakes to `workflows/fakes/`, a defined place to edit live adapters, and "reset" that deletes rows only. | CB-B1, IR8 (part) |
| B4 | **Pick one mechanism for replay settings and guard removal (D2).** Env vs mock-server contradiction; ingress guards not covered; the "live ignores switches" scenario can't run; "fixture mode" undefined; switching off a non-draft guard undefined. | IC1, CR2, CR3, CD12, IR2, CB-M1, ZO7, IZ2 |
| B5 | **Define the interfaces between workflows and code.** Inputs, outputs and errors for each adapter and for `classify`, `send`, `log`, `book`, `handoff`; the mock server's `/_scenario` and `/_calls` JSON; the `scenarios.toml` schema with one worked example; canonical guard IDs. Name who writes `build-guide.md` (the coding agent) and require it to match. | IR1, IR2, IR11 (part) |
| B6 | **Specify every data table's columns and types.** Including `crm_queue`, `sheets_queue`, `outbox`, `slack_thread_ts`, and the missing `pending_owner_messages` fields (all depend on D1/D3). | IR3 |
| B7 | **Give every rejected alternative a concrete trade-off.** Lines 421 and 442 cite only who decided; link reviewer positions to `concepts_brief.md` or drop the attribution; Postgres rejection should say what happens if spike 3 fails. | CS1, CD5, CSt8, ZO10, CS8 |

## 🟡 Major

| ID | Action | Raw findings |
|---|---|---|
| M1 | **Add a Risks & Limits section.** Table of risk, impact, mitigation or "accepted for prototype". Build only Slack escaping of customer text (`<!channel>`, disguised links); list rate limits, cost caps, retention, classifier injection, Sheets quota and data-table size cap as stated limits. Include "cancel" opt-out, Jev/Haiku outage, template not approved, throughput, signature bypass, adapter drift, HubSpot/Sheets outage, secret leakage, stuck processor, unreadable sheet. | CD4, CS2, IZ9, CB-N10, CB-N11, IZ13 |
| M2 | **Describe the code layout and build in the Technical Plan (D5).** `lib/`, unit tests, the inlining build and drift check; module format (CommonJS), Code node mode (fix the `$json` vs array example), secret patterns. Point the two alternatives at it. Correct "Code nodes can't load dependencies" to "this deployment allows no external modules". | CD6, CS5, CR11, IZ10, CB-M10, IR13, CSt-I2, CSt-I4 |
| M3 | **Number every open question as a spike, give each a fallback, and mark which files wait on which spike.** Template approval, Meta out-of-window refusal (line 314), HubSpot search lag (line 390), spike 2 raw body / `crypto` (fallback: signature goal narrowed, not a Caddy proxy), spike 7 same-ID fakes, no-price-fields branch. Add a spike index to Open Questions. | CS4, CD7, CSt7, ZO5, IR9, IZ12, CS12, CB-N9 |
| M4 | **Settle the 24-hour path (D3).** If kept: fallback template, pending messages on release, Utility vs Marketing classification. | ZO6, IC7, CD Nit 13, CB-N13 |
| M5 | **Settle the opt-out keyword list.** Reviewers in Stages 5, 7 and 8 recommend dropping CANCEL and END (still caught by the `opt_out` hazard and phrases) and narrowing Goal 7's wording; or keep them and always alert the owner when STOP arrives during a booking. Also: the list doesn't match Lead Bot's (missing STOPALL, REVOKE, OPTOUT, UNSTOP); "OPTOUT" would reach Jev. Note: the author previously accepted the CANCEL risk. | IC6, CD8, ZO12, IZ5, CB-M4, CSt5 |
| M6 | **Define "close the conversation".** Reuse handoff for `wrong_person` and `abusive`, show "Return to bot" as reopen; route `NOT_IN_FACTS`, blocked drafts and failed runs into handoff so the owner can reply. Label the change from Lead Bot's wrong-person do-not-contact, or port it. | CD10, CR6, IC4, IZ6, CB-M6 |
| M7 | **Define or remove the hand-back flags (D4).** If kept, define `prompt_epoch`, `person_spoke_last`, `offered_before_release` and the taken/re-offer limits as rules. | ZO4, IC9, CR4, CR8, IZ7, CSt Nit 3 |
| M8 | **Fix the booking key.** Define the event ID (Lead Bot: `sha256("booking:" + key)` hex; must be base32hex), Calendar node fields, cancelled status = deleted, 409 handling. Allow rebooking: key = `wa_id` + slot ID, or state that `booking_request` in `booked` hands off. | CD9, IC5, CR5, IZ8, CB-M8 |
| M9 | **Complete the slot port.** Earliest slot on each of 3 days and the "later days" re-offer, as in Lead Bot; gap, `minNotice`, `daysAhead`, `hours` tab columns, hourly-service booking duration; full `stillAllowed` signature; DST scenario. | CB-M7, IR5, CD Nit 18 |
| M10 | **Tighten the price check.** Add "any number not in the approved facts text blocks the draft"; cover `$ 80`, `$1,200`, `120 USD`; define sentence splitting and service-name matching (optional `aliases` column); state amounts in words as a limit. | CD11, IZ11, CB-M9, IR6 (part), CR17 |
| M11 | **Add missing `lib` modules and data shapes.** `send_rules.js`, `booking.js`, `crm.js`, `release.js`; a normalised classifier result; reply kinds; `prices`/`total` types; expected outputs for every named unit test (e.g. "12345 Oak Ave" → ZIP 12345); tests for `route`, `stages.next`, `questions` (reserved IDs), `slack_text`. | IR6, IR7, IR11, CB-M11, CB-N6 |
| M12 | **Complete configuration and deployment details.** Pinned n8n and Node versions; `N8N_BLOCK_ENV_ACCESS_IN_NODE`, runner `NODE_FUNCTION_ALLOW_BUILTIN`, `N8N_ENCRYPTION_KEY`, `WEBHOOK_URL`, `N8N_HOST`, `N8N_PROTOCOL`, `N8N_PROXY_HOPS`; mock base URL names; n8n API URL/key; template name; HubSpot pipeline/stage IDs; Calendar and Sheet IDs; Haiku model; scopes for Slack, HubSpot, Google. Caddy: `/webhook/*` public, editor (with `/rest/*`, `/assets/*`, OAuth callback) on localhost or tunnel only; one time-zone setting. | IR8, CB-M2, CB-M3, CB-M13, ZO14, IR14 |
| M13 | **Choose the nodes for sending and the writer.** `send` as an HTTP Request to Meta's messages endpoint (stubbable); name the Anthropic node and model, confirm it outputs token usage, or use an HTTP Request; say how dry-run points it at the mock. | CB-M12 |
| M14 | **Reorder and split the build.** Put the delivery evidence first: a minimal live ingress with signature check and echo reply, `meta-setup.md` and fixture capture. Split Step A into checkable sub-steps, map each file to a step, tag scenarios by step, use synthetic bodies until captures exist. | ZO1, IR4, CB-M14 |
| M15 | **Port or label the Lead Bot behaviours that changed silently.** `off_topic` counting toward the unclear limit and counter resets; writer context (history plus address and booked time); draft-check state keys; `PICKED_NUMBER` forms; 600 vs 300 cap; Jev per-call timeout. | CB-M5, CB-M15, CB-N1, CB-N2, CB-N3 |
| M16 | **Make the HubSpot sync correct.** Associate the deal with the contact; normalise phone to E.164; state the create-then-store-fails case. | CB-M16, CD Nit 19 |
| M17 | **Calibrate absolute claims.** "Never delays" (lines 51, 64; true only under D1's fire-and-forget), "owner takes over when anything fails" (19), "decides every action" (13), unsourced "typical n8n agent" (31), "proving" (36), Goal 7 "always" (50), "within a few seconds" (80), spike-coverage claim (120); live-tier and hand-test pass conditions; guard-removal pass = N of N; README metrics named. | CSt1–7, CSt-I5–7, CD Nit 15 |
| M18 | **Reduce infrastructure weight where it doesn't serve a headline.** Fakes return scenario data from one mock endpoint; drop the dry-run `outbox` (mock already records sends); one record of messages (`message_log` or Sheets log); consider one tooling language. | ZO2, IZ14, IZ15, ZO Nit 11 |
| M19 | **Fix the diagram and add the core alternative.** Label the diagram "customer-message path (simplified)", add `owner-release` → `send`; add "LLM agent with tools" / "LLM as classifier" to Alternatives with concrete trade-offs. | CS6, CS7, IZ16 |
| M20 | **Replace `facts-template.csv` with four CSVs or one JSON file, with exact demo rows.** | IR10, CR18 |
| M21 | **Add `scripts/report_metrics.py`** for enquiry-to-booking, cost per conversation and throughput. | IR12 |
| M22 | **Define the actors and terms.** "Code" → "coding agent"; introduce Jev and TypeSafe; define `repeat`, `later`, "the core", FACTS, the 24-hour window; make Lead Bot references self-contained. | CR10, CSt-I1, CR12, ZO Nit 13, CR9, CR13, CR16, CR22, CSt Nit 2 |

## 🟢 Nits

| ID | Action | Raw findings |
|---|---|---|
| N1 | Heading fixes: Additional Resources and Future Improvements to H2; NFR sub-areas as H3; consider section order; consistent dividers. | CS3, CS9, CS10, CS11, CSt Nit 15 |
| N2 | Links: repo-relative links for source docs; Lead Bot by repo name, not a Windows path; remove the duplicate "brief is out of date" line. | CS13, CR15, CR14, CSt Nit 15 |
| N3 | Wording: "in production" → "in the live instance"; drop the line 38 pitch; "headline 1/2" explained; drop "actually"/"only ever"; vague phrases and unquantified amounts; emoji → `white_check_mark`; "12345 Oak Ave" explained; one spelling convention; repeated "any case"; list order; conditional Then clause (116); "clumsier" (441). | CSt Nits 1, 4–14, CSt-I Nits 8–23 |
| N4 | Small technical notes: `timingSafeEqual` length check and header prefixes; re-sign exact redacted bytes; pin `luxon` to n8n's version and use an explicit test glob; Python 3.11+; `.gitignore` "Create or modify"; exact test file paths. | CB-N4, CB-N5, CB-N7, CB-N8, IR15, IR16, CB-N12 |
| N5 | Email alert path shouldn't go through `slack-adapter` (line 405). | CD Nit 14 |
| N6 | Thresholds: say they come from Lead Bot. | CD Nit 16 |
| N7 | Facts sheet: keep "fixed line plus alert" (no last-good cache); list Sheets outage as a risk. | IC Nit 8, IZ13 |
| N8 | `doctor` could move to Future Improvements. | ZO Nit 15 |
| N9 | Cloud argument for rejecting the npm option is inconsistent; rest it on legibility. | ZO Nit 9 |
| N10 | Technical Plan repeats code-level detail from Target Files. | ZO Nit 8 |
| N11 | Replay: say which scenarios use real ingress vs `ingress-replay`; "Meta's timeout" value; inbox trigger mechanism. | CR19, CR20, CR21 |

---

## Traceability matrix

Prefixes: **ZO** Stage 5 zoom-out, **IC** Stage 5 inventive catalyst, **CR** Stage 6 comprehension, **CD / CS / CSt** Stage 7 design / structural / style, **IZ** Stage 8, **IR / CB / CSt-I** Stage 9 implementation readiness / codebase details / style.

| Raw finding | → Task | Raw finding | → Task | Raw finding | → Task |
|---|---|---|---|---|---|
| ZO1 | M14 | CR1 | B1 | IZ1 | B2, D1 |
| ZO2 | M18, D5 | CR2, CR3 | B4 | IZ2 | B4, D2 |
| ZO3 | B2, D1 | CR4 | M7 | IZ3 | M4, D3 |
| ZO4 | M7, D4 | CR5 | M8 | IZ4 | B1 |
| ZO5 | M3 | CR6 | M6 | IZ5 | M5 |
| ZO6 | M4, D3 | CR7 | B2 | IZ6 | M6 |
| ZO7 | B4, D2 | CR8 | M7 | IZ7 | M7, D4 |
| ZO Nit 8 | N10 | CR9, CR10, CR12, CR13, CR16, CR22 | M22 | IZ8 | M8 |
| ZO Nit 9 | N9 | CR11 | M2 | IZ9 | M1 |
| ZO Nit 10 | B7 | CR14, CR15 | N2 | IZ10 | M2, D5 |
| ZO Nit 11 | M18 | CR17 | M10 | IZ11 | M10 |
| ZO Nit 12 | M5 | CR18 | M20 | IZ12 | M3 |
| ZO Nit 13 | M22 | CR19–21 | N11 | IZ13 | N7, M1 |
| ZO Nit 14 | M12 | CD1 | B1 | IZ14, IZ15 | M18 |
| ZO Nit 15 | N8 | CD2, CD3 | B2 | IZ16 | M19 |
| IC1 | B4 | CD4 | M1 | IR1, IR2 | B5 (IR2 also B4) |
| IC2, IC3 | B2, D1 | CD5 | B7 | IR3 | B6 |
| IC4 | M6 | CD6 | M2 | IR4 | M14 |
| IC5 | M8 | CD7 | M3 | IR5 | M9 |
| IC6 | M5 | CD8 | M5 | IR6 | M11, M10 |
| IC7 | M4, D3 | CD9 | M8 | IR7 | M11 |
| IC Nit 8 | N7 | CD10 | M6 | IR8 | M12, B3 |
| IC Nit 9 | M7 | CD11 | M10 | IR9 | M3 |
| IC Nit 10 | B2 | CD12 | B4 | IR10 | M20 |
| CS1 | B7 | CD Nit 13 | M4 | IR11 | M11, B5 |
| CS2 | M1 | CD Nit 14 | N5 | IR12 | M21 |
| CS3 | N1 | CD Nit 15 | M17 | IR13 | M2 |
| CS4 | M3 | CD Nit 16 | N6 | IR14 | M12 |
| CS5 | M2 | CD Nit 17 | M7 | IR15, IR16 | N4 |
| CS6, CS7 | M19 | CD Nit 18 | M9 | CB-B1 | B3 |
| CS8 | B7 | CD Nit 19 | M16 | CB-B2 | B2 |
| CS9–11 | N1 | CSt1–7 | M17 | CB-M1 | B4 |
| CS12 | M3 | CSt8 | B7 | CB-M2, M3, M13 | M12 |
| CS13 | N2 | CSt Nits | N3, M22, M7 | CB-M4 | M5 |
| CS14 | N3 | CSt-I1 | M22 | CB-M5, M15 | M15 |
| | | CSt-I2, I4 | M2 | CB-M6 | M6 |
| | | CSt-I3 | M15 | CB-M7 | M9 |
| | | CSt-I5–7 | M17 | CB-M8 | M8 |
| | | CSt-I Nits | N3 | CB-M9 | M10 |
| | | | | CB-M10 | M2 |
| | | | | CB-M11 | M11 |
| | | | | CB-M12 | M13 |
| | | | | CB-M14 | M14 |
| | | | | CB-M16 | M16 |
| | | | | CB-N1–3 | M15 |
| | | | | CB-N4, N5, N7, N8, N12 | N4 |
| | | | | CB-N6 | M11 |
| | | | | CB-N9 | M3 |
| | | | | CB-N10, N11 | M1 |
| | | | | CB-N13 | M4 |
