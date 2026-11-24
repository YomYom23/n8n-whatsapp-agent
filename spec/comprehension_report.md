# Stage 6: Comprehension Report

Target: `docs/designs/whatsapp-agent.md`. FeatureRange 1–493, DetailedRange 494–720. Reviewer: `egm-comprehension`, reading the document alone with no standard.

**What this proposes**

The document plans a portfolio prototype: a WhatsApp agent for a fictional US cleaning company, built as a set of n8n workflows on a self-hosted instance. Customer messages arrive through Meta's Cloud API. The agent answers from an owner-edited Google Sheet, books slots into Google Calendar that code generates from free time, and copies enquiries and bookings to HubSpot as a two-step deal (Enquiry, then Booked). A Jev classifier answers fixed questions with probabilities, and code applies thresholds to pick each action. Claude Haiku writes replies only when no fixed text fits. Every Haiku draft is checked by a second Jev call and by code (price matching, length, follow-up promises) before it is sent. The owner can take over from a Slack thread, reply through the business number (including after the 24-hour window, via a template), and hand back with a "Return to bot" button. Two pieces of evidence are planned. The first is a replay harness run against a separate dry-run instance with a mock server, scored as a fixed tier, a live-model tier and a guard-removal run. The second is a `docs/meta-setup.md` written from real delivery failures.

**How the existing system works, per this document**

Nothing exists yet in this repo. The existing system is Lead Bot, an earlier Python SMS agent for a roofing company, built with Twilio and Google Calendar. Per the document, Lead Bot already uses this safety design: a classifier with fixed hazard questions checked in first-match order, code-applied thresholds, a draft guard, a missing field treated as a failure, retries, a single worker that handles one event at a time, slot generation with a fixed ID format, and a per-lead booking key with three checks before booking. Lead Bot left STOP keywords to Twilio and never stated prices. It passed 67 of 67 live conversations and 431 automated tests. This project ports that design into n8n and changes it for WhatsApp and for a cleaning company.

## Findings

No Blockers: every section could be paraphrased.

### Major

1. **Send rules contradict the gate and CUJ 4 (lines 233, 98, 304–310, 157).** STOP adds the number to do-not-contact and then sends a confirmation, even during a handoff. Section 9 blocks bot messages to do-not-contact numbers and to conversations with the owner, so the confirmation can never go out. `handoff` sets `human_owned` before sending, so any "passing you to a person" message would be blocked too. The document never says whether the customer is told about the handoff.
2. **How replay-only settings reach the workflows is unclear (lines 127, 368, 466, 545, 670).** They are named as env variables but also said to be set per scenario through the mock server. "Fixture mode" is never defined. "The core" (line 127) is undefined.
3. **Switching off a non-draft guard is undefined (lines 366, 610).** "Switching off" means filtering the problem list, but signature, duplicate, do-not-contact and human-owned checks have no problem list.
4. **`prompt_epoch` is never defined (lines 239, 337, 376, 575).** Its relation to `person_spoke_last` and `botAskedSinceHuman` is unexplained.
5. **The booking key is never defined (lines 338, 350, 358).** How it's formed, where it's stored, whether it's the event ID. The owner can't book "under this key" by hand without knowing it.
6. **"Close the conversation" has no state (lines 268–269).** No `closed` stage or field, and no rule for the next message. `wrong_person` is undefined for inbound-only use.
7. **The fallback duplicate check doesn't hold together (line 214).** A duplicate row has its own `received` status.
8. **The re-offer and taken limits are not stated as rules (lines 92, 297, 356–357, 376).** "Slots keep filling" is never defined.
9. **`repeat` and `later` are never defined (lines 247, 276).** "As in Lead Bot" points to a local path others can't open.
10. **"Code" as an actor is ambiguous (lines 496, 513–523).** It reads like an AI assistant, but could mean scripts.
11. **The chosen `lib/` approach isn't stated in FeatureRange (lines 453–454, 476).** Alternatives reject two options without saying which was chosen; it appears only at line 496.
12. **Jev and TypeSafe are not introduced (lines 15, 70, 421–422).** No description, link, or list of node candidates.

### Nit

13. The 24-hour window and template rules are not defined (lines 49, 72, 310, 332).
14. "The reviewers" / "all seven reviewers" are not explained (lines 421, 442, 449).
15. Source documents are cited without paths (lines 23, 482).
16. Several Lead Bot terms are undefined: the worker, the follow-up regex, the call "message" stage, `insurance_talk`/`price_talk` (lines 222, 285, 286, 300).
17. How a service is recognised in free text for the price check, and what counts as a sentence (line 286).
18. One CSV said to hold four tabs (lines 131, 695).
19. What starts a workflow on a new data-table row, and that spike 3 must confirm it (lines 174, 224).
20. Which replay scenarios use the real ingress vs `ingress-replay` (lines 362, 675).
21. "Meta's timeout" has no value (line 470).
22. "FACTS" in capitals is undefined (line 285).

Most important: Finding 1 (send rules vs STOP confirmation and handoff message) and Findings 2–3 (how dry-run settings and guard switches work).
