# Spike Results

Results for the spikes listed in [the design](designs/whatsapp-agent.md#open-questions-and-spikes). Each entry records the date, what was tried, the result and the branch chosen. When a spike settles, its branch is copied into the design before dependent work starts.

## S0: Utility template on the test-number account

**Question:** Will Meta approve the custom Utility template on the test-number account, and how long does it take?

**Status:** In review

**What was tried**

*   **Submitted:** 2026-11-24 19:19 UTC, through the WhatsApp Business Tools MCP server (`whatsapp_biz_create_template`).
*   **Business:** Anthrall (1449061133455465). It is not verified, and its business profile is incomplete.
*   **Account:** Test Messaging Account (1821043622466971). The MCP server hides test accounts from its account list, but it accepted this account's ID when the template was created.
*   **Template:**

    | Field | Value |
    | --- | --- |
    | Name | `enquiry_update` |
    | Template ID | 4251171805181430 |
    | Language | `en_US` |
    | Category requested | Utility |
    | Body | We have an update on your enquiry. Reply here to see it. |
    | Header, footer, buttons, variables | None |
    | Delivery | Standard (no Max Price or campaign settings) |

**Result**

*   **Status at submission:** Pending, with category Utility.
*   **Decision:** _not yet known_. Record the date and time, and how long the review took.
*   **Category given by Meta:** _not yet known_. Record whether Meta moved it to Marketing.
*   **Rejection reason, if any:** _not yet known_.

**Branch chosen:** _pending_.
*   **If approved:** use `META_TEMPLATE_NAME=enquiry_update` and `META_TEMPLATE_LANG=en_US`.
*   **If rejected:** use Meta's pre-approved `hello_world` template on the test number, and say so in the README.

**Other findings**

*   **Developer Terms:** accepted on 2026-11-24, when signing in to Meta for Developers. They are needed to subscribe webhooks and register a number.
*   **Business profile and verification:** Anthrall is not a registered business, so both were skipped at first, on the assumption that the test number works without them. That assumption was wrong (next point).
*   **The test number cannot send while the business is unverified.** On 2026-11-24 two sends from the API testing page, to an allow-listed and verified recipient, were accepted and then failed. Both `failed` status webhooks carried error **131031 "Business Account locked"** ("Business account has been locked."). WhatsApp Manager shows the test account as **Account Restricted: "Before you can begin messaging, you will need to verify your business."** Business Support Home lists no policy issues. Live delivery (headline 2, CUJ 5) is therefore blocked until the business is verified or another route is chosen.
*   **Business verification:** submitted by the Author in Security Center on 2026-11-24. Meta accepts only official business documents for the legal name: incorporation papers, a business registration or licence, a government-issued business tax document, or a business bank statement. Personal ID and utility bills don't prove the legal name. Status on 2026-11-24: pending (`is_verified: false`). If verification fails, the fallback is the Twilio WhatsApp Sandbox for live delivery.

## S1: Which Jev node

**Question:** Which Jev node? It must accept options set per message, return a probability or confidence for every field in one call, fail on a missing field, take a second fixed question set (draft check), handle the `price_service` and `price_hours` fields, and allow its base URL to be changed.

**Status:** Done, 2026-11-24

**Node chosen:** `@typesafe-ai/n8n-nodes-typesafe-ai` **0.10.0** ("TypeSafe AI"), chosen by the Author. It is the official package: published from TypeSafe AI's GitHub repository with npm provenance, MIT licence, maintained by TypeSafe staff. Several unofficial nodes have similar names (`n8n-nodes-typesafe-ai` 0.1.1, `n8n-nodes-jev`, `n8n-nodes-ollaya`, `n8n-nodes-typesafe-system-one`), so install it by the full scoped name. Installed through **Settings → Community nodes** on n8n 2.49.5 and loads without problems (its README says it was tested with 2.40). Node type `@typesafe-ai/n8n-nodes-typesafe-ai.typeSafeAi`, version 1; credential type `typeSafeAiApi`.

**What was tried**

*   The package source, read without running it.
*   `scratch/spikes/s1_probe.py` and `s1_baseurl.py` (not in git) against the live instance with the Author's TypeSafe key. Evaluate operation, model `jev-latest` (answered as `jev-1.14.0`), **Questions Format: Using Raw JSON** from an expression, **Simplify** off, **Timeout** 4000 ms.
*   Stage set: three yes/no hazards (`wants_human`, `abusive`, `wrong_person`), `answer` (5 options), `price_service` (3 services plus `not_stated`), `price_hours` (1 to 8 plus `not_stated`). Six messages, including Portuguese with an emoji.

**Result**

| Requirement | Result |
| --- | --- |
| Options set per message | Pass. The questions object is built per item and passed through an expression. Choice questions take 2 to 255 options. |
| A probability or confidence for every field in one call | Pass. One `POST /v1/systemone` per message with all six questions; every field answered in every call. Yes/no answers return `noul` (a probability). Choice answers return `choice`, `confidence` and, with Simplify off, `probabilities` for every option. |
| Fail on a missing field | **Not in the node.** Evaluate copies whatever `answers` the API returns (a missing `answers` becomes `{}`); only Route fails on a missing answer. Covered by `checkComplete` in `lib/rules.js`, as the design already says. |
| A second fixed question set (draft check) | Pass. A second node with a JSON state `{facts, customer, draft}`: `unsupported_fact` was 0.03 for a draft that kept to the facts and 0.99 for one that invented a price and a promise. |
| `price_service` and `price_hours` | Pass, 16 of 16 expected picks, including the Portuguese message and "like five hours before I move out" (`move_out_clean` at confidence 0.6, `5` at 1.0). "I want to talk to a real person" gave `wants_human` 0.98. |
| Base URL can be changed | Pass, **through the CLI only**. The credential's `baseUrl` field is hidden. The public API refuses it (`request.body.data is not allowed to have the additional property "baseUrl"`). `n8n import:credentials` with `{"apiKey", "baseUrl"}` in plain `data` accepts it, and the node then sent its request to that base URL (an n8n webhook standing in for the API). |
| Latency | 2.2 to 2.3 s per call with six questions (762 input and 244 output tokens), inside the design's 4 s timeout. |

**Branch chosen:** the TypeSafe AI node inside `classify`; no fallback needed.

*   The dry-run instance's `classify` uses the real node with a credential whose `baseUrl` points at the mock server. `scripts/deploy_workflows.py` creates that credential with `n8n import:credentials`, not the public API.
*   Pin `@typesafe-ai/n8n-nodes-typesafe-ai@0.10.0`. The live instance has it installed in the `n8n_data` volume through the editor; a fresh instance needs the same install.

## S2: Meta ingress

**Question:** The GET handshake; whether the Webhook node exposes the raw body; HMAC with emoji and non-ASCII text; `crypto` in Code nodes; the WhatsApp Trigger's behaviour; Meta's webhook timeout.

**Status:** Done, 2026-11-24, except two items left for the Meta setup step (last two rows of the table).

**What was tried**

*   `scratch/spikes/s2_probe.py` (not in git) publishes a probe workflow at `/webhook/s2-meta`: a Webhook node (v2.2, **Allow Multiple HTTP Methods** GET and POST, **Respond: Using 'Respond to Webhook' Node**, option **Raw Body** on). GET goes to a Code node that checks `hub.verify_token` against `$env.META_VERIFY_TOKEN` and replies with the challenge or 403. POST replies 200 first, then a Code node computes HMAC-SHA256 over the raw bytes.
*   Requests go through the ngrok tunnel and Caddy, as Meta's do.

**Result**

| Check | Result |
| --- | --- |
| GET handshake, right token / wrong token | Pass: 200 with the challenge / 403. **Meta's own verify request** (`facebookplatform/1.0`) passed on 2026-11-24 at 00:37 UTC when the callback URL was saved. Meta sends both `hub.mode` and `hub_mode` forms of the query keys. |
| Raw body | Pass. With **Raw Body** on, the item has `binary.data` with the exact request bytes as inline base64 (no binary-data ID), next to the parsed `body`. Byte-identical for ASCII, raw UTF-8 emoji and accents, `\u`-escaped JSON and pretty-printed JSON. |
| HMAC over the raw body | Pass for all four bodies; wrong and missing signatures refused. HMAC over `JSON.stringify(body)` fails for the `\u`-escaped and pretty-printed bodies, so the check must use the raw bytes. |
| `crypto` and `$env` in Code nodes | Both work (`NODE_FUNCTION_ALLOW_BUILTIN=crypto`, `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`). |
| Reply time | 0.13 to 0.16 s per POST through the tunnel. |
| A real delivery from Meta | Pass. Two messages from the Author's phone to the test number arrived on 2026-11-25 at 01:34 UTC: a `text` and an `image`, each `field: messages`, user-agent `facebookexternalua`, with `X-Hub-Signature-256`. Both signatures verified against `META_APP_SECRET` over the raw body (inside n8n and again offline); HMAC over the re-serialised body failed for both. **Meta escapes non-ASCII text as `\u` sequences**, so its bodies are pure ASCII, and re-serialising changes the bytes. The probe replied in 30 and 52 ms as measured by ngrok. Raw bodies saved to `tests/captures/meta/` (git-ignored) as fixtures. |
| WhatsApp Trigger behaviour, Meta's webhook timeout | Left for the Meta setup step and `docs/meta-setup.md`, as the design plans. Activating the WhatsApp Trigger re-registers the app's single callback URL, which would take it away from `/webhook/s2-meta`. The timeout is not measured: holding Meta's requests open on purpose risks Meta disabling the webhook. Ingress replies in well under a second, so the limit doesn't bind. |

**Meta setup found along the way**

*   Webhook delivery needs two subscriptions. The app-level callback URL and fields (`messages` among them) were set, but no message arrived until the WhatsApp account itself was subscribed to the app (`whatsapp_biz_subscribe_webhook`, 2026-11-24 00:53 UTC). WhatsApp Manager and the app dashboard don't make the second step obvious, so `docs/meta-setup.md` must list it.
*   The app is in development mode (not published). Meta warns this may stop real webhooks, but deliveries from the test account arrived without publishing.

**Branch chosen:** the signature check stays (no fallback). `ingress-whatsapp` uses Webhook v2.2 with **Raw Body** on, reads `binary.data.data` (inline base64) in a Code node, and checks HMAC-SHA256 over those bytes with `crypto`. `sig_meta` stays in the guard list, so M stays 32 unless spike 4 rules out `sig_slack`. The handshake must reply through **Respond to Webhook** with the challenge as plain text.

## S3: Ordering and data tables

**Question:** With `N8N_CONCURRENCY_PRODUCTION_LIMIT=1`, does a Webhook set to respond immediately answer while an earlier execution is still running? Do sub-workflow executions count toward the limit? Do queued executions survive a restart? How do data tables behave on a duplicate value and on a `slack_thread_ts` filter, and which API can `setup_tables.py` use?

**Status:** Done, 2026-11-24

**What was tried**

*   **Instance:** the live instance on the Author's machine, n8n 2.49.5 in Docker with `N8N_CONCURRENCY_PRODUCTION_LIMIT=1` (`deploy/docker-compose.live.yml`).
*   **Probe:** `scratch/spikes/s3_probe.py` (not in git). It creates its workflows and table through the public API, sends the requests, reads the executions and deletes everything afterwards. The slow workflow waited 8 seconds rather than the design's 20; the result is the same, because the reply is held for the whole of the earlier run.

**Result**

| Part | Test | Result |
| --- | --- | --- |
| A1 | Three requests, 0.5 s apart, to Webhook (respond immediately) → Wait 8 s. Each reply under 3 s? | **Fail.** Replies took 2.1 s, 9.6 s and 17.2 s. A queued request gets no reply until its execution starts, so "respond immediately" doesn't help while another run holds the slot. |
| A2 | Did the executions run one at a time? | Pass. Each started within 15 ms of the previous one stopping. |
| B1 | Parent (Webhook → Execute Workflow, wait for finish) → child (Wait 4 s). Deadlock on the single slot? | Pass, no deadlock. The child ran in mode `integrated`, inside the parent's slot. |
| B2 | Did a slow request sent 0.3 s after the parent wait for parent and child to finish? | Pass. It started 11 ms after the parent stopped. |
| C | Three slow requests 0.3 s apart, container restarted 2 s after the first. Did the queued ones run after the restart? | **Fail.** Two of the three executions were marked `crashed` on start-up ("Last session crashed", "Marked executions as `crashed`"), and only one ran to success after the restart. One client saw its connection closed with no reply. n8n doesn't keep a queued execution across a restart. |
| D1 | Data-table ID found by name through the public API (`GET /data-tables?filter={"name":…}`)? | Pass. `POST /data-tables` creates a table with typed columns, so `setup_tables.py` can use the public API. |
| D2 | Insert the same `external_id` twice | Both inserts accepted. Data tables have no unique constraint. |
| D3 | Filter rows on `slack_thread_ts = "1732481234.123456"` | Pass. An exact string match that returned both rows, with the value unchanged (no conversion to a number). |

**Branch chosen:** branch B, the scheduled processor with a lease (design section 5). A1 and C each meet the design's condition for branch B on their own.

*   Branch B runs without a concurrency limit, so `N8N_CONCURRENCY_PRODUCTION_LIMIT: "1"` comes out of `deploy/docker-compose.live.yml` before ingress work starts.
*   D2 fits branch B: ingress doesn't check for duplicates, and the processor marks a repeated `external_id` as `duplicate`.
*   B1 and B2 still matter: a handler called with Execute Workflow runs inside its caller's execution.

## S7: Deployment

**Question:** Does `n8n import:workflow --separate` keep workflow IDs? Can credential IDs be read by name from `n8n export:credentials`? Can data-table IDs be listed by name through the API?

**Status:** Done, 2026-11-24

**What was tried**

*   **Instance:** the live instance, n8n CLI 2.49.5, run inside the container with `docker exec`.
*   **Probe:** `scratch/spikes/s7_probe.py` (not in git). It creates a child workflow (published) and a parent that calls it with Execute Workflow, a throwaway `httpHeaderAuth` credential and a data table, then deletes them all.

**Result**

| Test | Result |
| --- | --- |
| `export:workflow --all --separate` | Writes one file per workflow, named `<id>.json`. `--all` exports every workflow on the instance, including ones that aren't part of the project. |
| Import over the existing workflows (renamed) | Pass. The IDs were kept and no duplicates were created. |
| Delete both, then import fresh | Pass. Both came back with their original IDs, and the parent's Execute Workflow node still pointed at the child's ID. |
| Published state after import | **Not kept.** The import prints `Deactivating workflow …` and leaves every imported workflow unpublished, including one that was published before export. |
| Credential ID by name from `export:credentials --all` | Pass. Each entry has `id`, `name` and `type`, and `data` stays an encrypted string. |
| Data-table ID by name through the public API | Pass (same call as S3 D1). |

**Branch chosen:** no fallback needed, because the IDs are kept. The design's second pass, which rewrites Execute Workflow references, isn't needed.

*   `scripts/deploy_workflows.py` must publish each workflow that should be live after import, through `POST /workflows/{id}/activate` in the public API, since import unpublishes everything.
*   `scripts/export_workflows.py` must keep only the project's workflows, because `--all` also exports any others on the instance.
