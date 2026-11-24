# Stage 9: Implementation Readiness Report

Target: `docs/designs/whatsapp-agent.md`, DetailedRange lines 494–720. Reviewers: `egm-implementation-readiness` and `egm-codebase-details` (both against `implementation-readiness-standard.md`), and `egm-style`.

Coverage note: the codebase-details reviewer read Lead Bot's `conversation.py`, `jev.py`, `slots.py`, `guard.py` and `text_questions.py` in full, and parts of `text_script.py` and `booking.py`. Partway through, `C:\Users\Yomi\lead-bot` stopped resolving, so `lead-bot\deploy\` was judged only from its file listing.

---

## Implementation Readiness reviewer

### Blocker

1. **Sub-workflow and adapter contracts are never defined (lines 652–665, 657–660, 667–670, 687–690; also 186, 190).** The adapters' "same inputs and outputs" aren't written down, and neither are those of `classify`, `send`, `log`, `book` and `handoff`. Everything is deferred to an unwritten `build-guide.md` with no named owner. The mock server, fakes, contract test and the author's wiring can't agree. *Fix:* an "Interfaces" subsection with operation names, input and output JSON fields with types, and the error output; name who writes `build-guide.md`.
2. **Replay settings mechanism contradicts itself, and the scenario format has no schema (lines 545, 670, 677–680; also 366–368, 466).** Env variables can't change per scenario without a restart. The ingress guards aren't covered by the switch check. The "live ignores switches" scenario can't run on dry-run. The `/_scenario` body, `/_calls` response, `GUARDS_OFF` format, guard IDs and `scenarios.toml` schema are undefined. *Fix:* one mechanism (e.g. `GET {MOCK_BASE_URL}/_settings` only when role is dryrun); list guard IDs; JSON for the mock API; a TOML schema with one worked example; restate the live check as a unit test or simulated-role scenario.
3. **Data-table schemas can't drive `setup_tables.py` (lines 647–650; also 376–382, 529).** No column names, types or defaults; `crm_queue`, `sheets_queue`, `outbox` have no columns; `slack_thread_ts` isn't in section 13; `pending_owner_messages` lacks `wa_id`/episode and creation time; JSON storage unstated. *Fix:* a table per data table (column, n8n type, meaning, JSON-serialised or not).

### Major

4. **Phasing lacks stable checkpoints (lines 509–523, 680, 711).** Step A is most of the system; its fixed tier needs fixtures that arrive in B and includes C–E scenarios. *Fix:* split A into sub-steps; map each file to a step; tag scenarios by enabling step; use synthetic bodies until B's captures.
5. **Slot and booking inputs missing (lines 567–605; also 346, 349–352, 401, 695).** No gap column, no `minNotice` value, no `hours` format, elided `stillAllowed`, no booking-key derivation (Google event IDs must be base32hex, 5–1024 chars), no days-ahead. *Fix:* add them to config or sheet columns; define `hours` columns; full signature; define the key.
6. **`lib` signatures lack data shapes (lines 577–595).** Normalised classifier result, reply kinds, fields-to-update shape, 0- vs 1-based slot index, `prices`/`total` types, sentence splitting, service-name matching, `priceFacts` format. *Fix:* define a normalised classifier result that `classify` maps to; list reply kinds; fix types and matching rules.
7. **Logic with no `lib/` home (lines 567–630 vs 453).** Send rules, `prompt_epoch` update rules, book counters, CRM target state, release text, Jev context-line choice, stuck-row check, CRM alert throttle. *Fix:* `lib/send_rules.js`, `lib/booking.js`, `lib/crm.js`, `lib/release.js` with listed tests.
8. **Configuration is incomplete (lines 552–555, 540–545, 642–645).** Missing mock base URL names, `INSTANCE_ROLE` and replay settings in the templates, n8n API URL/key, template name and language, HubSpot pipeline/stage IDs, Calendar and Sheet IDs, Haiku model ID and max tokens. Credential IDs in exported JSON differ between instances; same-ID fakes have no fallback. *Fix:* complete env list per instance; credential handling (strip IDs, resolve by name); fallback if spike 7 fails.
9. **Files aren't marked as blocked by spikes (lines 511, 525–533).** *Fix:* a "blocked by spike N" column; copy spike results into the plan before dependent work; spell out the no-price-fields branch.
10. **`facts-template.csv` can't hold four tabs (lines 692–695).** *Fix:* four CSVs or one JSON file, with columns and the exact demo rows.
11. **Test cases have no expected outcomes (lines 632–635, 677–680).** e.g. the "12345 Oak Ave" result; scenarios have no expected route/sends/rows; guard denominator M not listed; how the duplicate guard is switched off if tables enforce uniqueness. *Fix:* expected output per case and per scenario; enumerate M.
12. **No file computes the claimed metrics (Goals 8, 10; lines 707–716).** Enquiry-to-booking rate, cost per conversation, throughput. *Fix:* `scripts/report_metrics.py` with inputs, formulas and token prices.

