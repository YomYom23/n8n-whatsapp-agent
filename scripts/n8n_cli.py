"""Docker and n8n CLI helpers shared by the deploy and export scripts."""
import json
import subprocess
import sys

CONTAINERS = {"dryrun": "wa-agent-dryrun-n8n-1", "live": "wa-agent-live-n8n-1"}


def run(cmd):
    """Runs a command; returns stdout. Exits with the command's output on failure."""
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        sys.exit("command failed: %s\n%s%s" % (" ".join(cmd), r.stdout[-2000:], r.stderr[-2000:]))
    return r.stdout


def n8n(instance, *args, user=None):
    cmd = ["docker", "exec"] + (["-u", user] if user else []) + [CONTAINERS[instance]] + list(args)
    return run(cmd)


def cp_in(instance, src, dest):
    run(["docker", "cp", str(src), "%s:%s" % (CONTAINERS[instance], dest)])


def json_from_cli(text):
    """The CLI prints licence notices before its JSON; returns the JSON part."""
    start = min([i for i in (text.find("["), text.find("{")) if i != -1] or [-1])
    if start == -1:
        return []
    return json.loads(text[start:])


def credentials(instance):
    """{(type, name): id} read from export:credentials (data stays encrypted and is ignored)."""
    out = n8n(instance, "n8n", "export:credentials", "--all")
    if "No credentials found" in out:
        return {}
    return {(c["type"], c["name"]): c["id"] for c in json_from_cli(out)}
