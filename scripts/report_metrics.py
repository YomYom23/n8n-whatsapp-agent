#!/usr/bin/env python3
"""Metrics for the README (design file 23). Reads message_log through n8n's API.

    python scripts/report_metrics.py --from 2026-12-01T00:00:00Z --to 2026-12-08T00:00:00Z \
        --haiku-input 1.00 --haiku-output 5.00 --jev-per-call 0.0005

Prices are per million tokens (Haiku) and per call (Jev), copied from Anthropic's and TypeSafe's
price pages on the day the report is made; the script prints them under the table so the numbers
can be checked. Without --from/--to it reads every row.

Reports:
  * enquiry-to-booking rate: crm_booked events / crm_enquiry events (message_log rows with
    direction = event, written by crm-sync), with the counts;
  * cost per conversation: Haiku input and output tokens from message_log, plus Jev calls (one per
    inbound message with a classifier result, one per AI draft checked; Jev usage isn't logged),
    divided by the number of conversations (distinct wa_id with an inbound message in the window);
  * throughput: inbound messages handled in the busiest minute;
  * reply time: median and maximum reply_ms over bot replies.

Prints a Markdown table. --instance defaults to live; use dryrun to try it on replay data.
"""
import argparse
import json
import statistics
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import setup_tables  # noqa: E402


def parse_time(value):
    if not value:
        return None
    t = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return t


def read_rows(api, table_name):
    table = api.find_table(table_name)
    if table is None:
        sys.exit(f"Table {table_name} is missing. Run: python scripts/setup_tables.py")
    out, cursor = [], None
    while True:
        q = {"limit": 250}
        if cursor:
            q["cursor"] = cursor
        page = api.must("GET", f"/data-tables/{table['id']}/rows", query=q)
        out += page.get("data", [])
        cursor = page.get("nextCursor")
        if not cursor:
            return out


def in_window(row, start, end):
    t = parse_time(row.get("logged_at"))
    if t is None:
        return False
    return (start is None or t >= start) and (end is None or t < end)


def number(v):
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def has_json(v):
    """True for a non-empty JSON value stored as a string (the classifier column)."""
    if not v:
        return False
    try:
        return bool(json.loads(v)) if isinstance(v, str) else bool(v)
    except json.JSONDecodeError:
        return True


def metrics(log_rows, prices):
    """Computes the report from message_log rows. Pure, so it can be tested without n8n."""
    inbound = [r for r in log_rows if r.get("direction") == "in"]
    outbound = [r for r in log_rows if r.get("direction") == "out"]
    events = Counter(r.get("kind") for r in log_rows if r.get("direction") == "event")
    enquiries, bookings = events.get("crm_enquiry", 0), events.get("crm_booked", 0)

    conversations = len({r.get("wa_id") for r in inbound if r.get("wa_id")})
    input_tokens = sum(number(r.get("input_tokens")) for r in log_rows)
    output_tokens = sum(number(r.get("output_tokens")) for r in log_rows)
    jev_calls = sum(1 for r in inbound if has_json(r.get("classifier"))) + sum(1 for r in outbound if r.get("draft"))
    cost = (input_tokens * prices["haiku_input"] + output_tokens * prices["haiku_output"]) / 1_000_000 \
        + jev_calls * prices["jev_per_call"]

    per_minute = Counter(parse_time(r["logged_at"]).strftime("%Y-%m-%dT%H:%M") for r in inbound if r.get("logged_at"))
    busiest = per_minute.most_common(1)[0] if per_minute else (None, 0)

    replies = [number(r.get("reply_ms")) for r in outbound if r.get("author") == "bot"]
    replies = [ms for ms in replies if ms > 0]
    return {
        "enquiries": enquiries, "bookings": bookings,
        "booking_rate": (bookings / enquiries) if enquiries else None,
        "conversations": conversations, "input_tokens": int(input_tokens), "output_tokens": int(output_tokens),
        "jev_calls": jev_calls, "cost_total": cost,
        "cost_per_conversation": (cost / conversations) if conversations else None,
        "inbound": len(inbound), "busiest_minute": busiest[0], "busiest_count": busiest[1],
        "replies": len(replies),
        "reply_median_ms": statistics.median(replies) if replies else None,
        "reply_max_ms": max(replies) if replies else None,
    }


def pct(v):
    return "n/a" if v is None else f"{v * 100:.0f}%"


def usd(v):
    return "n/a" if v is None else "$" + f"{v:.4f}"


def sec(v):
    return "n/a" if v is None else f"{v / 1000:.1f} s"


def markdown(m, prices, window):
    lines = [
        "| Metric | Value | From |",
        "| --- | --- | --- |",
        f"| Enquiry-to-booking rate | {pct(m['booking_rate'])} | {m['bookings']} booked of {m['enquiries']} enquiries |",
        f"| Cost per conversation | {usd(m['cost_per_conversation'])} | {usd(m['cost_total'])} over {m['conversations']} conversations |",
        f"| Throughput (busiest minute) | {m['busiest_count']} messages/min | {m['busiest_minute'] or 'no messages'} |",
        f"| Reply time, median | {sec(m['reply_median_ms'])} | {m['replies']} bot replies |",
        f"| Reply time, maximum | {sec(m['reply_max_ms'])} | |",
        "",
        f"Window: {window}. Haiku tokens: {m['input_tokens']} in, {m['output_tokens']} out, at "
        f"{usd(prices['haiku_input'])}/M in and {usd(prices['haiku_output'])}/M out. "
        f"Jev calls: {m['jev_calls']} at {usd(prices['jev_per_call'])} each.",
    ]
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--instance", choices=["live", "dryrun"], default="live")
    ap.add_argument("--from", dest="start", help="ISO time, inclusive")
    ap.add_argument("--to", dest="end", help="ISO time, exclusive")
    ap.add_argument("--haiku-input", type=float, required=True, help="USD per million input tokens")
    ap.add_argument("--haiku-output", type=float, required=True, help="USD per million output tokens")
    ap.add_argument("--jev-per-call", type=float, default=0.0, help="USD per Jev call")
    ap.add_argument("--json", action="store_true", help="print the numbers as JSON instead of Markdown")
    args = ap.parse_args()

    start, end = parse_time(args.start), parse_time(args.end)
    api = setup_tables.Api(args.instance)
    rows = [r for r in read_rows(api, "message_log") if in_window(r, start, end)]
    prices = {"haiku_input": args.haiku_input, "haiku_output": args.haiku_output, "jev_per_call": args.jev_per_call}
    m = metrics(rows, prices)
    if args.json:
        print(json.dumps(m, indent=2, default=str))
    else:
        print(markdown(m, prices, f"{args.start or 'start'} to {args.end or 'now'} on {args.instance}"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