### Nit

13. Bundler module format, call-block exports, Code node mode, secret regexes unstated; NFR "the build script" ambiguous (lines 565, 640).
14. `GENERIC_TIMEZONE` and `BUSINESS_TZ` could disagree (lines 540, 555).
15. No Python version; `tomllib` needs 3.11+ (lines 642, 667, 672).
16. `.gitignore` is "Create" though the repo exists (line 557).

**Overall:** not ready under the Zero-Decision Rule. The pure `lib/` logic is close, but the interfaces where the agent's code meets the author's workflows (contracts, mock API, scenario schema, table columns, env names) are undefined or deferred, and the settings mechanism contradicts itself.

---

## Codebase Details reviewer

### Blocker

B1. **The deploy script can't work as specified (lines 642–645, 507).** n8n's public API `POST /workflows` assigns new IDs, so Execute Workflow references break on a fresh instance and on rollback; credential and data-table IDs also differ per instance. Exporting from dry-run (which holds the fakes under live IDs) would overwrite `workflows/<adapter>.json` with fake content, and live adapters can't be edited anywhere. *Fix:* import with `n8n import:workflow --separate` (keeps IDs) and activate through the API, or a deterministic ID remap; make credential and table IDs match or remap them; export dry-run adapters to `workflows/fakes/`; say where live adapters are edited; "reset tables" must delete rows, not recreate tables.

B2. **The one-at-a-time processor has no working mechanism in either branch (lines 529, 174, 224–226).** Self-hosted n8n in regular mode has no per-workflow concurrency setting; `N8N_CONCURRENCY_PRODUCTION_LIMIT` is instance-wide and also queues webhooks. There is no data-table trigger node. A Schedule Trigger fires again while the previous run loops. Data tables have no compare-and-set. The line 214 dedup fallback doesn't dedupe. *Fix:* the schedule branch with a lease row (holder + expiry, claim and re-read), interval longer than the max loop or a loop that stops before the next tick; skip rows whose `external_id` has a `done`/`handling` sibling; state the ingress → processor start mechanism.

### Major

M1. Replay settings: two contradictory mechanisms; the live-role scenario can't run (lines 545, 680, 466).
M2. **Env access and n8n version (lines 540, 545).** From n8n 2.0 `N8N_BLOCK_ENV_ACCESS_IN_NODE` defaults to true; with external task runners `NODE_FUNCTION_ALLOW_BUILTIN` goes on the runner. No pinned version named. Missing `WEBHOOK_URL`, `N8N_HOST`, `N8N_PROTOCOL`, `N8N_PROXY_HOPS=1`, and a fixed `N8N_ENCRYPTION_KEY`.
M3. **Caddy routing breaks OAuth and the editor (line 550).** The editor needs `/rest/*` (including the push websocket) and `/assets/*`; OAuth redirects to `/rest/oauth2-credential/callback`. Lead Bot's listing suggests Caddy is its own compose project, unlike "one Compose project" (unverified).
M4. **The keyword list isn't Lead Bot's (lines 575, 233).** Lead Bot's STOP set is `{stop, stopall, unsubscribe, cancel, end, quit, revoke, optout}` and START includes `unstop` (text_script.py:89–92). "OPTOUT" isn't caught by the phrase regex, so it would reach Jev.
M5. **Lead Bot's off_topic counting is missing (line 580).** Lead Bot counts `off_topic` toward `unclear_in_a_row` (hands off at 2) and resets the counter on stage answers, `other_question` and `later` (conversation.py:221, 294–305).
M6. **wrong_person differs from Lead Bot without a label (line 590).** Lead Bot puts the number on do-not-contact (conversation.py:200–202).
M7. **Slot port incomplete (lines 602–605).** Lead Bot offers the earliest slot on each of 3 different days (`earliest_per_day`, slots.py:105), and "later times" offers only days after the last offered (conversation.py:374–410). Gap, `minNotice`, `daysAhead`, `hours` format and hourly-service duration have no source.
M8. **Booking key and event ID unspecified (lines 602–605, 344–358, 338).** Lead Bot fixes the event ID as `sha256("booking:" + key)` hex (booking.py:73–79), which is why a deleted event is detectable; key lookup comes before the free check. The Calendar node must set the event `id` and use Get by ID; a cancelled status means deleted; handle 409.
M9. **Price guard bypassable (line 595).** `$ 80`, `$1,200`, `120 USD`, words; "$120." decimal vs sentence end; service-name matching.
M10. **Bundler and Code-node conventions undefined (lines 637–640, 496–503).** The example uses `$json` (each-item mode) but returns an array (all-items shape).
M11. **Unit-testable logic without a module (lines 567–635).** Send rules, CRM target state, stuck-row check, pending flush, epoch fields; no named tests for `rules.route`, `stages.next`, `questions` (reserved option IDs, text_questions.py:105–113) or `slack_text`.
M12. **No node chosen for the Meta send or Anthropic redirection (line 545; also 186, 190).** The WhatsApp node has no base URL setting; the Anthropic base URL is a credential field; LangChain chat nodes don't readily pass `usage`. *Fix:* `send` as HTTP Request to `{{$env.META_BASE_URL}}/v{N}/{phone_id}/messages`; name the Anthropic node and model or use HTTP Request.
M13. **Scopes not listed (line 555).** Slack `chat:write`, `reactions:write`, `channels:history`/`groups:history`, `message.channels`; HubSpot contacts and deals read/write; Google Calendar and Sheets.
M14. Phasing not incremental (lines 509–523).
M15. **Writer loses Lead Bot's context (line 610).** Lead Bot passes conversation history and `conversation_facts` (address, booked time; conversation.py:328–335). Draft-check state keys (`FACTS`, `HOMEOWNER_QUESTION`, `REPLY`) not specified.
M16. **HubSpot deal never associated with the contact; creation not idempotent (line 391).** Specify the association; normalise `wa_id` to E.164; what happens if create succeeds but storing the ID fails.

