#!/usr/bin/env python3
"""Adapter contract test (design file 31, section 13). Run by hand before each live-tier run.

Sends the same inputs to each adapter on the live instance (test calendar, test sheet, test channel,
HubSpot test account) and to its fake on the dry-run instance. Each output is checked against the
section 13 contract, and the live and fake outputs must have the same keys and types.

    python tests/adapter_contract.py                    # live and fake, compared with each other
    python tests/adapter_contract.py --instance dryrun  # fakes only, against the contract
    python tests/adapter_contract.py --instance live    # live adapters only, against the contract
    python tests/adapter_contract.py --only hubspot     # one adapter

How it calls an adapter: adapters start with an Execute Workflow trigger, so the script imports a
short-lived probe workflow (Webhook -> Execute Workflow by ID -> Respond to Webhook) on a random
webhook path, calls it once per operation, and deletes it afterwards.

Side effects on live: one calendar event, one log-sheet row, one Slack post (reacted to and edited),
one HubSpot contact and one deal. Point the live instance at test accounts before running it.

Reads deploy/scripts.env (API URL and key per instance), deploy/live.env (SLACK_CHANNEL_ID,
HUBSPOT_STAGE_ENQUIRY, HUBSPOT_STAGE_BOOKED) and deploy/dryrun.env (REPLAY_SECRET).
Exit code 0 only when every operation matched.
"""
import argparse
import hashlib
import json
import secrets
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "tests"))
import setup_tables  # noqa: E402
from replay import MOCK_BASE, http  # noqa: E402

ADAPTERS = ["calendar", "sheets", "slack", "hubspot"]
ERROR_KINDS = {"unavailable", "not_found", "conflict", "invalid"}
TEST_PHONE = "+15550009999"

# Section 13: the keys each operation returns when ok, with the allowed types.
# "?" after a type name means null is allowed too.
CONTRACT = {
    ("calendar", "busy"): {"busy": "list"},
    ("calendar", "get_event"): {"found": "bool", "status": "str?", "start": "str?", "end": "str?"},
    ("calendar", "create_event"): {"event_id": "str"},
    ("sheets", "read_facts"): {"facts": "list", "prices": "list", "service_areas": "list", "hours": "list", "version": "str"},
    ("sheets", "append_log"): {},
    ("slack", "post"): {"ts": "str"},
    ("slack", "react"): {},
    ("slack", "update"): {},
    ("hubspot", "find_contact"): {"contact_id": "str?"},
    ("hubspot", "create_contact"): {"contact_id": "str"},
    ("hubspot", "create_deal"): {"deal_id": "str"},
    ("hubspot", "move_deal"): {},
}
TYPES = {"list": list, "bool": bool, "str": str, "dict": dict, "number": (int, float)}


def type_name(v):
    if v is None:
        return "null"
    for name, t in (("bool", bool), ("number", (int, float)), ("str", str), ("list", list), ("dict", dict)):
        if isinstance(v, t):
            return name
    return type(v).__name__


def shape(out):
    """{key: type name} of a result, so a live and a fake output can be compared."""
    if not isinstance(out, dict):
        return {"<not an object>": type_name(out)}
    return {k: type_name(v) for k, v in out.items()}


def contract_problems(adapter, op, out, expect_error=None):
    """Checks one output against section 13. Returns a list of problems."""
    if not isinstance(out, dict):
        return [f"output is not an object: {str(out)[:200]}"]
    if out.get("ok") is False:
        err = out.get("error")
        if not isinstance(err, dict) or err.get("kind") not in ERROR_KINDS or not isinstance(err.get("message"), str):
            return [f"ok is false but error is not {{ kind, message }} with a known kind: {err}"]
        if expect_error and err["kind"] != expect_error:
            return [f"expected error kind {expect_error}, got {err['kind']}: {err['message']}"]
        if not expect_error:
            return [f"failed: {err['kind']}: {err['message']}"]
        return []
    if out.get("ok") is not True:
        return [f"ok must be true or false, got {out.get('ok')!r}"]
    if expect_error:
        return [f"expected an error of kind {expect_error}, got ok"]
    problems = []
    for key, want in CONTRACT[(adapter, op)].items():
        if key not in out:
            problems.append(f"missing key {key}")
            continue
        nullable = want.endswith("?")
        base = want.rstrip("?")
        v = out[key]
        if v is None and nullable:
            continue
        if not isinstance(v, TYPES[base]) or (base == "number" and isinstance(v, bool)):
            problems.append(f"{key} should be {want}, got {type_name(v)}")
    return problems


