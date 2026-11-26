#!/usr/bin/env python3
"""Runs the doctor workflow on an instance and prints its checks (design section 3, step P9).

    python scripts/run_doctor.py                    # live instance
    python scripts/run_doctor.py --instance dryrun  # dry-run, against the mock's Meta account
    python scripts/run_doctor.py --json

The doctor makes only read-only Graph API GETs with the "Meta" credential, plus the GET verify
handshake against ingress-whatsapp. It is started through the n8n CLI (it has a manual trigger and
no webhook), so this needs the instance's container running. The same checks show in the editor:
open the doctor workflow, press Execute workflow, and read the output of doctor:report.
Exit code 1 when any check fails.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import n8n_cli  # noqa: E402

DOCTOR_ID = "DocWf3Mt8Qz5Rb1N"
REPORT_NODE = "doctor:report"
# n8n execute starts a second n8n process in the container; its task broker needs a free port.
SPARE_BROKER_PORT = "5690"
MARK = {"pass": "ok  ", "warn": "WARN", "fail": "FAIL", "skip": "skip"}


def execute(instance):
    """Returns (report rows, raw CLI output)."""
    out = n8n_cli.n8n(instance, "env", "N8N_RUNNERS_BROKER_PORT=" + SPARE_BROKER_PORT,
                      "n8n", "execute", "--id", DOCTOR_ID, "--rawOutput")
    start = out.find("\n{")
    if start == -1:
        sys.exit("the doctor run printed no result:\n" + out[-2000:])
    run = json.loads(out[start + 1:])
    result = run.get("data", {}).get("resultData", {})
    if result.get("error"):
        sys.exit("the doctor run failed: %s" % result["error"].get("message"))
    try:
        rows = [i["json"] for i in result["runData"][REPORT_NODE][0]["data"]["main"][0]]
    except (KeyError, IndexError):
        sys.exit("the doctor run has no %s output" % REPORT_NODE)
    return rows, out


def table(rows):
    width = max(len(r["check"]) for r in rows)
    return "\n".join("%s  %s  %s" % (MARK.get(r["status"], r["status"]), r["check"].ljust(width), r["detail"]) for r in rows)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--instance", choices=["live", "dryrun"], default="live")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    rows, _ = execute(args.instance)
    print(json.dumps(rows, indent=2) if args.json else table(rows))
    return 1 if any(r["status"] == "fail" for r in rows) else 0


if __name__ == "__main__":
    sys.exit(main())
