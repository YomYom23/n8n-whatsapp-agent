# n8n WhatsApp Agent with Lead Bot's Safety Design

*   **Author:** Yomi O Lebi
*   **Status:** Draft, revised after review
*   **Date:** 2026-11-24

--------------------------------------------------------------------------------

## Overview

This project is a WhatsApp agent for a fictional US cleaning company, built as a set of n8n workflows on a self-hosted n8n instance. A customer messages the company's WhatsApp number. The agent answers questions from a Google Sheet of facts that the owner edits, offers and books cleaning appointments on Google Calendar, and hands the conversation to the owner in Slack when it can't continue safely. The owner can reply to the customer from that Slack thread, and the reply is sent through the business's WhatsApp number. A "Return to bot" button gives the conversation back to the agent. Enquiries and bookings are copied to HubSpot as a two-step deal.

The safety design is rebuilt from Yomi's earlier project, Lead Bot (a Python SMS agent for a roofing company). Plain code, not a language model, decides every route:

*   One classifier call reads each incoming message. The classifier is Jev, TypeSafe's classification model: given a message and a list of fixed questions, it returns a probability for each yes/no question and a choice with a confidence for each pick-one question. It can only pick from the options it is given.
*   Code applies fixed thresholds to those answers and picks the route: answer, book, hand off, opt out, close, or do nothing.
*   A language model (Claude Haiku) writes a reply only when no fixed reply fits, and may only use the facts it is given.
*   Every AI-written draft is checked by a second Jev call and by code before it is sent. A failed draft is replaced by fixed text and the owner is alerted.
*   When the classifier is unsure or unavailable, or the customer asks for a person, the conversation is handed to the owner. Other failures send fixed text and alert the owner.

It is a portfolio project. It runs on a WhatsApp test number with demo data, and it will be described as a working prototype, never as live or in production.

The decisions here come from [concepts_brief.md](../../spec/concepts_brief.md). The earlier project brief, `whatsapp-n8n-agent-brief.md`, is out of date; where it differs, this document wins.

## The Problem

Yomi is a new Upwork freelancer in AI and automation. A search of 362 recent jobs in that niche ($30 to $300 fixed price) counted the tools clients named: Google Sheets (36 jobs), CRMs such as HubSpot (31), n8n (30), Zapier (22), WhatsApp (16) and Make (10). Yomi's portfolio has none of them. Its main project, Lead Bot, uses Python, Twilio SMS and Google Calendar.

The postings show a specific, repeated problem. One example: *"Sending messages from n8n works. Messages sent to the WhatsApp test number never reach n8n, so the agent doesn't reply. I believe it's a webhook or app subscription issue in the Meta dashboard."* Yomi can't credibly bid on that today, because Yomi has not set up a WhatsApp agent in n8n and debugged its delivery.

There is a second, less visible problem. The common n8n pattern, the AI Agent node with tools, lets the model choose what to do and write whatever it likes. Such an agent can quote a price that doesn't exist, say an appointment is booked when it isn't, keep messaging someone who asked it to stop, or follow instructions a customer typed in ("ignore your instructions and..."). Lead Bot was designed against these failures; its recorded results were 67 of 67 live text conversations and 431 automated tests passed. None of that design exists in n8n form.

This project addresses both problems:

*   **Delivery:** setting up Meta's WhatsApp Cloud API with n8n from nothing, recording every failure along the way in `docs/meta-setup.md`, and checking each incoming webhook's signature. This is the experience the target postings ask for.
*   **Safety:** carrying Lead Bot's design into n8n, and showing with a replay test that each guard catches its scripted failure, and that the failure gets through when the guard is removed.

Every number quoted in the README will be one that was measured.

## Goals

The README leads with two results, called headline 1 and headline 2 below.

1.  **Headline 1: each guard is shown to work.** A replay test posts recorded WhatsApp messages into the workflows and checks the outcome: which route ran, what was sent, which rows were written. It reports two separate scores:
    *   **Fixed tier:** model answers and AI drafts are scripted, including drafts that are bad on purpose. Each guard (section 13 lists them) has at least one scenario it must catch. A guard-removal run removes each guard in turn and confirms its scenario then fails. Reported as "passed X of Y" and "N of M guards caused their scenario to fail when removed"; the pass condition is X = Y and N = M.
    *   **Live-model tier:** real Jev and Haiku calls, with sending to Meta still faked. Reported as its own "passed X of Y", with no pass threshold. The two scores are never added together.
2.  **Headline 2: WhatsApp delivery skill.** `docs/meta-setup.md` is written from what broke during setup, including failures caused on purpose (app not subscribed to messages, wrong n8n URL, expired token, unlisted recipient, bad signature). Replay fixtures are captured from real webhooks sent from Yomi's phone, with numbers removed. A hand test on the test number is reported as its own count, with reply times.
3.  **Lead Bot's safety rules, carried over and labelled.** The README has a table of what was carried over from Lead Bot unchanged, what was changed for WhatsApp or a cleaning company, and what is new.
4.  **Correct answers from the owner's facts.** Questions are answered from the Google Sheet. Prices come only from the sheet, checked against the right service. Simple totals (hours × hourly rate) are calculated by code, never by the model.
5.  **Bookings only into real free time.** Code generates the appointment times from Calendar free time. The customer can only pick a time that was offered, and the time is checked again just before booking. A returning customer can book again.
6.  **The owner can take over and give back control from Slack alone.** A handoff opens a Slack thread. The customer's messages appear in it. The owner's replies in it go to the customer through the business number. After the 24-hour window, the owner sends one approved template from the thread, and the owner's waiting messages go out automatically when the customer replies. "Return to bot" hands back, keeping the stage, service and address.
7.  **Opt-out keywords and phrases are honoured without a model call.** The keywords (section 6) and the listed opt-out phrases add the number to do-not-contact, including during a handoff. Other opt-out wording is caught by the classifier's `opt_out` question. Nothing, not even an owner's reply, is sent to a number on the do-not-contact list, except the one opt-out confirmation. START or UNSTOP takes a number off the list.
8.  **Enquiries and bookings reach HubSpot without affecting replies.** A contact and a deal at "Enquiry" are created when a customer picks a service, asks to book, or is offered times. The deal moves to "Booked" when the appointment is created. HubSpot runs outside the reply path, so a HubSpot failure never changes or delays a reply. The enquiry-to-booking rate from the hand test is a measured number.
9.  **Every message is traceable.** Every incoming and outgoing message is logged with its route, the classifier's answers and any guard problems, in n8n data tables and a Google Sheet. An error workflow alerts the owner when any run fails.
10. **Cost is measured.** The AI cost per conversation is calculated from token counts in the live runs.

## Non-Goals

