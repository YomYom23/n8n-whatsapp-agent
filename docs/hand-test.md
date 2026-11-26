# Hand test

The hand test is headline 2's own count (design Goal 2 and file 33): a person on a real phone runs the
script below against the **live** instance and the test number. A passed hand test is one run of the
whole script where every step's expected result happened. At least 10 runs are recorded, and the README
reports them as "passed N of M", with reply times.

The hand-test window is also the window `scripts/report_metrics.py` reads for the README's metrics.

## Before the first run

*   Meta can deliver from the test number. **Blocked as of 2026-11-25:** sends fail with 131031
    "Business Account locked" until business verification passes (see `docs/spikes.md`, S0). If
    verification fails, the fallback is the Twilio WhatsApp Sandbox, and the README says so.
*   The live instance runs the workflows from git (`python scripts/deploy_workflows.py --instance live`),
    and the live adapters (calendar, Sheets, Slack, HubSpot) point at test accounts.
*   `python tests/adapter_contract.py` passes.
*   The test calendar has free time on at least three of the next 14 days, inside the hours in the facts
    sheet. The phone you test from is on the test number's allow list and is **not** on do-not-contact.
*   Before each run, delete the phone's `conversations` row on the live instance (data tables) so the
    run starts at stage `new`. Keep `message_log`: the metrics read it.
*   Have Slack open on the test channel, as a user listed in `SLACK_ALLOWED_USERS`.

## Timing

Reply time is logged by `send` as `reply_ms` (from the inbound message's receipt to Meta's accepted
send), so you don't need a stopwatch. After a run, read the run's `out` rows in `message_log` and
note the median and the longest `reply_ms` in the results table. Also note anything that felt slow on
the phone.

## The script

Send each message as written, from the phone, and wait for the expected result before the next step.
Tick a step only if everything in its "Expect" column happened.

| # | Who | Do | Expect |
| --- | --- | --- | --- |
| 1 | Phone | "are you open on Saturdays?" | One reply with Saturday's hours from the facts sheet and nothing else (CUJ 1). Two `message_log` rows with route `answer`. |
| 2 | Phone | "I'd like a deep clean" | The bot asks for the address. HubSpot test account: a contact for the phone and a deal at Enquiry (CUJ 2). |
| 3 | Phone | an address in a service-area ZIP, such as "12 Main St, New York NY 10001" | Three numbered times, one per day on three different days, all inside opening hours and at least 12 hours away. |
| 4 | Phone | "2" | A confirmation naming time 2. Test calendar: an event at that time with the address. HubSpot: the deal at Booked. |
| 5 | Phone | "can I talk to a person?" | "passing this to a member of our team" (or the current handoff line). Slack: a new thread with the reason and the conversation so far (CUJ 3). |
| 6 | Phone | "is Thursday possible instead?" | The message appears in the Slack thread. No bot reply on the phone. |
| 7 | Slack | reply in the thread: "Yes, Thursday works. I'll move it." | The reply arrives on the phone as written. A reaction on the Slack reply confirms it was sent. |
| 8 | Slack | reply in the thread: "// note for the team" | Nothing reaches the phone (team note). |
| 9 | Slack | press **Return to bot** | The thread says the conversation is back with the bot. |
| 10 | Phone | "what does a deep clean include?" | A bot answer from the facts sheet. |
| 11 | Phone | "STOP" | One opt-out confirmation, and nothing after it (CUJ 4). `do_not_contact` has the number. |
| 12 | Phone | "are you open on Sunday?" | No reply. |
| 13 | Phone | "START" | The START reply. The number is gone from `do_not_contact`. |

## Runs

| Run | Date (UTC) | Tester | Steps passed | Passed? | Reply time median / max | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | | | of 13 | | | |
| 2 | | | of 13 | | | |
| 3 | | | of 13 | | | |
| 4 | | | of 13 | | | |
| 5 | | | of 13 | | | |
| 6 | | | of 13 | | | |
| 7 | | | of 13 | | | |
| 8 | | | of 13 | | | |
| 9 | | | of 13 | | | |
| 10 | | | of 13 | | | |

**Result:** _passed N of M_ (fill in when the runs are done, and copy it to the README).

For a failed step, write down what happened instead, the execution ID from `message_log`, and whether it
was the system or the test setup (an unlisted phone, a full calendar). A setup problem doesn't count as a
run; rerun it.
