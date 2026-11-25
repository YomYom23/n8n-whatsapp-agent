#!/usr/bin/env python3
"""Saves the project's workflows from an n8n instance into the repo (design file 21).

    python scripts/export_workflows.py --instance dryrun              # all project workflows
    python scripts/export_workflows.py --instance live --only adapters

From dry-run: adapters and ingress-replay go to workflows/fakes/, everything else to workflows/.
From live: only the live adapters, saved to workflows/ under their fake's workflow ID, so callers
built against the fakes find them.

The workflows are read through the public API rather than "n8n export:workflow": the API returns
the same nodes and connections without a copy out of the container. Each file keeps only id, name,
nodes, connections and settings; credential IDs are dropped (names kept) and data-table IDs become
__table:<name>__. Changes deploy made on the dry-run instance (mock hosts, the HTTP clock) are put
back from the previous file. Workflows not named in design section 3 are skipped and listed.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import setup_tables  # noqa: E402
import workflow_lib as wl  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / "workflows"
FAKES = WORKFLOWS / "fakes"
STATE = ROOT / ".staging" / "dryrun_state.json"


def all_workflows(api):
    out, cursor = [], None
    while True:
        q = {"limit": 250}
        if cursor:
            q["cursor"] = cursor
        page = api.must("GET", "/workflows", query=q)
        out += page.get("data", [])
        cursor = page.get("nextCursor")
        if not cursor:
            return out


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def write_if_changed(path, wf):
    text = json.dumps(wf, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--instance", choices=["dryrun", "live"], required=True)
    ap.add_argument("--only", choices=["adapters"])
    args = ap.parse_args()
    if args.instance == "live" and args.only != "adapters":
        sys.exit("From live only the adapters are exported: add --only adapters (design: live is deployed from git).")
    if args.instance == "dryrun":
        state = read_json(STATE) or {}
        if state.get("removed_guards"):
            sys.exit("The dry-run instance has guards removed (%s). Run deploy_workflows.py --instance dryrun "
                     "without --remove-guard first, so the export doesn't save a workflow with a guard missing."
                     % ", ".join(state["removed_guards"]))

    api = setup_tables.Api(args.instance)
    tables = {t["id"]: t["name"] for t in api.must("GET", "/data-tables", query={"limit": 250}).get("data", [])}
    found, skipped, seen = [], [], {}
    for wf in all_workflows(api):
        name = wf.get("name", "")
        if wf.get("isArchived"):
            continue
        if name not in wl.PROJECT_WORKFLOWS:
            skipped.append(name)
            continue
        if name in seen:
            sys.exit("Two workflows on %s are named %r (%s and %s). Rename or archive one." % (args.instance, name, seen[name], wf["id"]))
        seen[name] = wf["id"]
        if args.only == "adapters" and not wl.is_adapter(name):
            continue
        found.append(wf)

    changed = 0
    for wf in sorted(found, key=lambda w: w["name"]):
        name = wf["name"]
        out = wl.normalise(wf, tables)
        if args.instance == "dryrun":
            dest = (FAKES if wl.is_adapter(name) or name in wl.DRYRUN_ONLY else WORKFLOWS) / wl.file_name(name)
            try:
                # fake adapters call the mock by design (their URL is the mock's), so nothing to undo
                if not wl.is_adapter(name):
                    out = wl.undo_dryrun_changes(out, read_json(dest))
            except wl.DeployError as e:
                sys.exit(str(e))
        else:
            dest = WORKFLOWS / wl.file_name(name)
            fake = read_json(FAKES / wl.file_name(name))
            if fake is None:
                print("warning: no fake for %s yet; keeping its live ID %s" % (name, out["id"]))
            else:
                out["id"] = fake["id"]
        if write_if_changed(dest, out):
            changed += 1
            print("saved %s" % dest.relative_to(ROOT))
    print("exported %d workflow(s) from %s, %d changed" % (len(found), args.instance, changed))
    if skipped:
        print("skipped (not project workflows): %s" % ", ".join(sorted(skipped)))
    if changed:
        print("next: npm run build && npm run check")


if __name__ == "__main__":
    main()
