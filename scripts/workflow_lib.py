"""Shared, pure workflow transforms for export_workflows.py and deploy_workflows.py (design file 21,
section 13). Nothing here touches the network or Docker, so tests/test_workflow_lib.py covers it all.
"""
import copy
import json
import re

# Section 3. Names are how the scripts recognise the project's workflows on an instance.
PROJECT_WORKFLOWS = {
    "ingress-whatsapp", "ingress-slack-events", "ingress-slack-interactivity", "ingress-replay",
    "processor", "conversation", "classify", "answer", "book", "handoff", "close", "owner-relay",
    "owner-release", "send", "log", "crm-sync", "sheets-log", "calendar-adapter", "sheets-adapter",
    "slack-adapter", "hubspot-adapter", "doctor", "error",
}
DRYRUN_ONLY = {"ingress-replay"}  # saved with the fakes, refused by a live deploy

LIVE_HOSTS = ["https://graph.facebook.com", "https://api.anthropic.com"]
MOCK_HOST_EXPR = "{{ $env.MOCK_URL }}"
MOCK_MARKERS = ["$env.MOCK_URL", "mock:8765"]

KEEP_KEYS = ("id", "name", "nodes", "connections", "settings")
VOLATILE_NODE_KEYS = ("credentials",)  # handled separately: ids dropped, names kept

TRIGGER_TYPES = {
    "n8n-nodes-base.webhook", "n8n-nodes-base.scheduleTrigger", "n8n-nodes-base.errorTrigger",
    "n8n-nodes-base.executeWorkflowTrigger",
}

CLOCK_NODE = "clock:now"
CLOCK_CODE = "return [{ json: { now: new Date().toISOString() } }];"
GUARDS_LINE = re.compile(r"^.*//\s*@guards\s*$", re.M)
TABLE_REF = re.compile(r"__table:([a-z_]+)__")


class DeployError(Exception):
    pass


def is_adapter(name):
    return name.endswith("-adapter")


def file_name(name):
    return name + ".json"


# --- export ---------------------------------------------------------------------------------------
def walk_strings(obj, fn):
    """Returns a copy of obj with fn applied to every string value (keys untouched)."""
    if isinstance(obj, dict):
        return {k: walk_strings(v, fn) for k, v in obj.items()}
    if isinstance(obj, list):
        return [walk_strings(v, fn) for v in obj]
    if isinstance(obj, str):
        return fn(obj)
    return obj


def normalise(wf, table_names_by_id):
    """API workflow -> file form: volatile fields dropped, credential IDs dropped (names kept),
    data-table IDs replaced by __table:<name>__, keys sorted for stable diffs."""
    out = {k: copy.deepcopy(wf[k]) for k in KEEP_KEYS if k in wf}
    for node in out.get("nodes", []):
        for ctype, cred in (node.get("credentials") or {}).items():
            node["credentials"][ctype] = {"name": cred.get("name")}
    out["nodes"] = sorted(out.get("nodes", []), key=lambda n: n.get("name", ""))
    def tables(s):
        # IDs are 16 random characters, so they are replaced inside expressions and code too
        for tid, tname in table_names_by_id.items():
            if tid in s:
                s = s.replace(tid, "__table:%s__" % tname)
        return s
    return walk_strings(out, tables)


def undo_dryrun_changes(wf, previous):
    """A workflow exported from the dry-run instance carries deploy's changes (mock hosts, the
    HTTP clock). Puts back each changed node from the previous file, matched by node ID.
    Raises DeployError for a changed node the previous file doesn't have."""
    prev_nodes = {n.get("id"): n for n in (previous or {}).get("nodes", [])}
    nodes = []
    for node in wf.get("nodes", []):
        changed = node.get("name") == CLOCK_NODE and node.get("type") != "n8n-nodes-base.code"
        changed = changed or any(m in json.dumps(node.get("parameters", {})) for m in MOCK_MARKERS)
        if not changed:
            nodes.append(node)
            continue
        old = prev_nodes.get(node.get("id"))
        if old is None:
            if node.get("name") == CLOCK_NODE:
                nodes.append(clock_code_node(node))
                continue
            raise DeployError("%s: node %r points at the mock server and has no earlier version to restore. "
                              "Type the live URL in the editor." % (wf.get("name"), node.get("name")))
        restored = copy.deepcopy(node)
        for key in ("type", "typeVersion", "parameters", "credentials"):
            if key in old:
                restored[key] = copy.deepcopy(old[key])
            else:
                restored.pop(key, None)
        nodes.append(restored)
    return {**wf, "nodes": nodes}


def clock_code_node(node):
    return {**{k: v for k, v in node.items() if k not in ("parameters", "type", "typeVersion", "credentials")},
            "type": "n8n-nodes-base.code", "typeVersion": 2, "parameters": {"jsCode": CLOCK_CODE}}