*   **Production use.** No real customers, no claims of live or production use. One fictional business and one real phone number (Yomi's).
*   **Changing Lead Bot.** Lead Bot's code is read for its design and not modified, so its measured results stay valid.
*   **Letting the model decide actions.** The model never books, hands off or opts anyone out. It has no tools.
*   **Checking the owner's own messages.** Text the owner writes in Slack is sent as written. It is not passed through the AI draft check, but it does go through the do-not-contact and 24-hour checks.
*   **Roofing-specific rules.** Lead Bot's roofing stages and its insurance and "never state a price" checks are not ported. The cleaning company gets its own stages and checks.
*   **High message volume.** Events are handled one at a time. The measured throughput is stated as a limit. Postgres and scaling work are out of scope. If spike 3 forces the fallback processor, it uses one lease row in a data table, not a database lock.
*   **Expiring a handoff automatically.** A conversation stays with the owner until they press "Return to bot".
*   **HubSpot or the Sheets log in the reply path.** Neither can block, delay or change a reply.
*   **n8n Cloud, for now.** Running on n8n Cloud is not planned until the self-hosted version is finished (Future Improvements).
*   **Calculated prices beyond simple totals.** Mixed services, discounts, tax and quotes are not calculated. Drafts that state them are blocked and the fixed fallback line is sent.

## Open Questions and Spikes

Each question about unverified platform behaviour is a numbered spike, run before the work that depends on it. Results go in `docs/spikes.md`, and the chosen branch is copied into this document before dependent work starts.

| Spike | Question | Work that waits on it | If it fails |
| --- | --- | --- | --- |
| S0 | Will Meta approve the custom Utility template on the test-number account, and how long does it take? Registered on day 1. | Step P6 (24-hour path) | Use Meta's pre-approved `hello_world` template on the test number, and say so in the README. |
| 1 | Which Jev node? It must accept options set per message, return a probability or confidence for every field in one call, fail on a missing field, take a second fixed question set (draft check), handle the `price_service` and `price_hours` fields, and allow its base URL to be changed. | `classify`, `lib/questions.js`, `lib/rules.js`, price totals | No node passes: an HTTP Request node inside `classify`. Price fields unreliable: drop them; price questions get the price rows without a calculated total. No settable base URL: the dry-run instance uses a fake `classify` (section 13). |
| 2 | Meta ingress: the GET handshake; whether the Webhook node exposes the raw body; HMAC with emoji and non-ASCII text; `crypto` in Code nodes; the WhatsApp Trigger's behaviour; Meta's webhook timeout. | `ingress-whatsapp`, `lib/signatures.js` | No raw body: the signature check is recorded as not possible on this setup, and the "bad signature" items in Goal 2 and the guard list are dropped. |
| 3 | Ordering: with `N8N_CONCURRENCY_PRODUCTION_LIMIT=1`, does a Webhook set to respond immediately answer while an earlier execution is still running? Do sub-workflow executions count toward the limit? Do queued executions survive a restart? Data tables: behaviour on a duplicate value, filtering by `slack_thread_ts`, the API `setup_tables.py` uses. | Section 5, every ingress workflow | Webhook replies are held back: use the scheduled processor with a lease (section 5, branch B). |
| 4 | Slack: URL verification; signing of JSON events and form-encoded button clicks over the raw body; retry headers; the fields that identify bot-authored posts and message subtypes; user IDs on clicks; whether one workflow can hold two Webhook triggers. | `ingress-slack-events`, `ingress-slack-interactivity` | Two triggers per workflow not allowed: one workflow per trigger (already the plan). |
| 5 | Meta 24-hour window: does an out-of-window send fail at once (which error code) or later as a `failed` status event? | Section 10 backstop | None needed: the code check against `last_customer_at` is the primary rule; the result is recorded. |
| 6 | HubSpot: search lag after create, phone search, custom pipeline stages on the free plan, private-app scopes. | `crm-sync`, `hubspot-adapter` | No custom stages: map Enquiry and Booked onto two default deal stages, named in the env file. |
| 7 | Deployment: does `n8n import:workflow --separate` keep workflow IDs; can credential IDs be read by name from `n8n export:credentials`; can data-table IDs be listed by name through the API? | `scripts/deploy_workflows.py`, `scripts/export_workflows.py` | IDs not kept: deploy runs a second pass that rewrites Execute Workflow references from a name-to-ID map read after import. **Result:** IDs are kept, but import unpublishes every workflow, so deploy publishes them again afterwards (`docs/spikes.md`). |

## Critical User Journeys (CUJs)

### CUJ 1: A customer asks a question the facts sheet answers

*   **Given**: the facts sheet lists opening hours, and the customer's number is not on the do-not-contact list or with the owner.
*   **When**: the customer sends "are you open on Saturdays?".
*   **Then**: the customer gets an answer that uses only the sheet's hours. If Haiku wrote it, it passed the draft check. One row is logged for the incoming message and one for the reply, each with route `answer`, and the reply time is logged.

### CUJ 2: A customer books a deep clean

*   **Given**: the deep clean is in the sheet with a price and a duration, the customer's ZIP code is in the sheet's service areas, and the calendar has free time this week.
*   **When**: the customer says they want a deep clean, sends their address with ZIP code, and replies "2" to the offered times.
*   **Then**: a HubSpot contact and an "Enquiry" deal exist after the first message. The ZIP code is checked before any times are offered. Only times the code generated from free calendar time are offered, one per day on three different days. Slot 2 is checked again and booked as a calendar event with the address in it. The customer is told the booked time, and the deal moves to "Booked".

### CUJ 3: The owner takes over, replies from Slack and hands back

*   **Given**: a customer asks to speak to a person while times are on offer.
*   **When**: the bot hands off. The customer sends two more messages, the owner answers in the Slack thread, then presses "Return to bot". The customer then sends "2".
*   **Then**: the customer is told a person will reply. A new Slack thread opens with the handoff reason and the conversation so far. Both customer messages appear in the thread. The owner's reply reaches the customer's WhatsApp, and a reaction in Slack confirms it was sent. Release clears the offered times, so the "2" is not taken as a pick: the bot replies with three fresh times.

### CUJ 4: A customer sends STOP during a handoff

*   **Given**: a conversation is with the owner.
*   **When**: the customer sends "STOP", and later the owner replies in the thread.
*   **Then**: the number goes on the do-not-contact list, the customer gets one confirmation, and the thread is told. The owner's later reply is not sent, and the thread says why. If the customer later sends "START", they are taken off the list.

### CUJ 5: The owner replies after the 24-hour window

*   **Given**: a conversation is with the owner, and the customer's last message was 30 hours ago.
*   **When**: the owner replies in the thread, presses "Send template", and later the customer replies.
*   **Then**: the workflow sees from its own clock that the window has closed and does not try a free-form send. It keeps the owner's message as waiting and tells the owner in the thread, with "Send template" and "Discard waiting messages" buttons. "Return to bot" is refused while messages are waiting. On "Send template", the approved template goes out. When the customer replies, their reply appears in the thread, and the waiting owner message is sent automatically after the gate's checks.

### CUJ 6: An AI draft fails the check

*   **Given**: a customer asks something Haiku has to answer.
*   **When**: Haiku's draft states "a deep clean is $95" and the sheet says $120. In the fixed tier this draft is planted on purpose.
*   **Then**: the code price check flags `price_mismatch`. The draft is not sent; a fixed fallback line is sent instead, and the owner gets a Slack alert naming the problem. The log row records the draft and the problem.

### CUJ 7: Messages stop reaching n8n (delivery debugging)

*   **Given**: the Meta app's `messages` webhook subscription has been removed on purpose.
*   **When**: Yomi messages the test number.
*   **Then**: no execution of `ingress-whatsapp` appears. `docs/meta-setup.md` has an entry with the symptom, how it was found and the fix.

### CUJ 8: A wrong number is closed and reopened

*   **Given**: someone messages the business by mistake.
*   **When**: they write "sorry, wrong number, I was looking for my dentist", then send another message an hour later. The owner presses "Reopen".
*   **Then**: they get one apology, the conversation moves to `closed`, and the owner gets a Slack alert with a "Reopen" button. The later message gets no reply and is posted under that alert. After "Reopen", the bot answers their next message from the stage it was in before closing.

## Technical Plan (Architecture)

Spike numbers refer to the table in Open Questions and Spikes. Where a spike can change the design, both branches are given.

### 1. Runtime layout

Two n8n instances run in Docker from the same workflow files:

*   **Live instance.** Only `/webhook/*` is reachable from the internet, through Caddy with HTTPS, following Lead Bot's deployment approach (Caddy in front of the app in Docker Compose). The editor is reached through an SSH tunnel at `http://localhost:5678`, so it is never public. Talks to the real Meta test number, Jev, Anthropic, Google, Slack and HubSpot. A tunnel service can replace Caddy during development.
*   **Dry-run instance.** Runs on Yomi's machine with no public URL. It gets the same workflows, changed at deploy time by `scripts/deploy_workflows.py` (section 13): fake adapters, outside calls pointed at the mock server, a scripted clock, and any guards removed for the guard-removal run. The live workflow files in git contain no test switches.

A **mock server** (`tests/mock_server.py`) runs next to the dry-run instance. It stands in for Meta's send API, Jev, Anthropic and the four fake adapters, records every call, and answers from the current scenario's script.

State lives in **n8n data tables** in each instance (section 14). Facts live in a **Google Sheet** (section 16); the dry-run instance reads frozen copies from `tests/facts/`.

### 2. Who builds what, and how code reaches the workflows

The author builds and connects every workflow in the n8n editor. A coding agent ("Agent" in the build plan) writes everything in the repo: the logic modules in `lib/`, their unit tests, the Code-node call blocks, the scripts, the mock server, the replay harness, and `docs/build-guide.md`, which gives the author each workflow's nodes and contracts before it is built.

Logic shared by several nodes, or with many edge cases (gate keywords, rules, prices, ZIP codes, slots, signatures, send rules), lives in `lib/*.js` as CommonJS modules with `module.exports`, unit-tested with `node --test`. A Code node that uses one starts with a marker and a generated region, then a short call block:

```
// @lib price
...generated: lib/price.js and the lib modules it requires...
// @end-lib
const item = $input.first().json;
return [{ json: { problems: checkDraftPrices(item.draft, item.prices, item.total) } }];
```

These Code nodes run in "Run Once for All Items" mode. `scripts/build_code_nodes.js` fills each generated region from `lib/`, wrapping each module in its own function scope so names can't clash, and exposing the named exports to the call block. `npm run check` fails if a generated region in `workflows/` differs from `lib/`, which catches a fix made in the editor and not copied back. The call block is free to edit in the editor. The deployment allows no external npm modules in Code nodes, only the built-in `crypto`, so each generated region is self-contained.

### 3. Workflows

The diagram shows the customer-message path only, simplified; the table lists every workflow.

```mermaid
flowchart LR
  subgraph Outside
    WA[WhatsApp customer] --> Meta[Meta Cloud API]
    Owner[Owner in Slack] --> Slack[Slack]
  end
  Meta -->|webhook| IW[ingress-whatsapp]
  Slack -->|events| IS[ingress-slack-events]
  Slack -->|button clicks| II[ingress-slack-interactivity]
  IW --> D[(inbox: duplicate check)]
  IS --> D
  II --> D
  D --> CV[conversation]
  CV --> G[gate] --> C[classify] --> R{route}
  R --> A[answer]
  R --> B[book]
  R --> H[handoff]
  R --> O[opt-out / close / fixed replies]
  D --> OR[owner-relay]
  D --> REL[owner-release]
  A --> S[send]
  B --> S
  H --> S
  O --> S
  OR --> S
  REL --> S
  S --> Meta
  S --> L[log]
  L -.->|does not wait| CS[crm-sync] --> HubSpot
  L -.->|does not wait| SH[sheets-log]
```

| Workflow | Started by | Job |
| --- | --- | --- |
| `ingress-twilio` | Webhook (POST) | The Twilio route (P10): Twilio's signature check (`X-Twilio-Signature`, HMAC-SHA1 over the URL and sorted form fields); an incoming message becomes the same inbox event as Meta's; a `failed` or `undelivered` status callback becomes `send_failed`; other statuses are dropped |
| `ingress-whatsapp` | Webhook (GET and POST) | Meta's verify handshake; signature check; drop status events except `failed`; duplicate check; hand each message to its handler (section 5) |
| `ingress-slack-events` | Webhook | Slack's URL check; signature and timestamp check; keep owner messages in bot threads; duplicate check; hand to `owner-relay` |
| `ingress-slack-interactivity` | Webhook | Signature check on button clicks; duplicate check; hand to `owner-release` |
| `ingress-replay` | Webhook, imported only into the dry-run instance | Lets the replay harness put events in directly, with a shared secret |
| `processor` | Schedule, only in branch B of section 5 | Takes inbox rows one at a time under a lease |
| `conversation` | an ingress workflow (or `processor`) | Gate, classify, route, and the stage logic for one customer message |
| `classify` | `conversation`, `answer` | One Jev call for a named question set; returns the normalised result (section 7) |
| `answer` | `conversation` | Fixed replies, or Haiku writer plus draft check |
| `book` | `conversation` | Slot generation, offer, re-check and booking |
| `handoff` | `conversation` | Tells the customer, sets human-owned, opens a new Slack thread with buttons |
| `close` | `conversation` | Moves a conversation to `closed` and posts the owner alert with "Reopen" |
| `owner-relay` | `ingress-slack-events` | Checks and sends an owner's thread message to the customer |
| `owner-release` | `ingress-slack-interactivity` | Handles the buttons: Return to bot, Send template, Discard waiting messages, Mark as booked, Reopen |
| `send` | every path that messages a customer | The single place a WhatsApp message is sent from; applies the send rules (section 10) |
| `log` | `send`, `conversation` | Writes the data-table log row; starts `crm-sync` and `sheets-log` without waiting |
| `crm-sync` | `log` | Brings HubSpot up to the conversation's target state |
| `sheets-log` | `log` | Appends the message row to the Google Sheet log |
| `calendar-adapter`, `sheets-adapter`, `slack-adapter`, `hubspot-adapter` | the workflows above | One per outside service, with the contracts in section 13. The live version calls the API with an HTTP Request node and the n8n credential for that service (changed in P8 from the built-in nodes: the HTTP status and body map exactly onto the contract's error kinds, and Sheets values come back as strings, like the fake's CSV copy); the fake version calls the mock server |
| `doctor` | Manual only | Read-only Graph API checks of the Meta setup (built last; cut first) |
| `error` | n8n Error Trigger | Posts any failed run to Slack; if that post fails, sends an email directly through an SMTP node |

The Meta send and the Haiku call use HTTP Request nodes, not the built-in WhatsApp and Anthropic nodes: their full responses are needed (Meta's message ID and error codes, Anthropic's token usage), and their host can be rewritten for the dry-run instance. Jev uses the node chosen in spike 1.

### 4. Receiving events

**Meta (`ingress-whatsapp`).**

*   GET: answers Meta's verify handshake (`hub.mode=subscribe`, `hub.verify_token` must match the configured token, reply with `hub.challenge`).
*   POST: computes HMAC-SHA256 of the raw request body with the app secret and compares it to `X-Hub-Signature-256` (after its `sha256=` prefix) in constant time, comparing lengths first. A missing or wrong signature is dropped and logged. Spike 2 confirms raw-body access and `crypto`.
*   Status events (sent, delivered, read) are dropped before any write, except `failed`, which becomes an event of kind `send_failed` so a refused send is noticed.
*   Each message becomes one event in an internal format: source, external ID (Meta's message ID), customer ID (`wa_id`), Meta timestamp, kind (`text`, or `unsupported` for images, voice notes, reactions and others), text.

The WhatsApp Trigger node is not used in the live instance. It is set up once during the Meta setup and its behaviour is recorded in `docs/meta-setup.md`. Activating it re-registers the app's single callback URL, so it is deactivated before any other test.

**Slack (`ingress-slack-events`, `ingress-slack-interactivity`).**

*   Answer Slack's URL verification challenge.
*   Check `X-Slack-Signature` (HMAC-SHA256 of `v0:timestamp:raw body` with the signing secret, after the `v0=` prefix) and refuse timestamps older than 5 minutes. Button clicks arrive form-encoded; the signature is over the raw form body (spike 4).
*   Events: keep only new plain messages in a thread the bot opened. Drop edits, deletions, file shares, joins, and any message from a bot or app (exact field names: spike 4). The rest become events of kind `owner_message`, external ID = Slack's event ID, so Slack retries are dropped as duplicates.
*   Clicks become events of kind `owner_action`, with the action ID, the clicking user's Slack ID and the thread.

### 5. Ordering and duplicates

Events must be handled one at a time, in arrival order, so customer messages, owner messages and clicks for the same customer never read and write the same conversation at once. Lead Bot's single worker did the same. Spike 3 decides between two branches. **Spike 3 chose branch B** (2026-11-24, `docs/spikes.md`): a queued webhook gets no reply until its execution starts, and queued executions are lost on restart.

**Branch A (the default): n8n's own queue.**

*   The instance runs with `N8N_CONCURRENCY_PRODUCTION_LIMIT=1`, so n8n runs one production execution at a time and queues the rest in arrival order.
*   Each ingress workflow's Webhook responds immediately with 200, then checks the signature, then looks up the event's `external_id` in the `inbox` table. If it is there, the event is a duplicate and the run stops. Otherwise it writes the ID and calls the handler (`conversation`, `owner-relay`, `owner-release`, or the `send_failed` alert) with Execute Workflow, waiting for it to finish. Because runs are serial, the look-up-then-write can't race.
*   `crm-sync` and `sheets-log` are started without waiting, so they never hold up the next event.
*   Spike 3 must show that a queued webhook still gets its 200 within Slack's 3 seconds while an earlier run is busy, and that queued executions survive a restart. If either fails, branch B is used.

**Branch B (fallback): a scheduled processor with a lease.**

*   No concurrency limit. Ingress checks the signature, writes the event to `inbox` with status `received` and the payload, and replies 200. It does not check for duplicates.
*   `processor` runs every 5 seconds. It reads the `processor_lease` row; if it is empty or expired, it writes its own execution ID with an expiry 60 seconds ahead, reads the row back, and continues only if its ID is there. Otherwise it exits.
*   It then loops: take the oldest `received` row. If another row with the same `external_id` is `handling` or `done`, mark this one `duplicate`. Otherwise mark it `handling`, run the handler, and mark it `done` or `failed`. The lease expiry is pushed forward after each row, and the loop stops after 45 seconds so the next run can take over.
*   A row left in `handling` by an execution that no longer holds the lease is marked `failed` by the next run, and the owner is alerted. A `failed` row does not block later rows.
*   Reply time then includes up to one schedule interval, and this is stated in the results.

### 6. The gate (before any model call)

For a customer message, `conversation` runs these checks in this order. The first that applies ends the run:

1.  **Keyword.** The whole message, trimmed and case-insensitive, is STOP, STOPALL, UNSUBSCRIBE, QUIT, REVOKE or OPTOUT (opt out), or START or UNSTOP (opt back in). This is Lead Bot's carrier keyword set without CANCEL and END, so a customer cancelling a booking is not opted out. Opting out adds the number to do-not-contact, sends one confirmation, marks any waiting owner messages as blocked, and notes it in the owner's thread if there is one. START removes the number from do-not-contact and sends one line saying messages are back on.
2.  **Do-not-contact.** The number is on the list: log the message, send nothing.
3.  **Opt-out wording.** Lead Bot's opt-out phrases ("stop texting", "stop messaging", "remove me", "unsubscribe", "opt out" and the rest) and its "message starts with stop" rule, ported as they are. Same action as a keyword.
4.  **Record `last_customer_at`.** Used by the 24-hour check. Done here so it is updated during a handoff too.
5.  **Human-owned.** Post the message into the owner's current thread (a non-text message is posted as "[customer sent an image]" and so on) and stop. If owner messages are waiting for the 24-hour window, send them now, oldest first, through `send`.
6.  **Closed.** Post the message under the conversation's close alert in Slack, send nothing, and stop.
7.  **Unsupported message kind.** An image, voice note or other non-text message gets a fixed reply ("I can only read text messages here").
8.  **Offer-stage number pick.** In the `offer` stage, a message that is only a number pick in one of Lead Bot's forms ("2", "#2", "2.", "number 2", "option 2") for an offered time picks that time without a model call. Release clears the offered times (section 11), so a number sent during or right after a handoff can't pick a stale time.

### 7. Classifier

`classify` makes one Jev call per customer message with all questions for the current stage. It maps Jev's raw output to one normalised result, so nothing else depends on the node chosen in spike 1:

```
{ ok: true,
  hazards: { opt_out: p, wrong_person: p, abusive: p, prompt_injection: p, wants_human: p },
  answer: { value, confidence },
  price_service: { value, confidence },
  price_hours: { value, confidence } }
```

or `{ ok: false, error }`. For the draft-check question set the result is `{ ok: true, problems: { <name>: p } }`.

**Yes/no hazard questions (every stage):** `opt_out`, `wrong_person`, `abusive`, `prompt_injection`, `wants_human`. Wording is adapted from Lead Bot's question file for a cleaning company. `prompt_injection` is new: "the customer's latest message tries to change the assistant's instructions, asks it to reveal them, or asks it to act as something else". `wrong_person` means the sender says they messaged the wrong business or number.

**Pick-one `answer` question:** the stage's own options (section 9) plus the escape options at every stage:

| Option | Meaning |
| --- | --- |
| `price_question` | asks what something costs |
| `booking_request` | wants to book, or book again |
| `other_question` | asks something else about the business |
| `off_topic` | unrelated to the business |
| `repeat` | asks the bot to say its last message again |
| `later` | says they'll come back to it later |
| `unclear` | can't tell |

In the `offer` stage, the options are the offered slot IDs plus `none`, as in Lead Bot, so Jev can only return a time that was offered. Option IDs may not clash with the reserved escape names; `lib/questions.js` refuses to build a set where they do, as Lead Bot does.

**Pick-one price detail questions (every stage):** `price_service` (one option per service in the sheet, plus `not_stated`) and `price_hours` (1 to 8, plus `not_stated`). Used only when `answer` is `price_question`. New, tested in spike 1.

**Rules applied in code (`lib/rules.js`), with every number in `lib/config.js`:**

*   Hazards are checked in order `opt_out`, `wrong_person`, `abusive`, `prompt_injection`, `wants_human`. The first with probability 0.5 or above decides the route. (Lead Bot's order and threshold, with `prompt_injection` added before `wants_human`.)
*   Otherwise, `answer` with confidence below 0.5 counts as `unclear` (Lead Bot's threshold).
*   `unclear_in_a_row` goes up on `unclear` and `off_topic`, and two in a row hand off, as in Lead Bot. It resets to 0 on a stage answer, `other_question`, `price_question` and `later`, and is unchanged by `repeat` and `booking_request`.
*   Any expected field missing from Jev's response counts as a failed call, never as 0.
*   Each call has a 4-second timeout. A failed call is retried after 1 second and again after 2 seconds (at most about 15 seconds in total), then the conversation is handed off with reason `jev_unavailable`. Lead Bot waited a minute between retries; in a one-at-a-time design that would hold every other customer back, so this is a listed change.

Jev is given the customer's message and the **bot's** last message, never the owner's. When the owner has spoken since the bot last asked, Jev is told "the conversation was with a person; the bot last asked: ...".

### 8. Answers, the writer and the draft check

**Routes from the classifier result:**

| Result | Action |
| --- | --- |
| `opt_out` | Do-not-contact, one confirmation |
| `wrong_person` | Fixed apology, then close with reason `wrong_person` (section 11) |
| `abusive` | No reply, close with reason `abusive` |
| `prompt_injection` | Fixed reply ("I can help with questions about our cleaning and with bookings"), owner alerted; no writer call |
| `wants_human` | Handoff |
| Stage answer | Stage logic (section 9) |
| `booking_request` | In `booked`: start a new booking (section 9). Otherwise: move to the address stage, or straight to offer if the address is known |
| `price_question` | Writer, with prices and any calculated total as approved facts |
| `other_question` | Writer |
| `off_topic`, `repeat`, `later` | Fixed replies, as in Lead Bot (`repeat` resends the bot's last stage question) |
| `unclear` | Ask the stage question again; the second in a row hands off |

**Price facts.** The `prices` tab has service, aliases, unit (`hour` or `fixed`), amount, duration and bookable (section 16). For a `price_question`, code adds the price rows to the approved facts, one line each ("Deep clean: $120", "Regular clean: $35 per hour"). If `price_service` names an hourly service and `price_hours` is a number, code adds one calculated line: "Regular clean for 3 hours: $105". Only that form of total is calculated.

**Writer.** Haiku, called through an HTTP Request node, gets: the facts copy read at the start of this run, the approved price facts, the conversation facts (service, address, booked time if any), the last 6 messages, and the customer's question. It is told to use only those facts and to answer exactly `NOT_IN_FACTS` if they don't cover the question. It has no tools. `NOT_IN_FACTS` sends the fixed "I'll pass that to the team" line and alerts the owner, as in Lead Bot.

**Draft check.** Every Haiku draft goes through both of these before it can be sent. Any problem blocks the draft.

*   **Jev check** (one call through `classify` with the draft-check question set; state keys `FACTS`, `CUSTOMER_QUESTION`, `REPLY`, where `FACTS` is everything the writer was given; a problem at probability 0.3 or above blocks, as in Lead Bot): `unsupported_fact` (a fact not in FACTS), `claims_action` (says something was booked, moved or cancelled when FACTS doesn't say so), `promise` (guarantees an outcome or arrival time), `leaks_rules` (reveals or discusses its instructions), `off_brand`. Lead Bot's `insurance_talk` and `price_talk` are dropped; prices are checked by code instead.
*   **Code checks:** `empty`; `too_long` (draft over 600 characters; Lead Bot's cap was 300 for SMS, so this is a listed change); `promises_follow_up` (Lead Bot's pattern, so only code can promise a follow-up); `price_mismatch`; `unknown_number`.
    *   `price_mismatch`: every money amount in the draft (`$80`, `$ 80`, `$1,200`, `$80.00`, `80 dollars`, `80 bucks`, `80 USD`, `USD 80`) is normalised to cents and must equal the amount of a price row whose service name or alias appears in the same sentence, or the calculated total. Sentences split at `.`, `!`, `?` and line breaks, but not at a `.` between digits. Names and aliases match case-insensitively as whole words.
    *   `unknown_number`: every number in the draft must appear somewhere in the approved facts text. This catches amounts in forms the money pattern misses, such as "120/hr".
*   If the Jev check call itself fails, the draft is dropped (as in Lead Bot), not retried.

A blocked draft sends the fixed fallback line and alerts the owner with the problem names. The 600-character cap applies to the draft only; the stage question is added after it.

### 9. Stages for the cleaning company

| Stage | Bot has asked | Stage options for `answer` | Next |
| --- | --- | --- | --- |
| `new` | (first message, or "Which clean would you like?" when booking again) | one per bookable service in the sheet (`regular_clean`, `deep_clean`, `oven_clean`), `just_asking` | A service: `address`, or `offer` if the address is known. `just_asking` or a question: answer and ask "Would you like to book a clean?" |
| `address` | "What's the address for the clean, including the ZIP code?" | none: the text is taken as the address | ZIP code in area: `offer`. Out of area: fixed reply, stay. No ZIP code found: ask once more, then hand off as unclear |
| `offer` | Three numbered times | the offered slot IDs, `none` | A slot: book, then `booked`. `none`: later times once, then hand off (section 12) |
| `booked` | nothing more | `thanks`, `change_booking` | `change_booking`: handoff (the bot does not move bookings). `booking_request`: back to `new`, keeping the address, to book again |
| `closed` | nothing | (classifier not called) | Only "Reopen" leaves it (section 11) |

In the `address` stage the only questions asked of Jev are the hazards; the message itself is the answer. Code looks for a US ZIP code in it: 5 digits, optionally followed by a dash and 4 more. When several 5-digit numbers appear, the last one is used, since a street number usually comes first. A known limit: in "12345 Oak Ave" with no ZIP code, 12345 is taken as the ZIP code. The 5-digit part is checked against the sheet's service-area list. The full text is kept as the address and written into the calendar event. Stage values carry a version number; an unknown stage hands off.

### 10. Sending

`send` is the only place that sends a WhatsApp message. Every call gives `sender_kind` (`bot` or `owner`) and `kind`: `normal`, `opt_out_confirmation` or `template`. Before sending it reads the conversation again and applies:

| Rule | Bot `normal` | Owner `normal` | `opt_out_confirmation` | `template` (owner's button) |
| --- | --- | --- | --- | --- |
| Number on do-not-contact | Not sent | Not sent; thread told | Sent, only in the same run that added the number | Not sent; thread told |
| Conversation with the owner | Not sent | Required | Sent | Sent |
| Last customer message older than 24 hours | Not sent | Kept as waiting; thread told; buttons offered | (always within the window) | Sent: templates are allowed outside the window |
| Draft check and 600-character cap | AI-written text only | Not applied | Not applied | Not applied |

Order of operations where it matters:

*   **Handoff:** the notice to the customer ("Thanks, I'm passing this to a member of our team, who'll reply here") is sent before `human_owned` is set, so the human-owned rule doesn't block it.
*   **Opt-out:** the number is added to do-not-contact, then the confirmation is sent with `kind = opt_out_confirmation`.

The 24-hour rule is checked against `last_customer_at` with the run's clock. Meta's refusal and a later `failed` status are the backstop: both post to the thread or alert the owner (spike 5 records which happens). After a successful send, `send` calls `log`.

### 11. Handoff, relay, release and close

**Handoff.** Sends the notice, sets `human_owned`, records the reason, increases `handoff_episode`, and opens a new Slack thread for this episode. The first post gives the reason, the customer's number masked except the last 4 digits, the stage, any offered times and the last 6 messages, with buttons "Return to bot" and "Mark as booked". Handoff reasons: `wants_human`, `unclear`, `jev_unavailable`, `change_booking`, `slots_exhausted`, `booking_key_deleted`, `unknown_stage`, `zip_not_found`.

**Customer messages while with the owner** are posted into the current thread (gate step 5). Customer text posted to Slack is escaped (`&`, `<`, `>`), so it can't trigger `@channel` mentions or show disguised links.

**Owner relay.** `owner-relay` takes a thread message only if:

*   the thread is the current episode of a conversation that is with the owner (otherwise it replies in the thread "this conversation is back with the bot, not sent");
*   the Slack user is on `SLACK_ALLOWED_USERS` (others are ignored and logged);
*   the text does not start with `//` (a note for the team, never sent).

It turns Slack formatting into plain text (links, mentions, `&amp;`), calls `send` with `sender_kind = owner`, and adds the `white_check_mark` reaction to the Slack message on success. Outside the 24-hour window the message is stored as waiting instead, and the thread gets "Send template" and "Discard waiting messages" buttons.

**Buttons** (allowed users only; each click is logged with who clicked):

*   **Send template:** sends the approved template ("We have an update on your enquiry. Reply here to see it.") through `send`, once per set of waiting messages. When the customer replies, gate step 5 sends the waiting messages, oldest first, through `send` with the normal checks.
*   **Discard waiting messages:** marks them discarded and says so in the thread.
*   **Return to bot:** refused, with a note in the thread, while owner messages are waiting. Otherwise it clears `human_owned`, `unclear_in_a_row` and the offered times, and nothing else. The stage, service and address are kept. If the stage is `offer`, the bot's next reply offers fresh times. It posts "Bot resumes at: <stage>" in the thread and sends nothing to the customer; the bot answers their next message. A second click on a conversation already back with the bot does nothing. Not shown after opt-out.
*   **Mark as booked:** for a booking the owner made by hand. Moves the conversation to `booked`, clears the offered times, and starts `crm-sync` so the deal moves to Booked. It does not release the conversation.

**Close.** `wrong_person` (after one apology) and `abusive` (no reply) move the conversation to `closed`, storing `closed_reason` and the stage before closing. The owner gets a Slack alert with a "Reopen" button, and later customer messages are posted under it with no reply (gate step 6). **Reopen** (allowed users only) restores the stage before closing, clears the offered times and `unclear_in_a_row`, and sends nothing. Lead Bot put a wrong-person number on do-not-contact; here a closed conversation gets no messages unless the owner reopens it, which is a listed change.

### 12. Booking

`lib/slots.js` ports Lead Bot's slot logic. From the service's duration, the gap and minimum notice in `lib/config.js`, the `hours` tab, the busy periods from `calendar-adapter` and the current time, it offers the earliest free time on each of the next three days that have one, looking up to 14 days ahead. Slot IDs use Lead Bot's format (`slot-%Y%m%dT%H%MZ`, in UTC). Labels use AM/PM in the business's time zone. The booked length is the service's `duration_minutes`, including for the hourly regular clean.

**Later times.** On `none`, the bot offers once more: the earliest free time on each of the next three days after the last offered day (`reoffer_used`). A second `none` hands off with `slots_exhausted`.

**Booking key.** Each booking's Google event ID is fixed in advance: the SHA-256 hex digest of `booking:<wa_id>:<slot_id>`. That is valid as a Google event ID and differs per slot, so a returning customer can book again while a retried run can't book the same slot twice.

When a slot is picked, `book` runs Lead Bot's three checks in this order:

1.  **Already booked?** Get the event by its ID. If it exists and is not cancelled, the booking was already made (a retry): treat the conversation as booked. If it exists but is cancelled, Google won't reuse the ID, so hand off with `booking_key_deleted`, as Lead Bot does. This check comes first so the free/busy check doesn't see our own event as busy.
2.  **Still allowed?** Not in the past and not inside the minimum notice.
3.  **Still free?** No busy period overlaps it.

Then it creates the event with that ID, the service and the address. A conflict error on create means the event appeared since check 1, so check 1 runs again.

*   **Check 2 or 3 fails:** Lead Bot's "slot taken" path: fresh times once (`slot_taken_count`), and the second time hands off with `slots_exhausted`.

### 13. Replay test, dry-run deployment and guards

**Dry-run deployment.** `scripts/deploy_workflows.py --instance dryrun` builds a staging copy of `workflows/` and changes it before importing:

*   each live adapter is replaced by its fake from `workflows/fakes/`, under the same workflow ID;
*   `ingress-replay` is added;
*   the hosts of outside calls (`graph.facebook.com`, `api.anthropic.com`, `api.twilio.com`, and Jev's if the node allows it) are rewritten to the mock server; if the Jev node has no settable base URL, a fake `classify` that calls the mock is used instead;
*   every node named `clock:now` is replaced by an HTTP Request that gets the scenario's time from the mock server;
*   each `--remove-guard <id>` is applied (below).

`--instance live` refuses to import if the staging copy contains `ingress-replay`, a fake adapter or the mock server's host.

**Guards.** Each guard has an ID. A guard that is a node is named `guard:<id>`; removing it replaces it with a pass-through to its "pass" output. A guard that is one entry in a list (the hazards and draft-check problems) is removed from a generated `// @guards` list in its Code node. The guard IDs:

| Group | Guard IDs |
| --- | --- |
| Ingress | `sig_meta`, `sig_slack`, `sig_twilio`, `dedup` |
| Gate | `keyword_stop`, `dnc`, `optout_phrase`, `human_owned`, `closed` |
| Classifier | `hazard_opt_out`, `hazard_wrong_person`, `hazard_abusive`, `hazard_prompt_injection`, `hazard_wants_human`, `missing_field`, `offered_only` |
| Draft check | `dc_unsupported_fact`, `dc_claims_action`, `dc_promise`, `dc_leaks_rules`, `dc_off_brand`, `dc_empty`, `dc_too_long`, `dc_follow_up`, `dc_price`, `dc_unknown_number` |
| Send | `send_dnc`, `send_human_owned`, `send_24h` |
| Booking | `book_already`, `book_allowed`, `book_free`, `zip_area` |

M (the guard count in Goal 1) is the number of rows in this table's lists: 33 (32 until P10 added `sig_twilio`). If spike 2 rules out the signature checks, `sig_meta` and `sig_slack` are dropped and M is 31.

**Replay harness.** `tests/replay.py` runs against the dry-run instance. For each scenario in `tests/scenarios.toml`: delete all rows from the data tables, send the scenario to the mock server (`POST /_scenario`), send its events (validly signed, unsigned, or with a wrong signature) to the real ingress webhooks, or to `ingress-replay` for events whose signature doesn't matter to the scenario; wait until n8n reports no running or queued executions (and, in branch B, until the inbox has no `received` rows); then check the route, the sends (`GET /_calls`), the rows, the Slack posts, the HubSpot calls and the guard problems.

*   **Fixed tier:** Jev and Haiku answers come from the scenario. Planted bad drafts each trip exactly one guard.
*   **Live-model tier:** the mock server passes Jev and Anthropic calls through to the real services; everything else is still faked.
*   **Guard-removal run:** for each guard ID, redeploy the dry-run instance with that guard removed, run the scenarios tagged with it, and expect at least one to fail.

**Adapter contracts.** Every adapter takes `{ op, ... }` and returns `{ ok: true, ... }` or `{ ok: false, error: { kind, message } }`, where `kind` is `unavailable`, `not_found`, `conflict` or `invalid`.

| Adapter | Operation | Input | Output when `ok` |
| --- | --- | --- | --- |
| `calendar-adapter` | `busy` | `from`, `to` (ISO) | `busy: [{ start, end }]` |
| | `get_event` | `event_id` | `found`, `status`, `start`, `end` |
| | `create_event` | `event_id`, `start`, `end`, `summary`, `description`, `location` | `event_id` |
| `sheets-adapter` | `read_facts` | none | `facts`, `prices`, `service_areas`, `hours` (rows as in section 16), `version` |
| | `append_log` | `row` | none |
| `slack-adapter` | `post` | `channel`, `text`, optional `blocks`, optional `thread_ts` | `ts` |
| | `react` | `channel`, `ts`, `name` | none |
| | `update` | `channel`, `ts`, `text`, optional `blocks` | none |
| `hubspot-adapter` | `find_contact` | `phone` (E.164) | `contact_id` or null |
| | `create_contact` | `phone` | `contact_id` |
| | `create_deal` | `contact_id`, `stage`, `name` | `deal_id` (associated with the contact) |
| | `move_deal` | `deal_id`, `stage` | none |

`tests/adapter_contract.py`, run by hand before each live-tier run, sends the same inputs to each live adapter (against test accounts) and its fake, and fails if the output shapes differ.

### 14. Data tables

Types are n8n data-table types. "JSON" means a string column holding serialised JSON. Each table also has n8n's own row ID and timestamps.

| Table | Columns |
| --- | --- |
| `conversations` | `wa_id` (string), `stage` (string), `stage_version` (number), `stage_before_close` (string), `closed_reason` (string), `close_thread_ts` (string), `service` (string), `address` (string), `zip` (string), `offered_slots` (JSON: `[{ id, label }]`), `last_offered_day` (string, date), `reoffer_used` (boolean), `slot_taken_count` (number), `unclear_in_a_row` (number), `zip_asks` (number), `human_owned` (boolean), `handoff_reason` (string), `handoff_episode` (number), `slack_channel` (string), `slack_thread_ts` (string), `last_customer_at` (date), `last_bot_question` (string), `booked_event_id` (string), `booked_label` (string), `hubspot_contact_id` (string), `hubspot_deal_id` (string), `deal_stage` (string) |
| `inbox` | `external_id` (string), `source` (string), `kind` (string), `wa_id` (string), `slack_thread_ts` (string), `received_at` (date). Branch B adds `status` (string: `received`, `handling`, `done`, `failed`, `duplicate`), `execution_id` (string) and `payload` (JSON) |
| `processor_lease` | Branch B only. `name` (string), `holder` (string), `expires_at` (date) |
| `do_not_contact` | `wa_id` (string), `source` (string: `keyword`, `phrase`, `classifier`), `added_at` (date) |
| `pending_owner_messages` | `wa_id` (string), `handoff_episode` (number), `slack_thread_ts` (string), `slack_ts` (string), `slack_user` (string), `text` (string), `status` (string: `waiting`, `sent`, `discarded`, `blocked`), `template_sent_at` (date), `created_at` (date) |
| `message_log` | `logged_at` (date), `wa_id` (string), `direction` (string: `in`, `out`, `event`), `author` (string: `customer`, `bot`, `owner`, `system`), `kind` (string), `text` (string), `route` (string), `stage` (string), `classifier` (JSON), `draft` (string), `problems` (JSON), `facts_version` (string), `execution_id` (string), `workflow_version` (string), `input_tokens` (number), `output_tokens` (number), `reply_ms` (number) |

`message_log` rows with `direction = event` record CRM milestones (`crm_enquiry`, `crm_booked`) and button clicks, for the metrics script. Data tables are not exported with workflows, so `scripts/setup_tables.py` creates them through n8n's API (spike 3).

### 15. Side work: HubSpot and the Sheets log

`log` starts `crm-sync` without waiting when the conversation reaches an enquiry (a service picked in `new`, `booking_request`, or times offered) and when a booking is made or marked. `crm-sync` works out the target state from the conversation row (contact plus deal at Enquiry, or at Booked) and brings HubSpot up to it:

*   If `hubspot_contact_id` is empty, search HubSpot by phone (`+` followed by `wa_id`); create the contact if none is found; store the ID.
*   If `hubspot_deal_id` is empty, or the stored deal is already at Booked and this is a new enquiry, create a deal at the target stage, associated with the contact. Otherwise move the stored deal to the target stage. Store the ID.
*   No contact is created for numbers on do-not-contact or for closed conversations.
*   `crm-sync` writes only the `hubspot_*` and `deal_stage` columns, so it can't overwrite conversation state that `conversation` writes.
*   A failure goes to the `error` workflow. Every later enquiry or booking runs `crm-sync` again, which repairs any missed step.

`sheets-log` appends the message row to the Google Sheet log, with the phone number masked except the last 4 digits. Its failures go to the `error` workflow and never block a reply.

### 16. Facts sheet

Tabs and columns:

| Tab | Columns |
| --- | --- |
| `facts` | `topic`, `text` |
| `prices` | `service`, `aliases` (semicolon-separated), `unit` (`hour` or `fixed`), `amount` (dollars), `duration_minutes`, `bookable` (`yes`/`no`) |
| `service_areas` | `zip` (5 digits) |
| `hours` | `weekday` (`mon` to `sun`), `open` (`HH:MM`), `close` (`HH:MM`); a missing weekday is closed |

Times are in the business's time zone (`BUSINESS_TZ`). `conversation` reads the sheet once per run through `sheets-adapter` and passes that same copy to the writer and to the draft check. If the sheet can't be read or a required tab is empty, the customer gets a fixed line and the owner is alerted. Tests read `tests/facts/*.csv`.

### 17. Errors and alerts

The `error` workflow catches any failed run in any workflow and posts the workflow name, execution ID and error to Slack through `slack-adapter`. If that post fails, it sends an email through an SMTP node, which does not depend on Slack. The other alerts (handoffs, blocked drafts, `NOT_IN_FACTS`, `send_failed` events, prompt injection, closed conversations, unreadable facts sheet, stuck rows in branch B) also go through `slack-adapter`.

## Alternatives Considered

### Decision architecture

*   **The n8n AI Agent node with tools.** The model would choose when to book, hand off or stop, so first-match hazard order, fixed thresholds and opt-out without a model call can't be enforced, and guards can't be removed one at a time for the guard-removal run.
*   **Haiku as the classifier, returning JSON.** Its answers carry no probabilities to threshold, it can return an option that wasn't offered, and the classifier would share a model and its failure modes with the writer it checks.
*   **n8n's built-in Text Classifier node.** It picks categories but gives no probability per question, so the 0.5 and 0.3 thresholds and the missing-field rule can't be applied.

### Testing

*   **Replaying through a copy of the workflow that sends nothing.** The two copies would drift apart, and a copy can compete with the live one for Meta's callback URL. A dry-run instance runs the same files, changed only at deploy time (section 13).
*   **A test-mode switch in the request header or payload.** Anyone could send that header to the live instance.
*   **Guard switches and the clock read at run time from a settings module.** Every live workflow would carry the switch code and a role check, and live safety would depend on one environment value being set correctly. Applying dry-run differences at deploy time keeps the live files free of test logic.
*   **Every outside call as an HTTP Request node aimed at the mock server.** The workflows would use no built-in Sheets, Calendar, Slack or HubSpot nodes, which are what clients recognise and ask for, and every request, including Google's sign-in, would be hand-built. (The Meta send and Haiku call are HTTP Requests for the specific reasons in section 3.)
*   **Built-in nodes pointed at real test accounts during replay.** Tests would be slow, hit rate limits (Google Sheets allows about 60 reads a minute), need the accounts reset between scenarios, and give results that vary. Outages such as "HubSpot unavailable" can't be faked. Adapters with fakes and a contract test avoid this (section 13).
*   **One combined "passed X of Y" score.** Mixing planted fixed-tier results with live-model results would overstate how well the bot does.

### Classifier

*   **HTTP Request node as the default way to call Jev.** The reviewers recommended this (concepts brief, round 2). A Jev node shows clients a named step with n8n-managed credentials, where an HTTP Request shows a hand-built API call. HTTP Request stays as the fallback inside `classify` if no node passes spike 1, and `classify`'s normalised result keeps the rest of the design independent of the choice.
*   **Requiring a community Jev node with no fallback.** A node that fails spike 1 would block the build.
*   **Reading a missing classifier field as 0.0.** A missing field would quietly look like "no hazard". As in Lead Bot, a missing field is a failed call.
*   **An n8n Switch node that sends a message down every matching hazard output.** It breaks the first-match order. The rules run in one Code node instead.

### Conversation design

*   **Lead Bot's "never state a price" rule.** A cleaning company is expected to answer price questions. Two other price options were also rejected:
    *   *Prices only in a fixed reply, with any Haiku draft that mentions a price blocked.* A question like "how much for 3 hours?" would get the price list rather than a total.
    *   *Haiku may state prices, checked per service, with no totals.* Correct totals would be blocked.

    The chosen design checks each amount against the right service and lets code calculate simple totals (section 8).
*   **Three stages (new, offer, booked) with no address.** Every booking would need the owner to chase the address, and the demo would show an incomplete booking.
*   **Asking for the address after the time is booked.** Out-of-area customers could book, and the owner would have to cancel by hand.
*   **Porting Lead Bot's roofing stages and checks as they are.** The insurance and roofing rules don't apply to a cleaning company.
*   **Keeping CANCEL and END as opt-out keywords.** A customer sending "cancel" about a booking would be opted out, and the calendar event would stay. A bare "cancel" meant as an opt-out is still caught by the classifier's `opt_out` question.
*   **Treating opt-out keywords as valid only in capitals.** Phones capitalise the first letter, so "Stop" would be missed.
*   **One booking per customer, as in Lead Bot.** A roofing lead books one inspection; cleaning customers book again. The key per slot allows that (section 12).

### Owner handoff

*   **The owner contacts the customer from their own phone while the bot goes quiet.** The conversation would leave the business's WhatsApp number, and the demo would lose the relay.
*   **A `/resume` slash command, or editing the data table, as the main way to hand back.** Both need the owner to type a command or open n8n; a button is one click in the thread. Editing the table stays as a fallback.
*   **Resetting the conversation on hand-back.** The reviewers proposed this (concepts brief, round 1). Resetting would throw away the service and address the customer already gave. Clearing only the offered times avoids stale times without that cost.
*   **Keeping the offered times across release, with a counter to decide whether a bare number is a pick.** It keeps still-valid times, but needs stale-time handling, extra state and its own scenarios.
*   **Expiring a handoff automatically after a set time.** The bot could take back a conversation the owner is still handling.
*   **Cutting the 24-hour path.** The owner could not reach a customer who had gone quiet.
*   **One template that carries the owner's text in a variable.** Meta may refuse a template that is mostly a free-text variable, and variables can't contain line breaks. The generic template is more likely to be approved.
*   **Asking the owner to resend a message queued behind the template.** The waiting message goes out on its own when the customer replies, after the gate's checks.
*   **Discarding, or still sending, waiting messages when the owner presses "Return to bot".** Discarding could lose a reply the owner meant to send; sending after release would mix an owner message with the bot's answer. Release is refused until the messages are sent or discarded.
*   **Running the owner's text through the AI draft check.** The owner is the authority on their own business, and blocking their messages would make the relay unreliable.
*   **Handling wrong-number and abusive conversations as ordinary handoffs.** The author chose a separate `closed` state, so these don't mix with owner takeovers and need an explicit "Reopen".

### CRM, ordering and infrastructure

*   **Cutting HubSpot.** All seven reviewers suggested it (concepts brief, round 1). It was kept because CRMs were named in 31 of 362 job posts searched and the portfolio has no CRM work yet. It runs outside the reply path.
*   **Other definitions of a qualified lead.** "Booking confirmed" alone misses customers who drop off, and "asked to book" alone shows no pipeline. The two-step Enquiry → Booked deal shows both.
*   **A custom inbox processor as the default.** A status machine, lease and stuck-row handling are more code than n8n's own queue, which may be enough (spike 3). It is kept as branch B.
*   **Queue tables for HubSpot and Sheets work.** Starting `crm-sync` and `sheets-log` without waiting keeps them out of the reply path with no extra tables; each later event repairs missed CRM steps.
*   **Postgres for duplicate checks and ordering.** A second service to run and back up for one test number. Branches A and B both work on data tables; if spike 3 shows neither does, this is revisited.
*   **Caching the facts sheet.** The sheet is read once per run, so the owner's edits take effect on the next message.
*   **Writing the logic straight into Code nodes, tested only by replay.** Edge cases in the price and ZIP rules would each need a full replay scenario, and shared helpers would be copied into every node by hand.
*   **Logic as an npm module loaded with `require` in the container.** A client reading the workflow would see a `require` line, not the logic, and the container would need the module mounted and allowed.

## Non-Functional Requirements

### Security and privacy

*   Every webhook checks its signature over the raw body before acting (section 4). `ingress-replay` exists only on the dry-run instance, and live deploys refuse it (section 13).
*   Secrets (Meta app secret and token, Slack signing secret and bot token, Anthropic key, Jev key, HubSpot private-app token, Google sign-in, SMTP password, `N8N_ENCRYPTION_KEY`) live in n8n credentials or the instance's env file, never in workflow JSON or git. `.gitignore` covers `deploy/*.env`. `npm run check` fails if a workflow file contains a secret pattern (file 20 in the Detailed Implementation Plan).
*   Customer phone numbers are masked except the last 4 digits in Slack, the Sheets log and the README. Full numbers stay only in the n8n data tables on the live server. Captured fixtures have numbers replaced, then are re-signed with the test secret.
*   Only Slack users on `SLACK_ALLOWED_USERS` can relay or use the buttons.
*   Customer text posted to Slack is escaped (section 11).
*   The live editor is reached only through an SSH tunnel.

### Performance

*   Ingress must answer within Slack's 3 seconds and Meta's webhook timeout (spike 2 records it). Spike 3 measures this with an earlier run held in a 20-second Wait.
*   Events are handled one at a time. The worst-case reply time for one message is about 15 seconds of Jev retries plus the Haiku call and the draft check (plus one schedule interval in branch B), multiplied by the number of events queued ahead of it. Throughput (messages per minute for scripted, off-script and booking turns) is measured during the hand test and stated in the README as a limit.
*   Each message reads four facts-sheet tabs, against Google's limit of about 60 reads a minute, which caps throughput at roughly 15 messages a minute. This is stated with the measured limit.
*   One Jev call per customer message, plus one Jev draft check and one Haiku call for off-script turns. Tokens per call are logged in `message_log`.

### Rollout and rollback

*   Workflows, `lib/` and scripts are in git. `scripts/deploy_workflows.py` imports a commit's workflow files into an instance. Rollback is deploying the previous commit.
*   The n8n image tag, Node version, Python version and any community Jev node are pinned to exact versions in `deploy/` and `package.json`, chosen when spike 1 runs and recorded in `docs/spikes.md`. Upgrades are deliberate: rerun the fixed tier first.
*   Data-table changes go through `scripts/setup_tables.py`, which adds missing columns and never drops one. Stage values carry a version, so a row from an older version hands off instead of being misread.

## Risks and Limits

| Risk or limit | Impact | Handling |
| --- | --- | --- |
| n8n's queue holds back webhook replies (spike 3) | Slack and Meta retry; duplicate work | Branch B processor (section 5) |
| Template not approved on the test number (S0) | CUJ 5 can't be shown with the custom template | `hello_world` fallback, stated in the README |
| No raw body in the Webhook node (spike 2) | Signature guards can't be shown | Recorded as a limit; M drops to 30 |
| Jev or Haiku unavailable | No classification or no draft | Retries then handoff (Jev); fixed fallback line (Haiku) |
| `NOT_IN_FACTS`, blocked drafts and failed runs only alert | The customer gets a fixed line; the owner can read the alert but can't reply in that alert | Accepted for the prototype; the owner can ask the customer to request a person |
| A bare "cancel" or "end" | Not an opt-out keyword | Caught by the classifier's `opt_out` question when it means opt-out |
| A 5-digit street number with no ZIP code | Wrong ZIP code taken | Known limit; replay scenario covers it |
| Prices written in words, or a dollar amount stated without "$" or "dollars" for the wrong service | Can pass the code checks | Jev's `unsupported_fact` check is the backstop; stated limit |
| HubSpot search lag after create (spike 6) | A duplicate contact if `crm-sync` fails between create and storing the ID | Accepted; stated in the README |
| HubSpot or Sheets outage | CRM or log row missed | Error alert; the next event repairs CRM |
| Facts sheet unreadable | No answers or bookings | Fixed line plus alert |
| Fake adapters drift from real ones | Tests pass while live breaks | Contract test before each live-tier run |
| A secret pasted into a workflow | Leaked in git | `npm run check` secret patterns |
| Prompt injection aimed at the classifier | A hazard is missed | The writer has no tools and its drafts are checked; stated limit |
| One sender floods messages | Other customers wait; model costs rise | No rate limit in the prototype; stated limit |
| No spending cap | Costs not bounded | Cost per conversation is measured; stated limit |
| Data tables grow without limit; instance size cap (about 50 MB by default) | Writes fail when full | Stated limit; `message_log` can be cleared between test runs |
| Full phone numbers kept in data tables | Personal data at rest | Only Yomi's own number in use; stated in privacy notes |

## Additional Resources

*   [concepts_brief.md](../../spec/concepts_brief.md): the brainstorm and review decisions this design follows.
*   Lead Bot (the author's private `lead-bot` repository): `src/lead_bot/conversation.py` (gate, opt-out phrases, stage flow, cap), `jev.py` (missing-field rule, retries), `text_questions.py` (question wording, reserved option IDs), `text_script.py` (keyword sets, number-pick forms), `slots.py` (slot generation and IDs), `booking.py` (event ID and booking checks), `guard.py` (draft-check problems), `deploy/` (Caddy and Docker Compose).

## Future Improvements

*   **n8n Cloud pass.** Record what changes on n8n Cloud: the Jev node install, env access in Code nodes, data tables, and moving Meta's single callback URL there and back. Notes only.
*   **More calculated prices.** Mixed services, add-ons and quotes, if hand tests show customers ask for them.
*   **Address parsing beyond the ZIP code.** Only if the street-number limit shows up in hand tests.
*   **Owner booking actions from Slack.** Move or cancel a booking with a button.
*   **Owner reply from failure alerts.** A "Take over" button on `NOT_IN_FACTS` and blocked-draft alerts.

--------------------------------------------------------------------------------

## Detailed Implementation Plan

**Who does what.** "Author" is Yomi, who builds and connects every workflow in the n8n editor. "Agent" is the coding agent, which writes everything in the repo (section 2 of the Technical Plan). The Agent writes each workflow's entry in `docs/build-guide.md` before the Author builds it.

**Working loop.**

1.  The Author builds or changes a workflow in the dry-run instance's editor.
2.  `scripts/export_workflows.py --instance dryrun` saves it to `workflows/` (adapters to `workflows/fakes/`).
3.  `npm run build` refreshes the generated regions; `npm run check` must pass.
4.  `scripts/deploy_workflows.py --instance dryrun` re-imports it.
5.  `python tests/replay.py --upto <step>` runs the scenarios enabled so far.

The live instance is deployed only from git, with `deploy_workflows.py --instance live`. Live adapters are edited in the live editor (through the tunnel) and exported with `export_workflows.py --instance live --only adapters`.

### Build order

Spikes come first; each records its result in `docs/spikes.md`, and the chosen branch is copied into this document before dependent work starts. The build then follows a cut line: each step ends with something that can be demonstrated, so if time runs short the later steps are cut. Every scenario in `tests/scenarios.toml` is tagged with the step that enables it.

| Step | What | Who | Files (numbers below) |
| --- | --- | --- | --- |
| S0 | Register the Utility template on the test number (runs in the background) | Author | — |
| S1–S7 | Spikes 1–7; the Agent writes probe scripts in a scratch folder, the Author runs them in n8n | Author + Agent | 33 (`docs/spikes.md`) |
| P1 | Delivery evidence: live instance, minimal `ingress-whatsapp` (handshake, signature, status filter, echo reply), Meta setup with failures caused on purpose, fixture capture, delivery hand test | Author + Agent | 1–6, 18 (`mask`, `signatures`), 19, 20, 21, 30, 33 (`meta-setup.md`) |
| P2 | Foundations: data tables, `lib/` core and unit tests, dry-run instance, mock server, replay skeleton | Agent; Author sets up dry-run | 7–19, 22, 27–29, 32 |
| P3 | Core conversation: `conversation`, gate, `classify`, `answer`, `send`, `log`, `sheets-adapter` (live and fake); echo reply removed. Fixed-tier scenarios for gate, hazards, answers and draft checks | Author builds; Agent writes code and scenarios | 24, 25, 26 |
| P4 | Booking: address stage, `book`, `calendar-adapter` (live and fake) | Author + Agent | 24, 25 |
| P5 | Handoff, close, relay within the window, Return to bot, Mark as booked, Reopen, `slack-adapter`, Slack ingress workflows | Author + Agent | 24, 25 |
| P6 | 24-hour path: waiting messages, Send template, Discard, release refusal | Author + Agent | 24 |
| P7 | `crm-sync`, `hubspot-adapter` (live and fake), `sheets-log` | Author + Agent | 24, 25 |
| P8 | Live-model tier, guard-removal run, adapter contract test, full hand test, metrics, README; also the live adapters and the `error` workflow, which no earlier step listed | Agent; Author runs hand tests | 23, 24, 31, 33 (`hand-test.md`), 34, 35 |
| P9 | `doctor`; also `scripts/run_doctor.py`, `tests/doctor_check.py`, the mock's Graph reads and the `META_WABA_ID` env value | Author + Agent | 24 |
| P10 | The Twilio route, a stand-in while Meta's business verification is pending: `ingress-twilio`, `send` switching on `WA_PROVIDER` (`meta` by default, or `twilio`), the mock's Twilio Messages API, `sig_twilio`, and `tests/replay.py --provider twilio`. Twilio's sandbox is a shared number that each tester joins with a code, and the session ends 3 days after joining | Agent | 24, 27, 28, 29 |

Until P1's captures exist, the Agent uses hand-written webhook bodies in Meta's documented format; they are replaced by redacted captures in P1.

### Target Files to Create/Modify

#### 1. `deploy/docker-compose.live.yml` (Create)

*   **Type / Scope**: Deployment. Step P1.
*   **Proposed Changes**: n8n (pinned image tag) and Caddy in one Compose project. n8n environment: `N8N_ENCRYPTION_KEY`, `WEBHOOK_URL`, `N8N_HOST`, `N8N_PROTOCOL=https`, `N8N_PROXY_HOPS=1`, `N8N_EDITOR_BASE_URL=http://localhost:5678`, `N8N_CONCURRENCY_PRODUCTION_LIMIT=1` (branch A), `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`, `NODE_FUNCTION_ALLOW_BUILTIN=crypto` (also on the task runner if it runs separately), `GENERIC_TIMEZONE=${BUSINESS_TZ}` so there is one time-zone setting. The editor port is bound to `127.0.0.1` only. Volume for n8n data. Reads `deploy/live.env`. If Lead Bot's `deploy/` runs Caddy as its own Compose project, follow that layout instead and note it.

#### 2. `deploy/docker-compose.dryrun.yml` (Create)

*   **Type / Scope**: Deployment, local only. Step P2.
*   **Proposed Changes**: n8n (same image) and the mock server on a private network; only the editor is published, on `127.0.0.1`. Same n8n settings as live, except `WEBHOOK_URL=http://localhost:5678/`. Reads `deploy/dryrun.env`.

#### 3. `deploy/Caddyfile` (Create)

*   **Type / Scope**: Reverse proxy. Step P1.
*   **Proposed Changes**: HTTPS for the public host. Routes only `/webhook/*` to n8n; every other path returns 404.

#### 4. `deploy/live.env.example`, `deploy/dryrun.env.example` (Create)

*   **Type / Scope**: Config templates. Step P1.
*   **Proposed Changes**: Every variable with a placeholder: `N8N_ENCRYPTION_KEY`, `WEBHOOK_URL`, `N8N_HOST`, `BUSINESS_TZ` (default `America/New_York`), `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_PHONE_NUMBER_ID`, `META_GRAPH_VERSION`, `META_TEMPLATE_NAME`, `META_TEMPLATE_LANG`, `SLACK_SIGNING_SECRET`, `SLACK_ALLOWED_USERS`, `SLACK_CHANNEL_ID`, `GOOGLE_CALENDAR_ID`, `FACTS_SHEET_ID`, `LOG_SHEET_ID`, `HUBSPOT_STAGE_ENQUIRY`, `HUBSPOT_STAGE_BOOKED`, `HUBSPOT_PIPELINE_ID`, `HAIKU_MODEL` (`claude-haiku-5-5`), `HAIKU_MAX_TOKENS` (400), `ALERT_EMAIL`; dry-run adds `REPLAY_SECRET` and `MOCK_URL`. Lists the n8n credentials to create, with scopes: Meta (header auth with the system-user access token, which does not expire), Anthropic (header auth), Jev, Slack bot (`chat:write`, `reactions:write`, `channels:history` or `groups:history`; event subscription `message.channels` or `message.groups`; interactivity URL), Google Calendar (`calendar.events`, `calendar.freebusy`), Google Sheets (`spreadsheets`), HubSpot private app (`crm.objects.contacts.read`, `crm.objects.contacts.write`, `crm.objects.deals.read`, `crm.objects.deals.write`), SMTP. The scripts' n8n API URL and key per instance are read from `deploy/scripts.env`.

#### 5. `.gitignore` (Create or modify)

*   **Type / Scope**: Repo config. Step P1.
*   **Proposed Changes**: `deploy/*.env`, `node_modules/`, `tests/captures/` (raw unredacted webhooks), `__pycache__/`, `.staging/` (deploy staging copies).

#### 6. `package.json` (Create)

*   **Type / Scope**: Node tooling. Step P1.
*   **Proposed Changes**: `engines.node` pinned to the Node LTS used by the chosen n8n image. Scripts: `test` (`node --test "lib/test/*.test.js"`), `build` and `check` (`node scripts/build_code_nodes.js` with and without `--check`). One dev dependency: `luxon`, pinned to the version bundled in the n8n image, so `lib/slots.js` tests use the same date library as the Code nodes.

#### 7. `lib/config.js` (Create)

*   **Type / Scope**: Logic module. Step P2.
*   **Proposed Changes**: Every number: hazard order; thresholds (hazard 0.5, answer confidence 0.5, draft check 0.3); unclear limit 2; ZIP asks 2; Jev timeout 4 s, retry waits 1 s and 2 s; draft cap 600; slots offered 3; slot gap 30 minutes; minimum notice 12 hours; days ahead 14; history messages 6; branch B schedule 5 s, lease 60 s, loop limit 45 s, stuck row 5 minutes.

#### 8. `lib/gate.js` (Create)

*   **Type / Scope**: Logic module. Step P2.
*   **Proposed Changes**: `keyword(text)` returns `'stop'`, `'start'` or `null` (whole message, trimmed, case-insensitive; sets in section 6). `isExplicitOptOut(text)` ports Lead Bot's `OPT_OUT_PHRASES` and `STARTS_WITH_STOP`. `numberPick(text, offeredCount)` returns a 1-based index or `null`, accepting Lead Bot's forms.

#### 9. `lib/rules.js` (Create)

*   **Type / Scope**: Logic module. Step P2.
*   **Proposed Changes**: `checkComplete(result, questionSet)` throws on a missing field. `route(result, stage, conversation)` returns `{ route, reason, unclearInARow }`: first hazard at or above threshold, then low-confidence `answer` as `unclear`, then the counter rules in section 7.

#### 10. `lib/questions.js` (Create)

*   **Type / Scope**: Logic module. Step P2.
*   **Proposed Changes**: Builds Jev question sets: hazards, the stage's `answer` options with the escape options, `price_service` from the sheet, `price_hours`, and the draft-check set. Throws if a stage option ID equals a reserved escape name. Builds the owner-spoke-last context line.

#### 11. `lib/stages.js` (Create)

*   **Type / Scope**: Logic module. Step P2.
*   **Proposed Changes**: The stage table from section 9 with `STAGE_VERSION`. `next(conversation, routeResult, facts)` returns `{ stage, reply, updates }`, where `reply` is one of `ask_service`, `ask_address`, `ask_address_again`, `out_of_area`, `offer_times`, `later_times`, `booked_confirmation`, `ask_book`, `writer`, `fixed:<name>`, `handoff:<reason>`, `close:<reason>`, `none`, and `updates` is the set of `conversations` columns to write. Unknown stage or version returns `handoff:unknown_stage`.

#### 12. `lib/price.js` (Create)

*   **Type / Scope**: Logic module. Step P2.
*   **Proposed Changes**: `priceFacts(prices, service, hours)` returns `{ lines: [string], totalCents: number | null }`, where `prices` rows are `{ service, aliases: [string], unit, amountCents, durationMinutes, bookable }`. `findAmounts(text)` returns `[cents]` for the forms in section 8. `splitSentences(text)`. `checkDraftPrices(draft, prices, totalCents)` returns `['price_mismatch']` or `[]`. `checkNumbers(draft, factsText)` returns `['unknown_number']` or `[]`.

#### 13. `lib/zip.js` (Create)

*   **Type / Scope**: Logic module. Step P2.
*   **Proposed Changes**: `findZip(text)` returns the 5-digit part of the last ZIP-shaped group, or `null`. `inArea(zip, serviceAreas)` returns a boolean.

#### 14. `lib/slots.js` (Create)

*   **Type / Scope**: Logic module, port of Lead Bot's slot logic. Step P2.
*   **Proposed Changes**: `earliestPerDay({ now, hours, busy, durationMinutes, gapMinutes, minNoticeHours, daysAhead, count, afterDay, tz, DateTime })` returns `[{ id, label, day }]`: the earliest free start on each of the first `count` days with one, after `afterDay` if given. `stillAllowed({ slotId, now, minNoticeHours })` returns a boolean. `DateTime` is passed in, so the node uses n8n's built-in Luxon and tests use the dev copy.

#### 15. `lib/booking.js` (Create)

*   **Type / Scope**: Logic module. Step P2.
*   **Proposed Changes**: `eventId(waId, slotId)` returns the SHA-256 hex digest of `booking:<waId>:<slotId>` (`crypto` passed in). `afterChecks({ existing, allowed, free })` returns `already_booked`, `key_deleted`, `taken` or `book`. `onTaken(conversation)` returns `{ reply: 'offer_times' | 'handoff:slots_exhausted', updates }`.

#### 16. `lib/send_rules.js` (Create)

*   **Type / Scope**: Logic module. Step P2.
*   **Proposed Changes**: `decide({ conversation, onDnc, addedThisRun, senderKind, kind, now })` returns `send`, `drop` (with reason) or `wait`, implementing the table in section 10. `within24h(lastCustomerAt, now)`.

#### 17. `lib/draft_checks.js`, `lib/crm.js`, `lib/release.js` (Create)

*   **Type / Scope**: Logic modules. Step P2.
*   **Proposed Changes**: `draft_checks.js`: `codeProblems(draft, prices, totalCents, factsText)` (`empty`, `too_long`, `promises_follow_up`, price and number checks) and `blocking(jevProblems, codeProblems, enabled)`, where `enabled` comes from the node's generated `// @guards` list. `crm.js`: `targetState(conversation, event)` returns `{ wantContact, dealAction: 'create' | 'move' | 'none', stage }`. `release.js`: `canRelease(pendingCount)`, `releaseUpdates(conversation)`, `resumeText(conversation)`, `reopenUpdates(conversation)`.

#### 18. `lib/texts.js`, `lib/writer_prompt.js`, `lib/slack_text.js`, `lib/mask.js`, `lib/signatures.js` (Create)

*   **Type / Scope**: Logic modules. Step P1 (`mask`, `signatures`), P2 (others).
*   **Proposed Changes**: `texts.js`: every fixed customer line (stage questions, opt-out confirmation, START reply, handoff notice, unsupported kind, out of area, prompt injection, off-topic, repeat, later, `NOT_IN_FACTS` line, blocked-draft fallback, wrong-person apology, facts unavailable). `writer_prompt.js`: builds the Haiku request body from the inputs in section 8. `slack_text.js`: `toPlain(text)`, `escapeForSlack(text)`, `isTeamNote(text)`, `handoffPost(...)`, `closeAlertPost(...)`. `mask.js`: `maskNumber(waId)`. `signatures.js`: `verifyMeta(rawBody, header, secret, crypto)` and `verifySlack(rawBody, timestamp, header, secret, now, crypto)`, stripping the prefixes and comparing lengths before `timingSafeEqual`.

#### 19. `lib/test/` (Create)

*   **Type / Scope**: Unit tests. Steps P1–P2.
*   **Proposed Changes**: One file per module: `config.test.js`, `gate.test.js`, `rules.test.js`, `questions.test.js`, `stages.test.js`, `price.test.js`, `zip.test.js`, `slots.test.js`, `booking.test.js`, `send_rules.test.js`, `draft_checks.test.js`, `crm.test.js`, `release.test.js`, `texts.test.js`, `slack_text.test.js`, `mask.test.js`, `signatures.test.js`. Required cases with expected results:
    *   `keyword`: "STOP", "Stop", " stop " → `stop`; "UNSTOP" → `start`; "cancel", "END", "Stop." → `null`; "cancel my booking" → `null`.
    *   `isExplicitOptOut`: "Stop." and "please stop messaging me" → true; "can you stop by Tuesday" → false.
    *   `numberPick`: "2", "#2", "2.", "option 2" with 3 offered → 2; "4" with 3 offered → `null`; "22" → `null`.
    *   `findZip`: "12 Main St, NY 10001" → "10001"; "12345 Main St, 10001-1234" → "10001"; "12345 Oak Ave" → "12345" (known limit); "no zip here" → `null`.
    *   `findAmounts`: "$120.00", "$ 120", "120 dollars", "USD 120" → 12000; "$1,200" → 120000.
    *   `checkDraftPrices`: "A deep clean is $120." → `[]`; "A deep clean costs $35." → mismatch; "3 hours of regular cleaning is $105." with total 10500 → `[]`, without → mismatch; "Prices start from $20." → mismatch.
    *   `checkNumbers`: "It's 99/hr" with no 99 in facts → `unknown_number`.
    *   `route`: hazard order with two hazards over 0.5 → the earlier one; answer confidence 0.49 → `unclear`; two `off_topic` in a row → handoff; `later` resets the counter.
    *   `checkComplete`: a result missing `abusive` throws.
    *   `questions`: a slot option named `repeat` throws.
    *   `earliestPerDay`: one slot per day on three days; skips a closed Sunday; respects minimum notice; across the March DST change, labels stay at local opening time; `afterDay` starts after the given day.
    *   `eventId`: stable for the same inputs, different for a different slot, only `0-9a-f`.
    *   `decide`: every cell of the section 10 table.
    *   `escapeForSlack`: "<!channel> hi" → "&lt;!channel&gt; hi".
    *   `verifyMeta`: a body with emoji signed correctly → true; a header of the wrong length → false, without throwing.

#### 20. `scripts/build_code_nodes.js` (Create)

*   **Type / Scope**: Build script (Node, no dependencies). Step P1.
*   **Proposed Changes**: For each `workflows/**/*.json`, finds Code nodes whose code starts with `// @lib <module>`, bundles the module and the `lib/` modules it `require`s (each in its own function scope, in dependency order), and rewrites the region up to `// @end-lib`. `--check` exits non-zero on any difference and names the node. Both modes fail if any workflow file matches a secret pattern: `xox[abposr]-`, `sk-ant-`, `EAA[A-Za-z0-9]{20,}`, `pat-[a-z0-9]{2}-`, `-----BEGIN`, or any value longer than 8 characters from `deploy/*.env`.

#### 21. `scripts/export_workflows.py`, `scripts/deploy_workflows.py` (Create)

*   **Type / Scope**: Scripts (Python 3.12, standard library). Step P1, completed in P2.
*   **Proposed Changes**:
    *   Export: runs `n8n export:workflow --all --separate` inside the instance's container, removes volatile fields (timestamps, version IDs, pin data), replaces credential IDs with their names and data-table IDs with `__table:<name>__`, and writes one file per workflow to `workflows/`. From dry-run, adapters go to `workflows/fakes/`; from live, only adapters are exported (`--only adapters`).
    *   Deploy: builds `.staging/`, applies the dry-run changes or live refusals in section 13, resolves credential names to IDs (from `n8n export:credentials --all`, reading only IDs and names) and table names to IDs (from the API), imports with `n8n import:workflow --separate --input=.staging` so workflow IDs are kept (spike 7; fallback in the spike table), then activates the trigger workflows through the API.

#### 22. `scripts/setup_tables.py` (Create)

*   **Type / Scope**: Script. Step P2.
*   **Proposed Changes**: Creates or updates the data tables in section 14 through n8n's API: adds missing columns, never drops any. `--branch b` also creates the branch B columns and `processor_lease`. `--clear <table>` deletes all rows (used by the replay harness, which never drops tables, so IDs stay fixed).

#### 23. `scripts/report_metrics.py` (Create)

*   **Type / Scope**: Script. Step P8.
*   **Proposed Changes**: Reads `message_log` and `conversations` through the API for a time window. Reports: enquiry-to-booking rate (`crm_booked` events ÷ `crm_enquiry` events); cost per conversation (input and output tokens × the per-million-token prices passed as arguments, taken from Anthropic's and TypeSafe's price pages on the day); throughput (incoming messages handled per minute in the busiest minute); reply time median and maximum from `reply_ms`. Prints a Markdown table for the README.

#### 24. `workflows/*.json` (Create, built by the Author)

*   **Type / Scope**: n8n workflow exports. Steps P1–P9.
*   **Proposed Changes**: One file per workflow in section 3. Code nodes use the `// @lib` marker; guard nodes are named `guard:<id>`; time is read from a node named `clock:now`.

#### 25. `workflows/fakes/*.json` (Create, built by the Author)

*   **Type / Scope**: Fake adapters. Steps P3–P7.
*   **Proposed Changes**: `calendar-adapter`, `sheets-adapter`, `slack-adapter`, `hubspot-adapter`, each with the live adapter's workflow ID and the contract in section 13, calling the mock server with an HTTP Request node. A fake `classify` is added if spike 1 finds no settable base URL.

#### 26. `docs/build-guide.md` (Create, by the Agent)

*   **Type / Scope**: Wiring reference for the Author. Steps P1–P9.
*   **Proposed Changes**: Per workflow, written before the Author builds it: the trigger, the nodes in order, the `guard:` and `clock:now` names, which Code nodes take which `// @lib` module and call block, and the sub-workflow inputs and outputs. It must match the contracts in section 13 and the tables in section 14.

#### 27. `tests/mock_server.py` (Create)

*   **Type / Scope**: Test service (Python 3.12, standard library). Step P2.
*   **Proposed Changes**: Stands in for Meta's send API (including scripted 24-hour refusals and `failed` events), Jev, Anthropic (returning `usage`), and the four fake adapters. Control API:
    *   `POST /_scenario` with `{ name, now, live_models, jev: { stage: [answers...], draft_check: [answers...] }, haiku: [{ text, input_tokens, output_tokens }], calendar: { busy, events }, sheets: { facts_dir, unavailable }, slack: { unavailable }, hubspot: { unavailable, contacts }, meta: { refuse_outside_window } }`. Scripted answers are served in order per question set.
    *   `GET /_calls` returns `[{ service, op, request, at }]`.
    *   `GET /_clock` returns `{ now }`.
    *   With `live_models: true`, Jev and Anthropic calls pass through to the real services.

#### 28. `tests/replay.py` (Create)

*   **Type / Scope**: Replay harness (Python 3.12). Step P2, grows each step.
*   **Proposed Changes**: Options `--tier fixed | live`, `--remove-guards`, `--upto <step>`, `--only <scenario>`. Runs each scenario as in section 13. Prints "passed X of Y" per tier and, for the removal run, "N of M guards caused their scenario to fail when removed".

#### 29. `tests/scenarios.toml` (Create)

*   **Type / Scope**: Test data. Steps P2–P7.
*   **Proposed Changes**: One entry per scenario. Schema, with a worked example:

    ```toml
    [[scenario]]
    name = "price_mismatch_blocked"
    step = "P3"
    guards = ["dc_price"]
    now = "2026-12-01T15:00:00Z"
    facts = "tests/facts"

    [[scenario.event]]
    source = "meta"            # meta | slack_events | slack_actions | replay
    signing = "valid"          # valid | none | wrong
    fixture = "tests/fixtures/meta/text.json"
    text = "how much is a deep clean?"

    [scenario.script]
    jev.stage = [{ hazards = {}, answer = { value = "price_question", confidence = 0.9 } }]
    jev.draft_check = [{ problems = {} }]
    haiku = [{ text = "A deep clean is $95.", input_tokens = 900, output_tokens = 20 }]

    [scenario.expect]
    route = "price_question"
    sends = [{ kind = "normal", text_contains = "pass that to the team" }]
    problems = ["price_mismatch"]
    slack_posts = 1
    hubspot_calls = 0
    rows = { message_log = 2 }
    ```

    Scenarios cover every CUJ and every guard ID, including: each gate step; each hazard; each draft-check problem with one planted draft that trips only that problem; the price list, a calculated total and a wrong-service price; ZIP in area, out of area, missing twice, and "12345 Oak Ave"; booking, a slot taken twice, a returning customer booking again, a retried booking; handoff, relay, a `//` note, a user not on the list, Return to bot, a double click, Mark as booked, close and Reopen; a waiting message sent after the template reply, STOP as the template reply, release refused while messages wait, Discard; HubSpot first enquiry, repeat enquiry, booked, unavailable; Sheets unavailable; duplicate Meta and Slack deliveries; two events arriving at once.

#### 30. `tests/fixtures/` and `tests/redact_fixture.py` (Create)

*   **Type / Scope**: Test data and tool. Step P1.
*   **Proposed Changes**: Meta and Slack webhook bodies captured in P1. The tool replaces phone numbers and names in the raw bytes, keeping Meta's escaping (`\uXXXX`, `\/`) rather than re-serialising the JSON, then signs the exact result with the test secret. Raw captures stay in the git-ignored `tests/captures/`.

#### 31. `tests/adapter_contract.py` (Create)

*   **Type / Scope**: Contract test, run by hand before each live-tier run. Step P8.
*   **Proposed Changes**: For each adapter operation in section 13, sends the same input to the live adapter (test calendar, test sheet, test channel, HubSpot test account) and the fake, and fails if the output keys or types differ.

#### 32. `tests/facts/` (Create)

*   **Type / Scope**: Test data. Step P2.
*   **Proposed Changes**: `facts.csv` (hours, cancellation policy, what each clean includes); `prices.csv`: Regular clean (aliases "regular cleaning; standard clean", hour, 35, 180, yes), Deep clean ("deep cleaning", fixed, 120, 240, yes), Oven clean ("oven cleaning", fixed, 45, 60, yes); `service_areas.csv`: 10001, 10002, 10003, 10011, 10014; `hours.csv`: mon–fri 08:00–18:00, sat 09:00–14:00.

#### 33. `docs/spikes.md`, `docs/meta-setup.md`, `docs/hand-test.md` (Create)

*   **Type / Scope**: Evidence documents. Steps S1–P8.
*   **Proposed Changes**: Spike results with the date, the pinned versions, what was tried and the branch chosen. Meta setup steps and every failure (symptom, how found, fix), including those caused on purpose. Hand-test script and runs: a passed hand test is one run of the script (a facts question, a booking, a handoff with a relay and Return to bot, STOP then START) where every step's expected result happened. At least 10 runs, reported as passed out of run, with reply times.

#### 34. `README.md` (Create)

*   **Type / Scope**: Portfolio front page. Step P8.
*   **Proposed Changes**: Headline 1 (fixed tier "passed X of Y", guard-removal "N of M", and the live tier shown separately) and headline 2 (`meta-setup.md` failure count and hand-test passes with reply times); the metrics table from `report_metrics.py` (enquiry-to-booking rate, cost per conversation, measured throughput stated as the system's limit); architecture diagram; the carried over / changed / new table against Lead Bot (including: keyword set without CANCEL and END, 600-character cap, shorter Jev retries, wrong-person closing instead of do-not-contact, owner relay, release without reset, START, prompt injection); plain definitions (relay, release, episode, template message, 24-hour window); what the customer sees on release; privacy notes; the Risks and Limits that matter to a client; the community-node note for n8n Cloud; how to run the replay.

#### 35. `spec/concepts_brief.md` (Modify)

*   **Type / Scope**: Source document. Step P8.
*   **Proposed Changes**: Add a note at the top that the design document supersedes its open items and that the 2026-11-24 review changed the ordering, guard-removal, release and booking-key decisions.

### Verification Plan

*   **Unit tests**: `npm test` passes, including every case listed in file 19.
*   **Build check**: `npm run check` passes: no drift between `lib/` and `workflows/`, and no secret patterns.
*   **Fixed tier**: `python tests/replay.py --tier fixed` passes every scenario (X = Y).
*   **Guard-removal run**: `python tests/replay.py --remove-guards` shows every guard's scenario failing when that guard is removed (N = M).
*   **Adapter contract**: `python tests/adapter_contract.py` passes before each live-tier run.
*   **Live-model tier**: `python tests/replay.py --tier live` is run and its score reported as measured, separately from the fixed tier, with no pass threshold.
*   **Hand test**: at least 10 runs recorded in `docs/hand-test.md`, reported as passed out of run, with reply times.
*   **Delivery evidence**: every failure listed in Goal 2 has an entry in `docs/meta-setup.md`.
*   **Metrics**: `python scripts/report_metrics.py` produces the README's metrics table from the hand-test window.