# --- the probe workflow --------------------------------------------------------
def probe_workflow(path):
    return {
        "name": f"adapter-contract-probe-{path[-6:]}",
        "settings": {"executionOrder": "v1"},
        "connections": {
            "probe:webhook": {"main": [[{"node": "probe:input", "type": "main", "index": 0}]]},
            "probe:input": {"main": [[{"node": "probe:adapter", "type": "main", "index": 0}]]},
            "probe:adapter": {"main": [[{"node": "probe:respond", "type": "main", "index": 0}]]},
        },
        "nodes": [
            {"id": "a0c1f7e2-0001-4000-8000-000000000001", "name": "probe:webhook", "type": "n8n-nodes-base.webhook",
             "typeVersion": 2.1, "position": [0, 0], "webhookId": path,
             "parameters": {"httpMethod": "POST", "path": path, "responseMode": "responseNode", "options": {}}},
            {"id": "a0c1f7e2-0001-4000-8000-000000000002", "name": "probe:input", "type": "n8n-nodes-base.code",
             "typeVersion": 2, "position": [220, 0],
             "parameters": {"jsCode": "return [{ json: $input.first().json.body.input }];"}},
            {"id": "a0c1f7e2-0001-4000-8000-000000000003", "name": "probe:adapter", "type": "n8n-nodes-base.executeWorkflow",
             "typeVersion": 1.2, "position": [440, 0],
             "parameters": {"source": "database", "mode": "once", "options": {"waitForSubWorkflow": True},
                            "workflowId": {"__rl": True, "mode": "id",
                                           "value": "={{ $('probe:webhook').first().json.body.workflow_id }}"}}},
            {"id": "a0c1f7e2-0001-4000-8000-000000000004", "name": "probe:respond", "type": "n8n-nodes-base.respondToWebhook",
             "typeVersion": 1.1, "position": [660, 0],
             "parameters": {"respondWith": "firstIncomingItem", "options": {}}},
        ],
    }


class Probe:
    """Imports the probe workflow on one instance, calls adapters through it, deletes it on exit."""

    def __init__(self, instance):
        self.instance = instance
        self.api = setup_tables.Api(instance)
        self.webhook_base = self.api.base.rsplit("/api/", 1)[0]
        self.path = "adapter-contract-" + secrets.token_hex(8)
        self.adapter_ids = self._adapter_ids()
        self.wf_id = None

    def _adapter_ids(self):
        ids, cursor = {}, None
        while True:
            q = {"limit": 250}
            if cursor:
                q["cursor"] = cursor
            page = self.api.must("GET", "/workflows", query=q)
            for wf in page.get("data", []):
                if wf["name"].endswith("-adapter"):
                    ids[wf["name"][: -len("-adapter")]] = wf["id"]
            cursor = page.get("nextCursor")
            if not cursor:
                return ids

    def __enter__(self):
        wf = self.api.must("POST", "/workflows", probe_workflow(self.path))
        self.wf_id = wf["id"]
        self.api.must("POST", f"/workflows/{self.wf_id}/activate")
        time.sleep(1)  # let the webhook register
        return self

    def __exit__(self, *exc):
        if not self.wf_id:
            return
        self.api.call("POST", f"/workflows/{self.wf_id}/deactivate")
        for _ in range(5):  # a delete straight after the deactivate can be refused while it settles
            time.sleep(1)
            status, _ = self.api.call("DELETE", f"/workflows/{self.wf_id}")
            if status < 300 or status == 404:
                return
        print(f"warning: could not delete the probe workflow {self.wf_id} on {self.instance}; delete it by hand")

    def call(self, adapter, request):
        if adapter not in self.adapter_ids:
            return {"<harness>": f"no {adapter}-adapter workflow on {self.instance}"}
        status, out = http("POST", f"{self.webhook_base}/webhook/{self.path}",
                           {"workflow_id": self.adapter_ids[adapter], "input": request}, timeout=60)
        if status != 200:
            return {"<harness>": f"probe answered {status}: {str(out)[:300]}"}
        return out


