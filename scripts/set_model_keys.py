#!/usr/bin/env python3
"""Puts real Jev and Anthropic keys into the dry-run instance, for the live-model tier.

    python scripts/set_model_keys.py            # asks for both keys (input hidden)
    python scripts/set_model_keys.py --reset    # puts the made-up placeholder keys back

The dry-run "TypeSafe AI" credential carries a base URL pointing at the mock server, which the
editor can't show and would lose on save (spike 1), so the keys are set here through the n8n CLI,
keeping each credential's ID and that base URL. The mock passes live-tier calls through to the
real services with these keys; the fixed tier never forwards them.
Keys may also come from the env vars TYPESAFE_API_KEY and ANTHROPIC_API_KEY.
"""
import argparse
import getpass
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import n8n_cli  # noqa: E402
import setup_tables  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
TYPESAFE = ("typeSafeAiApi", "TypeSafe AI")
ANTHROPIC = ("httpHeaderAuth", "Anthropic")


def key(env_name, label, reset):
    if reset:
        return "dryrun-placeholder"
    value = os.environ.get(env_name) or getpass.getpass(f"{label} key (hidden): ")
    if not value.strip():
        sys.exit(f"No {label} key given.")
    return value.strip()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--reset", action="store_true", help="restore the placeholder keys")
    args = ap.parse_args()

    env = setup_tables.load_env(ROOT / "deploy" / "dryrun.env")
    creds = n8n_cli.credentials("dryrun")
    missing = [name for (ctype, name) in (TYPESAFE, ANTHROPIC) if (ctype, name) not in creds]
    if missing:
        sys.exit(f"Missing credential(s) {', '.join(missing)} on dryrun. Run scripts/deploy_workflows.py --instance dryrun first.")

    payload = [
        {"id": creds[TYPESAFE], "name": TYPESAFE[1], "type": TYPESAFE[0],
         "data": {"apiKey": key("TYPESAFE_API_KEY", "TypeSafe (Jev)", args.reset), "baseUrl": env.get("MOCK_URL", "http://mock:8765")}},
        {"id": creds[ANTHROPIC], "name": ANTHROPIC[1], "type": ANTHROPIC[0],
         "data": {"name": "x-api-key", "value": key("ANTHROPIC_API_KEY", "Anthropic", args.reset)}},
    ]
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "creds.json"
        p.write_text(json.dumps(payload), encoding="utf-8")
        n8n_cli.cp_in("dryrun", p, "/tmp/wa-model-creds.json")
    try:
        n8n_cli.n8n("dryrun", "n8n", "import:credentials", "--input=/tmp/wa-model-creds.json")
    finally:
        n8n_cli.n8n("dryrun", "rm", "-f", "/tmp/wa-model-creds.json", user="root")
    print("placeholder keys restored" if args.reset else "keys set; run: python tests/replay.py --tier live")
    return 0


if __name__ == "__main__":
    sys.exit(main())
