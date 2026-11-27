#!/usr/bin/env python3
"""Replay harness (design file 28, section 13). Runs tests/scenarios.toml against the dry-run instance.

For each scenario: clear every data table, load the scenario into the mock server, send its
events to the ingress webhooks (signed validly, unsigned, or with a wrong signature) or to
ingress-replay, wait until n8n is idle, then check what happened against [scenario.expect].

    python tests/replay.py                       # fixed tier, scenarios up to current_step
    python tests/replay.py --upto P3             # scenarios enabled by P3 and earlier
    python tests/replay.py --only price_mismatch_blocked
    python tests/replay.py --tier live           # Jev and Anthropic calls go to the real services
    python tests/replay.py --remove-guards       # guard-removal run (needs scripts/deploy_workflows.py)
    python tests/replay.py --list                # show the selected scenarios and exit
    python tests/replay.py --provider twilio     # the scenarios marked provider = "twilio"

A scenario marked provider = "twilio" tests send's Twilio route, so it runs only with --provider
twilio, which recreates the dry-run n8n container with WA_PROVIDER=twilio and puts it back to meta
at the end. Every other run checks the container is on meta first (and puts it back if not).

An event may set clock = "<ISO time>" to move the mock's scenario clock before it is sent.

Reads deploy/scripts.env (N8N_API_URL_DRYRUN, N8N_API_KEY_DRYRUN) and deploy/dryrun.env
(META_APP_SECRET, SLACK_SIGNING_SECRET, TWILIO_*, REPLAY_SECRET). Exit code 0 only when every selected
scenario passed (and, for --remove-guards, every guard caused a failure when removed).
"""
import argparse
import base64
import hashlib
import hmac
import json
import os
import subprocess
import sys
import time
import tomllib
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import setup_tables  # noqa: E402  (shares the API client and the table list)

N8N_BASE = "http://127.0.0.1:5679"
MOCK_BASE = "http://127.0.0.1:8765"

# Webhook paths each ingress workflow must use (docs/build-guide.md repeats them).
WEBHOOKS = {
    "meta": "/webhook/ingress-whatsapp",
    "slack_events": "/webhook/ingress-slack-events",
    "slack_actions": "/webhook/ingress-slack-interactivity",
    "replay": "/webhook/ingress-replay",
    "twilio": "/webhook/ingress-twilio",
}
# Twilio signs the URL it was given; ingress-twilio rebuilds it from WEBHOOK_URL, which the dry-run
# compose file sets to http://localhost:5679/.
TWILIO_SIGNED_URL = "http://localhost:5679/webhook/ingress-twilio"
CONTAINER = "wa-agent-dryrun-n8n-1"
COMPOSE = ["docker", "compose", "--env-file", str(ROOT / "deploy" / "dryrun.env"),
           "-f", str(ROOT / "deploy" / "docker-compose.dryrun.yml")]
PROVIDERS = ("meta", "twilio")
STEPS = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10"]  # P10: the Twilio route
EXPECT_KEYS = {"route", "sends", "problems", "slack_posts", "hubspot_calls", "rows", "calls"}
DEFAULT_WA_ID = "15550000001"
IDLE_TIMEOUT_S = 90


# --- setup --------------------------------------------------------------------
def load_dryrun_env():
    path = ROOT / "deploy" / "dryrun.env"
    if not path.exists():
        sys.exit("Missing deploy/dryrun.env. Copy deploy/dryrun.env.example and fill it in.")
    return setup_tables.load_env(path)


def http(method, url, body=None, headers=None, raw=None, timeout=30):
    """Returns (status, parsed JSON or text). Never raises on HTTP errors."""
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    if body is not None and raw is None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, setup_tables._parse(r.read())
    except urllib.error.HTTPError as e:
        return e.code, setup_tables._parse(e.read())
    except urllib.error.URLError as e:
        return 0, str(e.reason)


