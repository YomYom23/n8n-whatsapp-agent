#!/usr/bin/env python3
"""Imports the repo's workflows into an n8n instance (design file 21, section 13).

    python scripts/deploy_workflows.py --instance dryrun
    python scripts/deploy_workflows.py --instance dryrun --remove-guard dc_price
    python scripts/deploy_workflows.py --instance live
    python scripts/deploy_workflows.py --instance dryrun --stage-only    # build .staging/, import nothing

Builds .staging/workflows/ from workflows/ and, for dry-run, changes it first:
  - each adapter is replaced by its fake from workflows/fakes/, and ingress-replay is added;
  - HTTP Request URLs to graph.facebook.com and api.anthropic.com point at {{ $env.MOCK_URL }};
  - every clock:now node becomes an HTTP Request to the mock's /_clock;
  - each --remove-guard <id> replaces guard:<id> with a pass-through to its false output, or deletes
    '<id>' from the Code nodes' // @guards lines (an ID found in neither place is an error).
A live deploy refuses ingress-replay, fakes and anything that mentions the mock server.

Then it resolves credential names to IDs (n8n export:credentials, IDs and names only) and
__table:<name>__ to data-table IDs (public API), imports with "n8n import:workflow --separate"
(which keeps workflow IDs, spike 7) and publishes every workflow with a trigger, since import
unpublishes everything. On dry-run it also creates the "TypeSafe AI" credential with its base URL
set to the mock if it is missing (the public API can't set that field, spike 1).
"""
import argparse
import json
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import n8n_cli  # noqa: E402
import setup_tables  # noqa: E402
import workflow_lib as wl  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / "workflows"
FAKES = WORKFLOWS / "fakes"
STAGING = ROOT / ".staging"
STAGED = STAGING / "workflows"
STATE = STAGING / "dryrun_state.json"
CONTAINER_DIR = "/tmp/wa-staging"
TYPESAFE = ("typeSafeAiApi", "TypeSafe AI")


def load_dir(path, fake=False):
    out = {}
    for f in sorted(path.glob("*.json")) if path.exists() else []:
        wf = json.loads(f.read_text(encoding="utf-8"))
        if fake:
            wf["_fake"] = True
        out[wf["name"]] = wf
    return out


def build(instance, remove_guards):
    live = load_dir(WORKFLOWS)
    if instance == "live":
        workflows = list(live.values())
        reasons = wl.live_refusals(workflows)
        if reasons:
            raise wl.DeployError("refusing a live deploy:\n  " + "\n  ".join(reasons))
        return workflows
    fakes = load_dir(FAKES, fake=True)
    merged = {**live, **fakes}  # a fake replaces the live adapter of the same name
    for name, fake in fakes.items():
        if name in live and live[name]["id"] != fake["id"]:
            print("warning: %s has ID %s in workflows/ and %s in fakes/; the fake's ID is used"
                  % (name, live[name]["id"], fake["id"]))
    workflows = [wl.scripted_clock(wl.rewrite_hosts(wf)) for wf in merged.values()]
    for gid in remove_guards:
        hit = False
        for i, wf in enumerate(workflows):
            wf, a = wl.remove_guard_node(wf, gid)
            wf, b = wl.remove_guard_from_lists(wf, gid)
            workflows[i] = wf
            hit = hit or a or b
        if not hit:
            raise wl.DeployError("guard %r is not in any workflow (no guard:%s node, no @guards entry)" % (gid, gid))
    return workflows


def ensure_typesafe(creds, env):
    if TYPESAFE in creds:
        return creds
    mock = env.get("MOCK_URL", "http://mock:8765")
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "cred.json"
        p.write_text(json.dumps([{"id": "tsDryrunMock0001", "name": TYPESAFE[1], "type": TYPESAFE[0],
                                  "data": {"apiKey": "dryrun-placeholder", "baseUrl": mock}}]), encoding="utf-8")
        n8n_cli.cp_in("dryrun", p, "/tmp/wa-cred.json")
    try:
        n8n_cli.n8n("dryrun", "n8n", "import:credentials", "--input=/tmp/wa-cred.json")
    finally:
        n8n_cli.n8n("dryrun", "rm", "-f", "/tmp/wa-cred.json", user="root")
    print("created credential %r with base URL %s" % (TYPESAFE[1], mock))
    return n8n_cli.credentials("dryrun")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--instance", choices=["dryrun", "live"], required=True)
    ap.add_argument("--remove-guard", action="append", default=[], metavar="ID")
    ap.add_argument("--stage-only", action="store_true", help="build .staging/ and stop")
    args = ap.parse_args()
    if args.instance == "live" and args.remove_guard:
        sys.exit("--remove-guard is for the dry-run instance only.")

    try:
        workflows = build(args.instance, args.remove_guard)
    except wl.DeployError as e:
        sys.exit(str(e))
    if not workflows:
        sys.exit("No workflows in workflows/ to deploy.")

    api = setup_tables.Api(args.instance)
    table_ids = {t["name"]: t["id"] for t in api.must("GET", "/data-tables", query={"limit": 250}).get("data", [])}
    creds = n8n_cli.credentials(args.instance)
    if args.instance == "dryrun":
        creds = ensure_typesafe(creds, setup_tables.load_env(ROOT / "deploy" / "dryrun.env"))

    staged = []
    try:
        for wf in workflows:
            wf = {k: v for k, v in wf.items() if k != "_fake"}
            staged.append(wl.resolve(wf, creds, table_ids))
    except wl.DeployError as e:
        sys.exit("cannot resolve %s" % e)

    if STAGED.exists():
        shutil.rmtree(STAGED)
    STAGED.mkdir(parents=True)
    for wf in staged:
        (STAGED / wl.file_name(wf["name"])).write_text(json.dumps(wf, indent=2), encoding="utf-8")
    if args.instance == "dryrun":
        STATE.write_text(json.dumps({"removed_guards": args.remove_guard}), encoding="utf-8")
    print("staged %d workflow(s) in %s" % (len(staged), STAGED.relative_to(ROOT)))
    if args.stage_only:
        return

    n8n_cli.n8n(args.instance, "rm", "-rf", CONTAINER_DIR, user="root")
    n8n_cli.cp_in(args.instance, STAGED, CONTAINER_DIR)
    try:
        out = n8n_cli.n8n(args.instance, "n8n", "import:workflow", "--separate", "--input=" + CONTAINER_DIR)
    finally:
        n8n_cli.n8n(args.instance, "rm", "-rf", CONTAINER_DIR, user="root")
    print("\n".join(l for l in out.splitlines() if "license SDK" not in l and l.strip()))

    failed = []
    for wf in staged:
        if not wl.has_trigger(wf):
            continue
        status, body = api.call("POST", "/workflows/%s/activate" % wf["id"])
        if status >= 300:
            failed.append("%s: %s %s" % (wf["name"], status, str(body)[:300]))
        else:
            print("published %s" % wf["name"])
    if failed:
        sys.exit("could not publish:\n  " + "\n  ".join(failed))
    if args.remove_guard:
        print("guards removed on dryrun: %s (redeploy without --remove-guard to restore)" % ", ".join(args.remove_guard))


if __name__ == "__main__":
    main()
