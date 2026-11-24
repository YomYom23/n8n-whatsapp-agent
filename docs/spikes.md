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