# --- deploy: dry-run changes ------------------------------------------------------------------------
def rewrite_hosts(wf):
    """HTTP Request URLs to Meta and Anthropic go to the mock server instead."""
    for node in wf.get("nodes", []):
        if node.get("type") != "n8n-nodes-base.httpRequest":
            continue
        url = node.get("parameters", {}).get("url")
        if not isinstance(url, str):
            continue
        for host in LIVE_HOSTS:
            if host in url:
                body = url[1:] if url.startswith("=") else url
                node["parameters"]["url"] = "=" + body.replace(host, MOCK_HOST_EXPR)
    return wf


def scripted_clock(wf):
    """Each clock:now node becomes an HTTP Request to the mock's /_clock, keeping its name and ID."""
    nodes = []
    for node in wf.get("nodes", []):
        if node.get("name") == CLOCK_NODE:
            node = {k: v for k, v in node.items() if k not in ("parameters", "type", "typeVersion", "credentials")}
            node.update({"type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2,
                         "parameters": {"url": "=" + MOCK_HOST_EXPR + "/_clock", "options": {}}})
        nodes.append(node)
    return {**wf, "nodes": nodes}


def remove_guard_node(wf, guard_id):
    """Replaces the If node guard:<id> with a pass-through to its false (pass) output.
    Returns (workflow, removed?)."""
    name = "guard:" + guard_id
    if not any(n.get("name") == name for n in wf.get("nodes", [])):
        return wf, False
    conns = copy.deepcopy(wf.get("connections", {}))
    outputs = (conns.pop(name, {}) or {}).get("main", [])
    pass_targets = outputs[1] if len(outputs) > 1 and outputs[1] else []
    for src, by_type in conns.items():
        for ctype, outs in by_type.items():
            for i, targets in enumerate(outs):
                new = []
                for t in targets or []:
                    if t.get("node") == name:
                        new.extend(copy.deepcopy(pass_targets))
                    else:
                        new.append(t)
                outs[i] = new
    nodes = [n for n in wf["nodes"] if n.get("name") != name]
    return {**wf, "nodes": nodes, "connections": conns}, True


def remove_guard_from_lists(wf, guard_id):
    """Deletes '<id>' from every '// @guards' line in Code nodes. Returns (workflow, removed?)."""
    removed = False
    quoted = re.escape("'%s'" % guard_id)
    item = re.compile(r"\s*,\s*%s|%s\s*,\s*|%s" % (quoted, quoted, quoted))
    for node in wf.get("nodes", []):
        code = node.get("parameters", {}).get("jsCode")
        if not isinstance(code, str):
            continue

        def fix(m):
            nonlocal removed
            line = m.group(0)
            new = item.sub("", line, count=1)
            removed = removed or new != line
            return new
        node["parameters"]["jsCode"] = GUARDS_LINE.sub(fix, code)
    return wf, removed


def guards_in(workflows):
    """Every guard ID present in the workflows (as a guard: node or in an @guards line)."""
    found = set()
    for wf in workflows:
        for node in wf.get("nodes", []):
            if node.get("name", "").startswith("guard:"):
                found.add(node["name"][len("guard:"):])
            code = node.get("parameters", {}).get("jsCode")
            if isinstance(code, str):
                for line in GUARDS_LINE.findall(code):
                    found.update(re.findall(r"'([a-z0-9_]+)'", line.split("//")[0]))
    return found


# --- deploy: resolving names to IDs -------------------------------------------------------------------
def resolve(wf, cred_ids, table_ids):
    """Fills credential IDs from (type, name) and replaces __table:<name>__ with table IDs."""
    missing = []
    for node in wf.get("nodes", []):
        for ctype, cred in (node.get("credentials") or {}).items():
            cid = cred_ids.get((ctype, cred.get("name")))
            if cid is None:
                missing.append("credential %r (%s) used by node %r" % (cred.get("name"), ctype, node.get("name")))
            else:
                node["credentials"][ctype] = {"id": cid, "name": cred.get("name")}

    def table(s):
        def sub(m):
            if m.group(1) not in table_ids:
                missing.append("data table %r" % m.group(1))
                return m.group(0)
            return table_ids[m.group(1)]
        return TABLE_REF.sub(sub, s)
    wf = walk_strings(wf, table)
    if missing:
        raise DeployError("%s: %s" % (wf.get("name"), "; ".join(sorted(set(missing)))))
    return wf


def live_refusals(workflows):
    """Reasons a set of workflows must not go to the live instance (section 13)."""
    reasons = []
    for wf in workflows:
        if wf.get("name") in DRYRUN_ONLY:
            reasons.append("%s is dry-run only" % wf["name"])
        text = json.dumps(wf)
        for marker in MOCK_MARKERS:
            if marker in text:
                reasons.append("%s mentions the mock server (%s)" % (wf.get("name"), marker))
        if wf.get("_fake"):
            reasons.append("%s is a fake adapter" % wf.get("name"))
    return reasons


def has_trigger(wf):
    return any(n.get("type") in TRIGGER_TYPES for n in wf.get("nodes", []))
