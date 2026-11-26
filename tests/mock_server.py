"""Mock server for the dry-run instance (design file 27).

Stands in for Meta's send API, TypeSafe (Jev), Anthropic and the four fake adapters,
records every call, and answers from the current scenario's script.

    python tests/mock_server.py [--host 127.0.0.1] [--port 8765]

Control API (header X-Replay-Secret must equal $REPLAY_SECRET when that is set):
    POST /_scenario   load a scenario (resets calls, queues, calendar and Slack state)
    GET  /_calls      [{ service, op, request, at }]
    GET  /_clock      { now }
    POST /_clock      { now }   move the scenario clock (for 24-hour window scenarios)

Service stand-ins (paths as the dry-run deployment rewrites them):
    POST /<version>/<phone_number_id>/messages        Meta send
    POST /v1/systemone                                TypeSafe System One (Jev)
    POST /v1/messages                                 Anthropic Messages
    POST /2010-04-01/Accounts/<sid>/Messages.json     Twilio send (the Twilio route), form body
    POST /adapter/{calendar,sheets,slack,hubspot}     fake adapters, body { op, ... }
    GET  /<version>/me, /me/permissions, /<phone_number_id>, /<waba_id>/subscribed_apps,
         /<waba_id>/message_templates, /<waba_id>    Graph reads made by the doctor workflow

Scenario body:
    { name, now, live_models,
      jev: { stage: [answers...], draft_check: [answers...] },
      haiku: [{ text, input_tokens, output_tokens }],
      calendar: { busy: [{start,end}], events: {id: {status,start,end,...}} },
      sheets: { facts_dir, unavailable },
      slack: { unavailable },
      hubspot: { unavailable, contacts: {phone: contact_id} },
      meta: { refuse_outside_window },
      twilio: { error: { code, message } },
      meta_setup: { token_expired, scopes: [...], phone: {...}, subscribed_apps: [...],
                    templates: [...], waba: {...} } }

meta_setup describes the Meta account the doctor reads; each key replaces the healthy default
(META_SETUP_DEFAULT) and phone and waba are merged field by field.

A Jev stage answer is { hazards: {name: p}, answer: {value, confidence},
price_service: {value, confidence}, price_hours: {value, confidence} }; hazards not listed
are 0.0 and price fields default to not_stated. A draft_check answer is { problems: {name: p} }.
Either may add "fail": "<message>" (HTTP 500) or "omit": ["field", ...] (field left out of
the response, for the missing-field guard). Answers are served in order per question set;
an empty queue is an HTTP 500, so a scenario that makes more calls than it scripted fails.
"""
import argparse
import csv
import hashlib
import itertools
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REAL_HOSTS = {"jev": "https://api.typesafe.ai", "anthropic": "https://api.anthropic.com"}
DRAFT_CHECK_MARKER = "unsupported_fact"  # a question ID only the draft-check set has
META_OUTSIDE_WINDOW = {"code": 131047, "title": "Re-engagement message",
                       "message": "Re-engagement message",
                       "error_data": {"details": "Message failed to send because more than 24 hours have passed since the customer last replied to this number."}}


META_SETUP_DEFAULT = {
    "token_expired": False,
    "scopes": ["whatsapp_business_messaging", "whatsapp_business_management"],
    "phone": {"display_phone_number": "+1 555-010-1234", "verified_name": "Sparkle Clean (demo)",
              "code_verification_status": "VERIFIED", "quality_rating": "GREEN", "platform_type": "CLOUD_API",
              "status": "CONNECTED", "health_status": {"can_send_message": "AVAILABLE", "entities": []}},
    "subscribed_apps": [{"whatsapp_business_api_data": {"id": "1", "name": "wa-agent (mock)"}}],
    "templates": [{"name": "enquiry_update", "status": "APPROVED", "category": "UTILITY", "language": "en_US", "id": "1"}],
    "waba": {"name": "Sparkle Clean (demo)", "account_review_status": "APPROVED",
             "health_status": {"can_send_message": "AVAILABLE", "entities": []}},
}
GRAPH_VERSION_PREFIX = "v"