class Mock:
    def __init__(self, secret):
        self.h = {"X-Replay-Secret": secret}

    def health(self):
        return http("GET", MOCK_BASE + "/_health")

    def load(self, scenario):
        status, out = http("POST", MOCK_BASE + "/_scenario", scenario, self.h)
        if status != 200:
            raise HarnessError(f"mock /_scenario -> {status}: {out}")

    def set_clock(self, now):
        status, out = http("POST", MOCK_BASE + "/_clock", {"now": now}, self.h)
        if status != 200:
            raise HarnessError(f"mock /_clock -> {status}: {out}")

    def calls(self):
        status, out = http("GET", MOCK_BASE + "/_calls", headers=self.h)
        if status != 200:
            raise HarnessError(f"mock /_calls -> {status}: {out}")
        return out


class HarnessError(Exception):
    """The harness or the instance is broken, as opposed to a scenario failing its checks."""


class Instance:
    def __init__(self):
        self.api = setup_tables.Api("dryrun")
        self.tables = {}
        for name in setup_tables.table_specs("b"):
            t = self.api.find_table(name)
            if t is None:
                sys.exit(f"Table {name} is missing on dryrun. Run: python scripts/setup_tables.py")
            self.tables[name] = t["id"]

    def clear_all(self):
        for tid in self.tables.values():
            self.api.must("DELETE", f"/data-tables/{tid}/rows/clear")

    def rows(self, name):
        out, cursor = [], None
        while True:
            q = {"limit": 250}
            if cursor:
                q["cursor"] = cursor
            page = self.api.must("GET", f"/data-tables/{self.tables[name]}/rows", query=q)
            out += page.get("data", [])
            cursor = page.get("nextCursor")
            if not cursor:
                return out

    def busy(self):
        """True while any execution runs or the branch B inbox still has received rows."""
        for status in ("running", "new"):
            code, out = self.api.call("GET", "/executions", query={"status": status, "limit": 1})
            if code == 200 and out.get("data"):
                return True
        return any(r.get("status") in ("received", "handling") for r in self.rows("inbox"))

    def wait_idle(self):
        deadline, quiet = time.monotonic() + IDLE_TIMEOUT_S, 0
        while time.monotonic() < deadline:
            quiet = 0 if self.busy() else quiet + 1
            if quiet >= 3:  # three idle reads a second apart: the scheduled processor has had its turn
                return
            time.sleep(1)
        raise HarnessError(f"n8n still busy after {IDLE_TIMEOUT_S} s")


# --- events -------------------------------------------------------------------
def meta_serialise(obj):
    """Serialises the way Meta does: non-ASCII as \\uXXXX and '/' as '\\/'."""
    return json.dumps(obj, ensure_ascii=True, separators=(",", ":")).replace("/", "\\/").encode()


def build_meta(ev, scenario):
    body = json.loads((ROOT / ev["fixture"]).read_text(encoding="utf-8"))
    value = body["entry"][0]["changes"][0]["value"]
    wa_id = ev.get("from", scenario.get("wa_id", DEFAULT_WA_ID))
    for c in value.get("contacts", []):
        c["wa_id"] = wa_id
    for i, m in enumerate(value.get("messages", [])):
        m["from"] = wa_id
        m["id"] = ev.get("message_id", f"wamid.REPLAY.{scenario['name']}.{ev['_index']}.{i}")
        m["timestamp"] = str(int(_ts(ev.get("clock", scenario["now"]))))
        if "text" in ev and m.get("type") == "text":
            m["text"]["body"] = ev["text"]
    return meta_serialise(body), "application/json"


def build_slack(ev, scenario):
    body = json.loads((ROOT / ev["fixture"]).read_text(encoding="utf-8"))
    for k, v in (ev.get("set") or {}).items():
        _set_path(body, k, v)
    if ev["source"] == "slack_actions":
        raw = urllib.parse.urlencode({"payload": json.dumps(body, separators=(",", ":"))}).encode()
        return raw, "application/x-www-form-urlencoded"
    return json.dumps(body, separators=(",", ":")).encode(), "application/json"


