#!/usr/bin/env python3
"""Runs the doctor workflow on the dry-run instance against Meta accounts the mock describes,
and checks what it reports (step P9).

    python tests/doctor_check.py

Each case loads a mock scenario with a meta_setup section (see tests/mock_server.py), runs the
doctor through the n8n CLI, and checks the status of named checks. Every case also checks that the
doctor only read (every mock call is a Graph GET sent with the Meta bearer header) and that no
secret or full phone number reaches the run's output.
"""
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import run_doctor  # noqa: E402
import setup_tables  # noqa: E402

MOCK_BASE = "http://127.0.0.1:8765"
BLOCKED = {"can_send_message": "BLOCKED", "entities": [{"entity_type": "BUSINESS", "can_send_message": "BLOCKED", "errors": [
    {"error_code": 131031, "error_description": "Business account has been locked.",
     "possible_solution": "Verify the business in Security Center."}]}]}

CASES = [
    ("healthy", {}, {"summary": "pass", "token": "pass", "phone_number": "pass", "webhook_handshake": "pass"}),
    ("token_expired", {"token_expired": True},
     {"token": "fail", "token_scopes": "warn", "phone_number": "fail", "summary": "fail"}),
    ("missing_scope", {"scopes": ["whatsapp_business_messaging"]}, {"token_scopes": "fail"}),
    ("business_unverified", {"phone": {"health_status": BLOCKED}, "waba": {"health_status": BLOCKED}},
     {"phone_number": "fail", "waba_health": "fail", "token": "pass"}),
    ("waba_not_subscribed", {"subscribed_apps": []}, {"waba_subscription": "fail"}),
    ("template_moved_to_marketing",
     {"templates": [{"name": "enquiry_update", "status": "APPROVED", "category": "MARKETING", "language": "en_US"}]},
     {"template": "warn", "summary": "warn"}),
    ("template_missing", {"templates": []}, {"template": "fail"}),
    ("quality_yellow", {"phone": {"quality_rating": "YELLOW"}}, {"phone_number": "warn"}),
]
DETAIL_MUST = {"business_unverified": ("phone_number", "Business account has been locked. (131031)"),
               "waba_not_subscribed": ("waba_subscription", "subscribed_apps")}


def control(env, path, body=None):
    req = urllib.request.Request(MOCK_BASE + path, data=None if body is None else json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "X-Replay-Secret": env.get("REPLAY_SECRET", "")},
                                 method="GET" if body is None else "POST")
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read() or b"null")


def main():
    env = setup_tables.load_env(ROOT / "deploy" / "dryrun.env")
    secrets = [env[k] for k in ("META_APP_SECRET", "META_VERIFY_TOKEN", "REPLAY_SECRET") if env.get(k)]
    full_numbers = ["5550101234", env.get("META_PHONE_NUMBER_ID", "")]
    passed = 0
    for name, setup, expect in CASES:
        control(env, "/_scenario", {"name": "doctor_" + name, "meta_setup": setup})
        rows, raw = run_doctor.execute("dryrun")
        got = {r["check"]: r for r in rows}
        problems = ["%s is %s, expected %s" % (c, got.get(c, {}).get("status"), s)
                    for c, s in expect.items() if got.get(c, {}).get("status") != s]
        if name in DETAIL_MUST:
            c, text = DETAIL_MUST[name]
            if text not in got.get(c, {}).get("detail", ""):
                problems.append("%s detail lacks %r" % (c, text))
        calls = control(env, "/_calls")
        writes = [c for c in calls if c["service"] != "meta_get"]
        if writes:
            problems.append("not read-only: %s" % sorted({c["service"] + ":" + str(c["op"]) for c in writes}))
        if not all(c["request"].get("bearer") for c in calls):
            problems.append("a Graph call went without the Meta bearer header")
        report_text = json.dumps(rows)
        problems += ["a secret reached the run output" for s in secrets if s in raw]
        problems += ["a full number reached the report" for n in full_numbers if n and n in report_text]
        print(("PASS " if not problems else "FAIL ") + name + ("" if not problems else ": " + "; ".join(problems)))
        passed += not problems
    print("\npassed %d of %d" % (passed, len(CASES)))
    return 0 if passed == len(CASES) else 1


if __name__ == "__main__":
    sys.exit(main())
