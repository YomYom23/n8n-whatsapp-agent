#!/usr/bin/env python3
"""Creates or updates the n8n data tables of design section 14 through the n8n public API.

Adds missing tables and missing columns. It never drops a table or a column, and never
changes the type of an existing column (a mismatch is reported as a warning).

Reads deploy/scripts.env (keys N8N_API_URL_<INSTANCE> and N8N_API_KEY_<INSTANCE>).

    python scripts/setup_tables.py                          # dryrun instance, branch b
    python scripts/setup_tables.py --instance live
    python scripts/setup_tables.py --branch a               # no branch B columns, no processor_lease
    python scripts/setup_tables.py --clear inbox            # delete all rows of one table
    python scripts/setup_tables.py --prefix zz_test_        # every table name gets the prefix
"""
import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]

S, N, B, D = "string", "number", "boolean", "date"

# Section 14. "JSON" columns are strings holding serialised JSON.
TABLES = {
    "conversations": [
        ("wa_id", S), ("stage", S), ("stage_version", N), ("stage_before_close", S),
        ("closed_reason", S), ("close_thread_ts", S), ("service", S), ("address", S), ("zip", S),
        ("offered_slots", S), ("last_offered_day", D), ("reoffer_used", B), ("slot_taken_count", N),
        ("unclear_in_a_row", N), ("zip_asks", N), ("human_owned", B), ("handoff_reason", S),
        ("handoff_episode", N), ("slack_channel", S), ("slack_thread_ts", S), ("last_customer_at", D),
        ("last_bot_question", S), ("booked_event_id", S), ("booked_label", S),
        ("hubspot_contact_id", S), ("hubspot_deal_id", S), ("deal_stage", S),
    ],
    "inbox": [
        ("external_id", S), ("source", S), ("kind", S), ("wa_id", S), ("slack_thread_ts", S),
        ("received_at", D),
    ],
    "do_not_contact": [("wa_id", S), ("source", S), ("added_at", D)],
    "pending_owner_messages": [
        ("wa_id", S), ("handoff_episode", N), ("slack_thread_ts", S), ("slack_ts", S),
        ("slack_user", S), ("text", S), ("status", S), ("template_sent_at", D), ("created_at", D),
    ],
    "message_log": [
        ("logged_at", D), ("wa_id", S), ("direction", S), ("author", S), ("kind", S), ("text", S),
        ("route", S), ("stage", S), ("classifier", S), ("draft", S), ("problems", S),
        ("facts_version", S), ("execution_id", S), ("workflow_version", S), ("input_tokens", N),
        ("output_tokens", N), ("reply_ms", N),
    ],
}

# Branch B only (section 14).
BRANCH_B_INBOX_COLUMNS = [("status", S), ("execution_id", S), ("payload", S)]
PROCESSOR_LEASE = [("name", S), ("holder", S), ("expires_at", D)]


def table_specs(branch):
    specs = {name: list(cols) for name, cols in TABLES.items()}
    if branch == "b":
        specs["inbox"] += BRANCH_B_INBOX_COLUMNS
        specs["processor_lease"] = list(PROCESSOR_LEASE)
    return specs


def load_env(path):
    if not path.exists():
        sys.exit(f"Missing {path}. Copy deploy/scripts.env.example to deploy/scripts.env and add the API key.")
    env = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


class Api:
    def __init__(self, instance):
        env = load_env(REPO / "deploy" / "scripts.env")
        suffix = instance.upper()
        try:
            self.base = env[f"N8N_API_URL_{suffix}"].rstrip("/")
            self.key = env[f"N8N_API_KEY_{suffix}"]
        except KeyError as e:
            sys.exit(f"deploy/scripts.env has no {e.args[0]}")
        if not self.key:
            sys.exit(f"N8N_API_KEY_{suffix} is empty in deploy/scripts.env")

    def call(self, method, path, body=None, query=None):
        """Returns (status, parsed JSON or text). Never raises on HTTP errors."""
        url = self.base + path
        if query:
            url += "?" + urllib.parse.urlencode(query)
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("X-N8N-API-KEY", self.key)
        req.add_header("Accept", "application/json")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, _parse(r.read())
        except urllib.error.HTTPError as e:
            return e.code, _parse(e.read())

    def must(self, method, path, body=None, query=None):
        status, out = self.call(method, path, body, query)
        if status >= 300:
            sys.exit(f"{method} {path} -> {status}: {str(out)[:500]}")
        return out

    def find_table(self, name):
        """Exact-name lookup (the API filter may match loosely, so the result is checked)."""
        out = self.must("GET", "/data-tables", query={"filter": json.dumps({"name": name}), "limit": 250})
        for table in out.get("data", []):
            if table["name"] == name:
                return table
        return None

    def create_table(self, name, columns):
        return self.must("POST", "/data-tables", {"name": name, "columns": [{"name": c, "type": t} for c, t in columns]})

    def add_column(self, table_id, column, ctype):
        return self.must("POST", f"/data-tables/{table_id}/columns", {"name": column, "type": ctype})

    def clear_rows(self, table_id):
        return self.must("DELETE", f"/data-tables/{table_id}/rows/clear")


def _parse(raw):
    text = raw.decode("utf-8", "replace")
    try:
        return json.loads(text) if text else None
    except json.JSONDecodeError:
        return text


def ensure_table(api, name, columns):
    """Creates the table or adds its missing columns. Returns the number of changes made."""
    table = api.find_table(name)
    if table is None:
        api.create_table(name, columns)
        print(f"created table {name} ({len(columns)} columns)")
        return 1
    existing = {c["name"]: c["type"] for c in table.get("columns", [])}
    changes = 0
    for column, ctype in columns:
        if column not in existing:
            api.add_column(table["id"], column, ctype)
            print(f"added column {name}.{column} ({ctype})")
            changes += 1
        elif existing[column] != ctype:
            print(f"WARNING: {name}.{column} is {existing[column]}, design says {ctype}; left unchanged")
    return changes


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--instance", choices=["live", "dryrun"], default="dryrun")
    ap.add_argument("--branch", choices=["a", "b"], default="b",
                    help="b (default) adds the branch B inbox columns and processor_lease")
    ap.add_argument("--clear", metavar="TABLE", help="delete all rows of TABLE (never drops the table) and exit")
    ap.add_argument("--prefix", default="", help="prepended to every table name, for testing")
    args = ap.parse_args()

    api = Api(args.instance)
    specs = table_specs(args.branch)

    if args.clear:
        if args.clear not in specs:
            sys.exit(f"Unknown table {args.clear!r}. Known: {', '.join(specs)}")
        name = args.prefix + args.clear
        table = api.find_table(name)
        if table is None:
            sys.exit(f"Table {name} does not exist on {args.instance}")
        api.clear_rows(table["id"])
        print(f"cleared all rows of {name}")
        return

    changes = sum(ensure_table(api, args.prefix + name, cols) for name, cols in specs.items())
    if changes == 0:
        print(f"nothing to change on {args.instance} (branch {args.branch})")


if __name__ == "__main__":
    main()