def build_twilio(ev, scenario, env):
    """A Twilio WhatsApp webhook form: an incoming message, or a status callback when message_status is set."""
    wa_id = ev.get("from", scenario.get("wa_id", DEFAULT_WA_ID))
    sid = ev.get("message_id", f"SMREPLAY{scenario['name']}{ev['_index']}".replace("_", ""))
    business = "whatsapp:" + env["TWILIO_WHATSAPP_FROM"]
    if ev.get("message_status"):
        params = [("MessageSid", sid), ("SmsSid", sid), ("AccountSid", env["TWILIO_ACCOUNT_SID"]), ("From", business),
                  ("To", "whatsapp:+" + wa_id), ("MessageStatus", ev["message_status"]), ("SmsStatus", ev["message_status"]),
                  ("ErrorCode", str(ev.get("error_code", ""))), ("ApiVersion", "2010-04-01")]
    else:
        params = [("SmsMessageSid", sid), ("MessageSid", sid), ("AccountSid", env["TWILIO_ACCOUNT_SID"]),
                  ("From", "whatsapp:+" + wa_id), ("To", business), ("Body", ev.get("text", "")),
                  ("NumMedia", str(ev.get("num_media", 0))), ("ProfileName", "Replay"), ("WaId", wa_id),
                  ("SmsStatus", "received"), ("ApiVersion", "2010-04-01")]
    return urllib.parse.urlencode(params).encode(), "application/x-www-form-urlencoded"


def sign(ev, raw, env, now):
    signing = ev.get("signing", "valid")
    if signing not in ("valid", "none", "wrong"):
        raise HarnessError(f"signing must be valid, none or wrong, not {signing!r}")
    if signing == "none":
        return {}
    wrong = signing == "wrong"
    if ev["source"] == "twilio":
        params = urllib.parse.parse_qsl(raw.decode(), keep_blank_values=True)
        data = TWILIO_SIGNED_URL + "".join(k + v for k, v in sorted(params))
        key = env["TWILIO_AUTH_TOKEN"] + ("x" if wrong else "")
        return {"X-Twilio-Signature": base64.b64encode(hmac.new(key.encode(), data.encode(), hashlib.sha1).digest()).decode()}
    if ev["source"] == "meta":
        key = env["META_APP_SECRET"] + ("x" if wrong else "")
        return {"X-Hub-Signature-256": "sha256=" + hmac.new(key.encode(), raw, hashlib.sha256).hexdigest()}
    ts = str(int(_ts(now)))
    key = env["SLACK_SIGNING_SECRET"] + ("x" if wrong else "")
    base = b"v0:" + ts.encode() + b":" + raw
    return {"X-Slack-Request-Timestamp": ts,
            "X-Slack-Signature": "v0=" + hmac.new(key.encode(), base, hashlib.sha256).hexdigest()}


def send_event(ev, scenario, env):
    src = ev.get("source")
    if src not in WEBHOOKS:
        raise HarnessError(f"event source must be one of {', '.join(WEBHOOKS)}, not {src!r}")
    if src == "replay":
        raw, ctype = json.dumps(ev.get("body") or {}).encode(), "application/json"
        headers = {"X-Replay-Secret": env["REPLAY_SECRET"]}
    else:
        raw, ctype = (build_twilio(ev, scenario, env) if src == "twilio"
                      else (build_meta if src == "meta" else build_slack)(ev, scenario))
        headers = sign(ev, raw, env, ev.get("clock", scenario["now"]))
    headers["Content-Type"] = ctype
    status, out = http("POST", N8N_BASE + WEBHOOKS[src], headers=headers, raw=raw)
    if status == 404:
        raise HarnessError(f"{WEBHOOKS[src]} is not registered on the dry-run instance (workflow missing or unpublished)")
    if status == 0:
        raise HarnessError(f"could not reach n8n at {N8N_BASE}: {out}")
    return status