### Nit

N1. Lead Bot's `PICKED_NUMBER` accepts "#2", "2.", "number 2", "option 2" (text_script.py:396).
N2. Draft cap 600 vs Lead Bot's 300 (guard.py:65): label it as changed.
N3. No Jev per-call timeout (Lead Bot: 5 s plus SDK retries).
N4. `timingSafeEqual` throws on unequal lengths; strip `sha256=` / `v0=` prefixes.
N5. Re-sign the exact redacted bytes, keeping Meta's escaping.
N6. "12345 Oak Ave" expected result: read as ZIP 12345.
N7. `node --test lib/` differs across Node versions; pin Node and `luxon` to the n8n image's version.
N8. Python 3.11+ for `tomllib`.
N9. Activating the WhatsApp Trigger re-registers the app's single callback URL; deactivate before tests.
N10. Data tables have an instance size cap (`N8N_DATA_TABLES_MAX_SIZE_BYTES`, about 50 MB default); add pruning.
N11. Sheets read quota caps throughput; state it.
N12. Globs where the standard wants exact paths (lines 632, 682).
N13. The template wording may be classed as Marketing, not Utility.

**Verified as matching Lead Bot:** hazard order and 0.5 thresholds, 0.3 draft threshold, missing-field rule, slot ID format, the three booking checks and their order, one-minute retry, draft dropped when Jev fails, the "Stop." nuance.

**Overall:** B1 and B2 can't be built as written; several Lead Bot behaviours are silently changed; slot, booking-key, price and settings inputs leave real choices to the implementer.

---

## Style reviewer

### Major

1. "Code" as an undefined actor (lines 496, 516, 518, 522) → "A coding agent ('Agent')".
2. "No runtime dependencies, because Code nodes can't load them" is too broad; self-hosted n8n can via `NODE_FUNCTION_ALLOW_EXTERNAL` (line 565).
3. "2 within about 15 s" in the config table (line 570) → an exact schedule.
4. "Secret-like strings" can't be checked (line 640) → list the patterns.
5. Live tier and hand test have no pass condition (lines 714–715).
6. "N of M guards shown to matter" vs "every guard's scenario fails" (lines 675, 712) → pass condition N = M.
7. README items name no metrics (line 705).

### Nit

8–23: "only ever" (507); "something that can be shown" (511); "→" used two ways (507, 575–630); fragment (527); "record its behaviour" unspecific and mixed British/US spelling (528); ambiguous "fields that mark bot posts and subtypes" (530); "any case" → case-insensitive (575); `inArea` return value (600); "book check 2" undefined (605); "repeat, later" labels (615); awkward build-guide sentence (665); "Answers as" → "Emulates" (670); "(signed, unsigned or wrong)" (675); informal scenario terms (680); "a handful of ZIP codes" (695); "*Drafted with EGM*" credit (720).

**Overall:** dry and factual; the problems are precision: an undefined actor, one over-broad n8n claim, approximate values, and verification items without pass conditions.