def utcnow_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class State:
    def __init__(self):
        self.lock = threading.Lock()
        self.load({})

    def load(self, sc):
        self.scenario = sc
        self.now = sc.get("now") or utcnow_iso()
        self.calls = []
        jev = sc.get("jev") or {}
        self.jev = {"stage": list(jev.get("stage") or []), "draft_check": list(jev.get("draft_check") or [])}
        self.haiku = list(sc.get("haiku") or [])
        cal = sc.get("calendar") or {}
        self.busy = list(cal.get("busy") or [])
        self.events = dict(cal.get("events") or {})
        hub = sc.get("hubspot") or {}
        self.contacts = dict(hub.get("contacts") or {})
        self.deals = {}
        self.ids = itertools.count(1)
        self.slack_seq = itertools.count(1)

    def record(self, service, op, request):
        self.calls.append({"service": service, "op": op, "request": request, "at": self.now})

    def section(self, name):
        return self.scenario.get(name) or {}


STATE = State()


# --- TypeSafe (Jev) --------------------------------------------------------
def jev_response(questions, script):
    """Turns a scripted answer into a System One response for the asked questions."""
    omit = set(script.get("omit") or [])
    answers = {}
    for qid, q in questions.items():
        if qid in omit:
            continue
        qtype = q.get("type")
        if qtype == "noul":
            src = script.get("problems") if "problems" in script else script.get("hazards")
            answers[qid] = {"type": "noul", "noul": float((src or {}).get(qid, 0.0))}
        elif qtype == "choice":
            options = list((q.get("criteria") or {}).keys())
            picked = script.get(qid) or ({"value": "not_stated", "confidence": 1.0} if "not_stated" in options else None)
            if picked is None:
                picked = {"value": options[0] if options else None, "confidence": 0.0}
            conf = float(picked.get("confidence", 1.0))
            rest = [o for o in options if o != picked["value"]]
            probs = {o: 0.0 for o in options}
            probs[picked["value"]] = conf
            if rest:
                probs[rest[0]] = round(1.0 - conf, 6)
            answers[qid] = {"type": "choice", "choice": picked["value"], "confidence": conf, "probabilities": probs}
        elif qtype == "score":
            answers[qid] = {"type": "score", "score": float(script.get(qid, {}).get("value", 0)), "confidence": 1.0}
    return {"answers": answers, "model": "jev-mock", "usage": {"input_tokens": 0, "output_tokens": 0}}


# --- Sheets ------------------------------------------------------------------
def read_facts(facts_dir):
    base = (ROOT / facts_dir) if not Path(facts_dir).is_absolute() else Path(facts_dir)
    out, digest = {}, hashlib.sha256()
    for tab in ("facts", "prices", "service_areas", "hours"):
        path = base / f"{tab}.csv"
        raw = path.read_bytes()
        digest.update(raw)
        with path.open(newline="", encoding="utf-8") as f:
            out[tab] = [dict(r) for r in csv.DictReader(f)]
    out["version"] = digest.hexdigest()[:12]
    return out


def unavailable(message="service unavailable (scripted)"):
    return {"ok": False, "error": {"kind": "unavailable", "message": message}}


def adapter(name, body):
    st = STATE
    op = body.get("op")
    sec = st.section(name)
    if sec.get("unavailable"):
        return unavailable()
    if name == "calendar":
        if op == "busy":
            lo, hi = body.get("from", ""), body.get("to", "~")
            busy = [b for b in st.busy if b["end"] > lo and b["start"] < hi]
            busy += [{"start": e["start"], "end": e["end"]} for e in st.events.values()
                     if e.get("status") != "cancelled" and e["end"] > lo and e["start"] < hi]
            return {"ok": True, "busy": busy}
        if op == "get_event":
            e = st.events.get(body.get("event_id"))
            if not e:
                return {"ok": True, "found": False, "status": None, "start": None, "end": None}
            return {"ok": True, "found": True, "status": e.get("status", "confirmed"), "start": e["start"], "end": e["end"]}
        if op == "create_event":
            eid = body.get("event_id")
            if eid in st.events:
                return {"ok": False, "error": {"kind": "conflict", "message": "event id already exists"}}
            st.events[eid] = {k: body.get(k) for k in ("start", "end", "summary", "description", "location")}
            st.events[eid]["status"] = "confirmed"
            return {"ok": True, "event_id": eid}
    if name == "sheets":
        if op == "read_facts":
            try:
                return {"ok": True, **read_facts(sec.get("facts_dir") or "tests/facts")}
            except (OSError, csv.Error) as e:
                return unavailable(f"facts copy unreadable: {e}")
        if op == "append_log":
            return {"ok": True}
    if name == "slack":
        if op == "post":
            ts = f"1732480000.{next(st.slack_seq):06d}"
            return {"ok": True, "ts": ts}
        if op in ("react", "update"):
            return {"ok": True}
    if name == "hubspot":
        if op == "find_contact":
            return {"ok": True, "contact_id": st.contacts.get(body.get("phone"))}
        if op == "create_contact":
            cid = f"c{next(st.ids)}"
            st.contacts[body.get("phone")] = cid
            return {"ok": True, "contact_id": cid}
        if op == "create_deal":
            did = f"d{next(st.ids)}"
            st.deals[did] = {"contact_id": body.get("contact_id"), "stage": body.get("stage"), "name": body.get("name")}
            return {"ok": True, "deal_id": did}
        if op == "move_deal":
            if body.get("deal_id") not in st.deals:
                return {"ok": False, "error": {"kind": "not_found", "message": "no such deal"}}
            st.deals[body["deal_id"]]["stage"] = body.get("stage")
            return {"ok": True}
    return {"ok": False, "error": {"kind": "invalid", "message": f"unknown op {op!r} for {name}"}}