# --- checks -------------------------------------------------------------------
def check(expect, inst, calls):
    """Returns a list of failure messages (empty means the scenario passed)."""
    fails = []
    unknown = set(expect) - EXPECT_KEYS
    if unknown:
        return [f"unknown expect keys: {', '.join(sorted(unknown))}"]
    log = inst.rows("message_log") if {"route", "problems"} & set(expect) else []

    if "route" in expect:
        routes = [r.get("route") for r in log if r.get("route")]
        if expect["route"] not in routes:
            fails.append(f"route: expected {expect['route']!r}, message_log has {routes}")

    if "problems" in expect:
        got = set()
        for r in log:
            if r.get("problems"):
                try:
                    got |= set(json.loads(r["problems"]))
                except (json.JSONDecodeError, TypeError):
                    fails.append(f"problems: message_log row {r.get('id')} has unparseable problems {r['problems']!r}")
        if got != set(expect["problems"]):
            fails.append(f"problems: expected {sorted(expect['problems'])}, got {sorted(got)}")

    if "sends" in expect:
        sent = [c for c in calls if c["service"] in ("meta", "twilio")]
        want = expect["sends"]
        if len(sent) != len(want):
            fails.append(f"sends: expected {len(want)}, got {len(sent)}: {[_send_text(c) for c in sent]}")
        for i, (w, c) in enumerate(zip(want, sent)):
            kind = "template" if c["request"].get("type") == "template" or c["request"].get("ContentSid") else "normal"
            if w.get("kind", "normal") != kind:
                fails.append(f"sends[{i}]: expected kind {w.get('kind', 'normal')}, got {kind}")
            if "text_contains" in w and w["text_contains"] not in _send_text(c):
                fails.append(f"sends[{i}]: {_send_text(c)!r} does not contain {w['text_contains']!r}")
            to = "".join(ch for ch in str(c["request"].get("to") or c["request"].get("To") or "") if ch.isdigit())
            if "to" in w and to != str(w["to"]):
                fails.append(f"sends[{i}]: sent to {to}, expected {w['to']}")
            if "via" in w and c["service"] != w["via"]:
                fails.append(f"sends[{i}]: sent via {c['service']}, expected {w['via']}")

    if "slack_posts" in expect:
        n = sum(1 for c in calls if c["service"] == "slack" and c["op"] == "post")
        if n != expect["slack_posts"]:
            fails.append(f"slack_posts: expected {expect['slack_posts']}, got {n}")

    if "hubspot_calls" in expect:
        n = sum(1 for c in calls if c["service"] == "hubspot")
        if n != expect["hubspot_calls"]:
            fails.append(f"hubspot_calls: expected {expect['hubspot_calls']}, got {n}")

    if "calls" in expect:  # { "service" = n } or { "service.op" = n }
        for key, n in expect["calls"].items():
            svc, _, op = key.partition(".")
            got = sum(1 for c in calls if c["service"] == svc and (not op or c["op"] == op))
            if got != n:
                fails.append(f"calls[{key}]: expected {n}, got {got}")

    for table, n in (expect.get("rows") or {}).items():
        if table not in inst.tables:
            fails.append(f"rows: unknown table {table!r}")
            continue
        got = len(inst.rows(table))
        if got != n:
            fails.append(f"rows[{table}]: expected {n}, got {got}")
    return fails


def _send_text(call):
    r = call["request"]
    if call["service"] == "twilio":
        return f"<template {r['ContentSid']}>" if r.get("ContentSid") else r.get("Body", "")
    if r.get("type") == "template":
        return f"<template {r.get('template', {}).get('name')}>"
    return (r.get("text") or {}).get("body", "")


# --- running ------------------------------------------------------------------
def mock_body(sc, tier):
    script = sc.get("script") or {}
    body = {"name": sc["name"], "now": sc["now"], "live_models": tier == "live",
            "jev": script.get("jev") or {}, "haiku": script.get("haiku") or [],
            "sheets": {"facts_dir": sc.get("facts", "tests/facts"), **(script.get("sheets") or {})}}
    for k in ("calendar", "slack", "hubspot", "meta", "twilio"):
        if k in script:
            body[k] = script[k]
    return body


def run_scenario(sc, inst, mock, env, tier):
    inst.clear_all()
    mock.load(mock_body(sc, tier))
    for i, ev in enumerate(sc.get("event") or []):
        ev = {**ev, "_index": i}
        if "clock" in ev:  # move the scenario clock before this event (minimum notice, 24-hour window)
            mock.set_clock(ev["clock"])
        status = send_event(ev, sc, env)
        if "status" in ev and status != ev["status"]:
            return [f"event {i}: webhook answered {status}, expected {ev['status']}"]
        if ev.get("wait", True):
            inst.wait_idle()
    inst.wait_idle()
    # Every event must end done or duplicate. A failed row is one the processor gave up on, for example
    # a sub-workflow that returned no items and left the run holding its lease until it expired.
    failed = [r.get("kind") for r in inst.rows("inbox") if r.get("status") == "failed"]
    if failed:
        return [f"inbox: {len(failed)} event(s) ended failed: {failed}"]
    expect = dict(sc.get("expect") or {})
    if tier == "live":  # model output varies, so only the outcome is checked, not the wording
        for s in expect.get("sends", []):
            s.pop("text_contains", None)
    return check(expect, inst, mock.calls())