# --- the operations ------------------------------------------------------------
def steps(env, run_id):
    """Each step: (adapter, op, build(request context) -> request, expected error kind or None).
    Later steps read IDs that earlier steps returned, from ctx."""
    start = (datetime.now(timezone.utc) + timedelta(days=20)).replace(hour=15, minute=0, second=0, microsecond=0)
    end = start + timedelta(hours=2)
    iso = lambda d: d.isoformat().replace("+00:00", "Z")
    event_id = hashlib.sha256(f"contract:{run_id}".encode()).hexdigest()
    channel = env.get("SLACK_CHANNEL_ID") or "C0CONTRACT"
    enquiry = env.get("HUBSPOT_STAGE_ENQUIRY") or "enquiry"
    booked = env.get("HUBSPOT_STAGE_BOOKED") or "booked"
    return [
        ("calendar", "busy", lambda c: {"op": "busy", "from": iso(start - timedelta(days=1)), "to": iso(end + timedelta(days=1))}, None),
        ("calendar", "get_event", lambda c: {"op": "get_event", "event_id": "0" * 32}, None),
        ("calendar", "create_event", lambda c: {"op": "create_event", "event_id": event_id, "start": iso(start), "end": iso(end),
                                                "summary": "Contract test", "description": f"adapter_contract.py run {run_id}",
                                                "location": "12 Main St, New York NY 10001"}, None),
        ("calendar", "get_event", lambda c: {"op": "get_event", "event_id": event_id}, None),
        ("calendar", "create_event", lambda c: {"op": "create_event", "event_id": event_id, "start": iso(start), "end": iso(end),
                                                "summary": "Contract test", "description": "duplicate", "location": ""}, "conflict"),
        ("sheets", "read_facts", lambda c: {"op": "read_facts"}, None),
        ("sheets", "append_log", lambda c: {"op": "append_log", "row": {
            "logged_at": iso(datetime.now(timezone.utc)), "wa_id": "*******9999", "direction": "event", "author": "system",
            "kind": "contract_test", "text": f"adapter_contract.py run {run_id}"}}, None),
        ("slack", "post", lambda c: {"op": "post", "channel": channel, "text": f"Adapter contract test {run_id}"}, None),
        ("slack", "react", lambda c: {"op": "react", "channel": channel, "ts": c.get("slack.post.ts", ""), "name": "white_check_mark"}, None),
        ("slack", "update", lambda c: {"op": "update", "channel": channel, "ts": c.get("slack.post.ts", ""),
                                       "text": f"Adapter contract test {run_id} (edited)"}, None),
        ("hubspot", "find_contact", lambda c: {"op": "find_contact", "phone": TEST_PHONE}, None),
        ("hubspot", "create_contact", lambda c: {"op": "create_contact", "phone": TEST_PHONE}, None),
        ("hubspot", "create_deal", lambda c: {"op": "create_deal", "contact_id": c.get("hubspot.create_contact.contact_id", ""),
                                              "stage": enquiry, "name": f"Contract test {run_id}"}, None),
        ("hubspot", "move_deal", lambda c: {"op": "move_deal", "deal_id": c.get("hubspot.create_deal.deal_id", ""), "stage": booked}, None),
        ("hubspot", "move_deal", lambda c: {"op": "move_deal", "deal_id": "999999999999", "stage": booked}, "not_found"),
    ]


def run_instance(instance, env, run_id, only):
    """Runs every step on one instance. Returns [(label, output, problems)]."""
    results, ctx = [], {}
    with Probe(instance) as probe:
        for adapter, op, build, expect_error in steps(env, run_id):
            if only and adapter not in only:
                continue
            label = f"{adapter}.{op}" + (f" ({expect_error})" if expect_error else "")
            out = probe.call(adapter, build(ctx))
            if isinstance(out, dict) and "<harness>" in out:
                results.append((label, out, [out["<harness>"]]))
                continue
            if isinstance(out, dict) and out.get("ok") is True:
                for k, v in out.items():
                    ctx.setdefault(f"{adapter}.{op}.{k}", v)
            results.append((label, out, contract_problems(adapter, op, out, expect_error)))
    return results


def load_mock_scenario(dry_env):
    status, out = http("POST", MOCK_BASE + "/_scenario",
                       {"name": "adapter_contract", "now": datetime.now(timezone.utc).isoformat(), "sheets": {"facts_dir": "tests/facts"}},
                       {"X-Replay-Secret": dry_env.get("REPLAY_SECRET", "")})
    if status != 200:
        sys.exit(f"Mock server not reachable or refused the scenario ({status}): {out}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--instance", choices=["dryrun", "live", "both"], default="both")
    ap.add_argument("--only", nargs="+", choices=ADAPTERS)
    args = ap.parse_args()

    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    instances = ["live", "dryrun"] if args.instance == "both" else [args.instance]
    live_env = setup_tables.load_env(ROOT / "deploy" / "live.env") if "live" in instances else {}
    results = {}
    for inst in instances:
        if inst == "dryrun":
            dry_env = setup_tables.load_env(ROOT / "deploy" / "dryrun.env")
            load_mock_scenario(dry_env)
            results[inst] = run_instance(inst, {**dry_env, **live_env}, run_id, args.only)
        else:
            results[inst] = run_instance(inst, live_env, run_id, args.only)

    failures = 0
    for inst, rows in results.items():
        print(f"{inst}:")
        for label, out, problems in rows:
            print(f"  {'PASS' if not problems else 'FAIL'}  {label}")
            for p in problems:
                print(f"        {p}")
            failures += bool(problems)

    if len(results) == 2:
        print("live vs fake:")
        for (label, lo, _), (_, fo, _) in zip(results["live"], results["dryrun"]):
            ls, fs = shape(lo), shape(fo)
            # error outputs are compared by kind; ok outputs by keys and types (null matches any type)
            if lo.get("ok") is False or fo.get("ok") is False:
                same = (lo.get("error") or {}).get("kind") == (fo.get("error") or {}).get("kind")
                diff = "" if same else f"error kinds differ: live {lo.get('error')}, fake {fo.get('error')}"
            else:
                bad = sorted(k for k in set(ls) | set(fs)
                             if ls.get(k) != fs.get(k) and "null" not in (ls.get(k), fs.get(k)))
                diff = "" if not bad else "; ".join(f"{k}: live {ls.get(k, 'missing')}, fake {fs.get(k, 'missing')}" for k in bad)
            print(f"  {'SAME' if not diff else 'DIFF'}  {label}")
            if diff:
                print(f"        {diff}")
                failures += 1

    total = sum(len(r) for r in results.values())
    print(f"adapter contract: {total - failures} of {total} checks passed" if len(results) == 1
          else f"adapter contract: {failures} problem(s)")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