# --- HTTP --------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    server_version = "wa-agent-mock/1"

    def log_message(self, fmt, *args):  # keep the container log short
        print(f"{self.command} {self.path} -> {args[1] if len(args) > 1 else ''}", flush=True)

    def _json(self, status, obj):
        data = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b""
        try:
            return json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            return {"_raw": raw.decode("utf-8", "replace")}

    def _control_ok(self):
        secret = os.environ.get("REPLAY_SECRET")
        if secret and self.headers.get("X-Replay-Secret") != secret:
            self._json(403, {"error": "bad or missing X-Replay-Secret"})
            return False
        return True

    def do_GET(self):
        if self.path == "/_calls":
            if self._control_ok():
                with STATE.lock:
                    self._json(200, STATE.calls)
        elif self.path == "/_clock":
            with STATE.lock:
                self._json(200, {"now": STATE.now})
        elif self.path == "/_health":
            self._json(200, {"ok": True, "scenario": STATE.scenario.get("name")})
        elif self.path.split("/")[1][:1] == GRAPH_VERSION_PREFIX and self.path.split("/")[1][1:2].isdigit():
            with STATE.lock:
                self._graph_get()
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        try:
            self._post()
        except Exception as e:  # a mock bug must show up as a 500, not a dropped connection
            self._json(500, {"error": f"mock error: {type(e).__name__}: {e}"})

    def _post(self):
        body = self._body()
        path = self.path.split("?", 1)[0]
        parts = [p for p in path.split("/") if p]
        with STATE.lock:
            if path == "/_scenario":
                if self._control_ok():
                    STATE.load(body)
                    self._json(200, {"ok": True, "name": body.get("name")})
                return
            if path == "/_clock":
                if self._control_ok():
                    STATE.now = body.get("now") or STATE.now
                    self._json(200, {"now": STATE.now})
                return
            if len(parts) == 2 and parts[0] == "adapter":
                STATE.record(parts[1], body.get("op"), body)
                self._json(200, adapter(parts[1], body))
                return
            if path == "/v1/systemone":
                return self._jev(body)
            if path == "/v1/messages":
                return self._anthropic(body)
            if len(parts) == 3 and parts[2] == "messages":
                return self._meta(parts[1], body)
            if len(parts) == 4 and parts[:2] == ["2010-04-01", "Accounts"] and parts[3] == "Messages.json":
                return self._twilio(parts[2], body)
        self._json(404, {"error": f"no mock route for POST {path}"})

    # each of these runs with STATE.lock held
    def _jev(self, body):
        questions = body.get("questions") or {}
        qset = "draft_check" if DRAFT_CHECK_MARKER in questions else "stage"
        STATE.record("jev", qset, body)
        if STATE.scenario.get("live_models"):
            return self._passthrough("jev", "/v1/systemone", body)
        queue = STATE.jev[qset]
        if not queue:
            return self._json(500, {"detail": f"mock: no scripted Jev answer left for the {qset} set"})
        script = queue.pop(0)
        if script.get("fail"):
            return self._json(500, {"detail": script["fail"]})
        self._json(200, jev_response(questions, script))

    def _anthropic(self, body):
        STATE.record("anthropic", "messages", body)
        if STATE.scenario.get("live_models"):
            return self._passthrough("anthropic", "/v1/messages", body)
        if not STATE.haiku:
            return self._json(500, {"type": "error", "error": {"type": "api_error", "message": "mock: no scripted Haiku reply left"}})
        h = STATE.haiku.pop(0)
        self._json(200, {"id": f"msg_mock_{next(STATE.ids)}", "type": "message", "role": "assistant",
                         "model": body.get("model", "mock"), "stop_reason": "end_turn",
                         "content": [{"type": "text", "text": h.get("text", "")}],
                         "usage": {"input_tokens": h.get("input_tokens", 0), "output_tokens": h.get("output_tokens", 0)}})

    def _meta(self, phone_number_id, body):
        STATE.record("meta", body.get("type", "text"), body)
        if STATE.section("meta").get("refuse_outside_window") and body.get("type") != "template":
            return self._json(400, {"error": {**META_OUTSIDE_WINDOW, "type": "OAuthException", "fbtrace_id": "mock"}})
        to = str(body.get("to", ""))
        self._json(200, {"messaging_product": "whatsapp", "contacts": [{"input": to, "wa_id": to}],
                         "messages": [{"id": f"wamid.MOCK{next(STATE.ids):06d}"}]})

    def _graph_get(self):
        """Doctor reads. Unknown paths are a Graph-style 400, as Meta answers them."""
        path, _, query = self.path.partition("?")
        parts = [p for p in path.split("/") if p][1:]
        params = dict(urllib.parse.parse_qsl(query))
        op = "/".join("{id}" if p.isdigit() else p for p in parts)
        STATE.record("meta_get", op, {"path": "/".join(parts), "query": params,
                                       "bearer": (self.headers.get("Authorization") or "").startswith("Bearer ")})
        setup = {**META_SETUP_DEFAULT, **STATE.section("meta_setup")}
        if setup["token_expired"]:
            return self._json(401, {"error": {"message": "Error validating access token: Session has expired (mock).",
                                              "type": "OAuthException", "code": 190, "error_subcode": 463, "fbtrace_id": "mock"}})
        if op == "me":
            return self._json(200, {"id": "1", "name": "wa-agent system user (mock)"})
        if op == "me/permissions":
            return self._json(200, {"data": [{"permission": s, "status": "granted"} for s in setup["scopes"]]})
        if op == "{id}" and "account_review_status" in params.get("fields", ""):  # the WhatsApp account
            return self._json(200, {"id": parts[0], **META_SETUP_DEFAULT["waba"], **STATE.section("meta_setup").get("waba", {})})
        if op == "{id}":
            return self._json(200, {"id": parts[0], **META_SETUP_DEFAULT["phone"], **STATE.section("meta_setup").get("phone", {})})
        if op == "{id}/subscribed_apps":
            return self._json(200, {"data": setup["subscribed_apps"]})
        if op == "{id}/message_templates":
            name = params.get("name")
            return self._json(200, {"data": [t for t in setup["templates"] if not name or t["name"] == name]})
        return self._json(400, {"error": {"message": f"Unsupported get request (mock: {op})", "type": "GraphMethodException",
                                          "code": 100, "error_subcode": 33, "fbtrace_id": "mock"}})

    def _twilio(self, account_sid, body):
        """Twilio's Messages API. The form body arrives as _raw, since _body only parses JSON."""
        form = dict(urllib.parse.parse_qsl(body.get("_raw", ""), keep_blank_values=True))
        STATE.record("twilio", "template" if form.get("ContentSid") else "text",
                     {**form, "account_sid": account_sid, "basic_auth": (self.headers.get("Authorization") or "").startswith("Basic ")})
        err = STATE.section("twilio").get("error")
        if err:
            return self._json(400, {"code": err.get("code", 21211), "message": err.get("message", "scripted error"),
                                    "more_info": "https://www.twilio.com/docs/errors", "status": 400})
        self._json(201, {"sid": f"SMMOCK{next(STATE.ids):026d}", "status": "queued", "to": form.get("To"),
                         "from": form.get("From"), "body": form.get("Body"), "account_sid": account_sid})

    def _passthrough(self, service, path, body):
        """Live-model tier: forward to the real service with the caller's auth headers."""
        headers = {"Content-Type": "application/json"}
        for h in ("Authorization", "x-api-key", "anthropic-version"):
            if self.headers.get(h):
                headers[h] = self.headers[h]
        req = urllib.request.Request(REAL_HOSTS[service] + path, data=json.dumps(body).encode(), headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return self._json(r.status, json.loads(r.read() or b"{}"))
        except urllib.error.HTTPError as e:
            return self._json(e.code, {"detail": e.read().decode("utf-8", "replace")[:500]})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    a = ap.parse_args()
    srv = ThreadingHTTPServer((a.host, a.port), Handler)
    print(f"mock server on {a.host}:{a.port}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