def select(scenarios, args, upto):
    limit = STEPS.index(upto)
    mine = [s for s in scenarios if s.get("provider", "meta") == args.provider]
    out = [s for s in mine if STEPS.index(s["step"]) <= limit]
    if args.only:
        out = [s for s in mine if s["name"] in args.only]
        missing = set(args.only) - {s["name"] for s in out}
        if missing:
            sys.exit(f"No scenario named {', '.join(sorted(missing))}")
    return out


def validate(data):
    names, errors = set(), []
    for s in data.get("scenario", []):
        n = s.get("name", "?")
        if n in names:
            errors.append(f"duplicate scenario name {n}")
        names.add(n)
        for key in ("name", "step", "now"):
            if key not in s:
                errors.append(f"{n}: missing {key}")
        if s.get("provider", "meta") not in PROVIDERS:
            errors.append(f"{n}: provider must be one of {', '.join(PROVIDERS)}")
        if s.get("step") not in STEPS:
            errors.append(f"{n}: step must be one of {', '.join(STEPS)}")
        try:
            _ts(s.get("now", ""))
        except ValueError:
            errors.append(f"{n}: now must be an ISO time, got {s.get('now')!r}")
        for g in s.get("guards", []):
            if g not in GUARDS:
                errors.append(f"{n}: unknown guard {g!r}")
        for i, ev in enumerate(s.get("event", [])):
            if ev.get("source") in ("meta", "slack_events", "slack_actions") and not (ROOT / ev.get("fixture", "-")).is_file():
                errors.append(f"{n}: event {i} fixture {ev.get('fixture')!r} not found")
    if errors:
        sys.exit("tests/scenarios.toml is invalid:\n  " + "\n  ".join(errors))


# Section 13 guard IDs (M = 33: sig_twilio came with the Twilio route).
GUARDS = [
    "sig_meta", "sig_slack", "sig_twilio", "dedup",
    "keyword_stop", "dnc", "optout_phrase", "human_owned", "closed",
    "hazard_opt_out", "hazard_wrong_person", "hazard_abusive", "hazard_prompt_injection",
    "hazard_wants_human", "missing_field", "offered_only",
    "dc_unsupported_fact", "dc_claims_action", "dc_promise", "dc_leaks_rules", "dc_off_brand",
    "dc_empty", "dc_too_long", "dc_follow_up", "dc_price", "dc_unknown_number",
    "send_dnc", "send_human_owned", "send_24h",
    "book_already", "book_allowed", "book_free", "zip_area",
]


def run_all(selected, inst, mock, env, tier, quiet=False):
    passed, results = 0, {}
    for sc in selected:
        try:
            fails = run_scenario(sc, inst, mock, env, tier)
        except HarnessError as e:
            fails = [f"harness: {e}"]
        results[sc["name"]] = fails
        passed += not fails
        if not quiet:
            print(f"  {'PASS' if not fails else 'FAIL'}  {sc['name']}")
            for f in fails:
                print(f"        {f}")
    return passed, results


def deploy(remove_guard=None):
    script = ROOT / "scripts" / "deploy_workflows.py"
    if not script.exists():
        sys.exit("--remove-guards needs scripts/deploy_workflows.py, which doesn't exist yet.")
    cmd = [sys.executable, str(script), "--instance", "dryrun"]
    if remove_guard:
        cmd += ["--remove-guard", remove_guard]
    subprocess.run(cmd, check=True)


def container_provider():
    r = subprocess.run(["docker", "exec", CONTAINER, "printenv", "WA_PROVIDER"], capture_output=True, text=True)
    return r.stdout.strip() or "meta"


def set_provider(provider):
    """Recreates the dry-run n8n container with WA_PROVIDER=provider and waits for its webhooks."""
    if container_provider() == provider:
        return
    print(f"recreating the dry-run n8n container with WA_PROVIDER={provider} ...", flush=True)
    subprocess.run(COMPOSE + ["up", "-d", "--no-deps", "n8n"], check=True, capture_output=True,
                   env={**os.environ, "WA_PROVIDER": provider})
    deadline = time.time() + 180
    while time.time() < deadline:
        try:
            status, out = http("GET", N8N_BASE + WEBHOOKS["twilio"], timeout=5)
        except OSError:  # the connection drops while n8n restarts
            status, out = 0, ""
        if status not in (0, 502, 503) and "POST" in str(out):  # "not registered for GET ... POST request?"
            break
        time.sleep(2)
    else:
        sys.exit("the dry-run n8n container did not come back with its webhooks registered")
    if container_provider() != provider:
        sys.exit(f"the dry-run n8n container has WA_PROVIDER={container_provider()}, expected {provider}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tier", choices=["fixed", "live"], default="fixed")
    ap.add_argument("--provider", choices=PROVIDERS, default="meta")
    ap.add_argument("--remove-guards", action="store_true")
    ap.add_argument("--upto", choices=STEPS)
    ap.add_argument("--only", nargs="+", metavar="SCENARIO")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--file", default=str(ROOT / "tests" / "scenarios.toml"))
    args = ap.parse_args()

    data = tomllib.loads(Path(args.file).read_text(encoding="utf-8"))
    validate(data)
    upto = args.upto or data.get("current_step", "P9")
    selected = select(data.get("scenario", []), args, upto)
    if args.list:
        for s in selected:
            print(f"{s['step']}  {s['name']}  guards={','.join(s.get('guards', [])) or '-'}")
        return 0
    if not selected:
        sys.exit(f"No scenarios selected (upto {upto}).")

    env = load_dryrun_env()
    mock = Mock(env["REPLAY_SECRET"])
    if mock.health()[0] != 200:
        sys.exit(f"Mock server not reachable at {MOCK_BASE}. Start the dry-run stack (deploy/docker-compose.dryrun.yml).")
    inst = Instance()
    if args.remove_guards and args.provider != "meta":
        sys.exit("--remove-guards runs on the meta provider only.")
    try:
        set_provider(args.provider)
        return run(args, selected, upto, inst, mock, env)
    finally:
        if args.provider != "meta":
            set_provider("meta")


def run(args, selected, upto, inst, mock, env):
    if not args.remove_guards:
        print(f"{args.tier} tier, " + (f"{len(selected)} named scenario(s):" if args.only else f"scenarios up to {upto}:"))
        passed, _ = run_all(selected, inst, mock, env, args.tier)
        label = args.tier + (" tier, twilio provider" if args.provider == "twilio" else " tier")
        print(f"{label}: passed {passed} of {len(selected)}")
        return 0 if passed == len(selected) else 1

    guards = sorted({g for s in selected for g in s.get("guards", [])}, key=GUARDS.index)
    uncovered = [g for g in GUARDS if g not in guards]
    caught = 0
    try:
        for g in guards:
            deploy(remove_guard=g)
            tagged = [s for s in selected if g in s.get("guards", [])]
            _, results = run_all(tagged, inst, mock, env, "fixed", quiet=True)
            failed = [n for n, f in results.items() if f]
            caught += bool(failed)
            print(f"  {'caught' if failed else 'MISSED'}  {g}: {len(failed)} of {len(tagged)} tagged scenarios failed")
    finally:
        deploy()  # put every guard back
    print(f"{caught} of {len(GUARDS)} guards caused their scenario to fail when removed")
    if uncovered:
        print(f"  no scenario tagged with: {', '.join(uncovered)}")
    return 0 if caught == len(GUARDS) else 1


def _ts(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


def _set_path(obj, dotted, value):
    keys = dotted.split(".")
    for k in keys[:-1]:
        obj = obj[int(k)] if isinstance(obj, list) else obj.setdefault(k, {})
    last = keys[-1]
    if isinstance(obj, list):
        obj[int(last)] = value
    else:
        obj[last] = value


if __name__ == "__main__":
    sys.exit(main())
