"""Unit tests for scripts/workflow_lib.py.  Run: python -m unittest tests/test_workflow_lib.py"""
import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import workflow_lib as wl  # noqa: E402


def node(name, type_="n8n-nodes-base.code", **params):
    return {"id": "id-" + name, "name": name, "type": type_, "typeVersion": 2, "position": [0, 0], "parameters": params}


def link(*targets):
    return [{"node": t, "type": "main", "index": 0} for t in targets]


GUARD_WF = {
    "id": "W1", "name": "conversation",
    "nodes": [node("gate:check"), node("guard:dnc", "n8n-nodes-base.if"), node("stop"), node("next"), node("other")],
    "connections": {
        "gate:check": {"main": [link("guard:dnc", "other")]},
        "guard:dnc": {"main": [link("stop"), link("next")]},
    },
}


class Export(unittest.TestCase):
    def test_normalise_keeps_only_file_fields_and_strips_credential_ids(self):
        api = {"id": "W1", "name": "send", "active": True, "versionId": "v", "shared": [{"project": {"name": "me <me@x>"}}],
               "pinData": {"a": 1}, "staticData": {"x": 1}, "settings": {"executionOrder": "v1"}, "connections": {},
               "nodes": [node("b"), {**node("a"), "credentials": {"httpHeaderAuth": {"id": "C9", "name": "Meta"}}}]}
        out = wl.normalise(api, {})
        self.assertEqual(sorted(out), ["connections", "id", "name", "nodes", "settings"])
        self.assertEqual([n["name"] for n in out["nodes"]], ["a", "b"])
        self.assertEqual(out["nodes"][0]["credentials"], {"httpHeaderAuth": {"name": "Meta"}})
        self.assertNotIn("me@x", str(out))

    def test_normalise_replaces_table_ids(self):
        api = {"id": "W", "name": "log", "nodes": [node("t", dataTableId={"__rl": True, "value": "TBL1", "mode": "list"})], "connections": {}}
        out = wl.normalise(api, {"TBL1": "message_log"})
        self.assertEqual(out["nodes"][0]["parameters"]["dataTableId"]["value"], "__table:message_log__")

    def test_undo_restores_mock_hosts_and_clock_from_previous_file(self):
        prev = {"nodes": [node("clock:now", jsCode=wl.CLOCK_CODE),
                          node("meta:send", "n8n-nodes-base.httpRequest", url="https://graph.facebook.com/v25.0/1/messages")]}
        deployed = copy.deepcopy(prev)
        wl.rewrite_hosts(deployed)
        deployed = wl.scripted_clock(deployed)
        self.assertNotEqual(deployed["nodes"], prev["nodes"])
        back = wl.undo_dryrun_changes({"name": "send", **deployed}, prev)
        self.assertEqual(back["nodes"], prev["nodes"])

    def test_undo_rebuilds_a_new_clock_and_refuses_an_unknown_mock_node(self):
        clock = wl.scripted_clock({"nodes": [node("clock:now", jsCode="x")]})["nodes"][0]
        self.assertEqual(wl.undo_dryrun_changes({"nodes": [clock]}, None)["nodes"][0]["parameters"]["jsCode"], wl.CLOCK_CODE)
        bad = node("x", "n8n-nodes-base.httpRequest", url="={{ $env.MOCK_URL }}/v1/messages")
        with self.assertRaises(wl.DeployError):
            wl.undo_dryrun_changes({"name": "answer", "nodes": [bad]}, None)

    def test_undo_leaves_ordinary_nodes_alone(self):
        wf = {"nodes": [node("a", jsCode="return [];")]}
        self.assertEqual(wl.undo_dryrun_changes(wf, None), wf)


class DryrunChanges(unittest.TestCase):
    def test_rewrite_hosts_plain_and_expression_urls(self):
        wf = {"nodes": [
            node("m", "n8n-nodes-base.httpRequest", url="=https://graph.facebook.com/{{ $env.META_GRAPH_VERSION }}/x/messages"),
            node("a", "n8n-nodes-base.httpRequest", url="https://api.anthropic.com/v1/messages"),
            node("o", "n8n-nodes-base.httpRequest", url="https://example.com/"),
            node("c", jsCode="fetch('https://api.anthropic.com')"),
        ]}
        wl.rewrite_hosts(wf)
        urls = [n["parameters"].get("url") for n in wf["nodes"]]
        self.assertEqual(urls[0], "={{ $env.MOCK_URL }}/{{ $env.META_GRAPH_VERSION }}/x/messages")
        self.assertEqual(urls[1], "={{ $env.MOCK_URL }}/v1/messages")
        self.assertEqual(urls[2], "https://example.com/")
        self.assertIn("api.anthropic.com", wf["nodes"][3]["parameters"]["jsCode"])

    def test_scripted_clock_keeps_name_id_and_position(self):
        out = wl.scripted_clock({"nodes": [node("clock:now", jsCode=wl.CLOCK_CODE)]})["nodes"][0]
        self.assertEqual((out["name"], out["id"], out["type"]), ("clock:now", "id-clock:now", "n8n-nodes-base.httpRequest"))
        self.assertEqual(out["parameters"]["url"], "={{ $env.MOCK_URL }}/_clock")

    def test_remove_guard_node_rewires_to_the_false_output(self):
        wf, removed = wl.remove_guard_node(copy.deepcopy(GUARD_WF), "dnc")
        self.assertTrue(removed)
        self.assertNotIn("guard:dnc", [n["name"] for n in wf["nodes"]])
        self.assertEqual(wf["connections"]["gate:check"]["main"][0], link("next", "other"))
        self.assertNotIn("guard:dnc", wf["connections"])
        self.assertEqual(GUARD_WF["connections"]["gate:check"]["main"][0], link("guard:dnc", "other"))  # input untouched

    def test_remove_guard_node_with_no_false_output_drops_the_path(self):
        wf = copy.deepcopy(GUARD_WF)
        wf["connections"]["guard:dnc"]["main"] = [link("stop")]
        out, _ = wl.remove_guard_node(wf, "dnc")
        self.assertEqual(out["connections"]["gate:check"]["main"][0], link("other"))

    def test_remove_guard_node_absent(self):
        self.assertEqual(wl.remove_guard_node(copy.deepcopy(GUARD_WF), "closed")[1], False)

    def test_remove_guard_from_lists_first_middle_last_and_only(self):
        code = ("const x = 1;\n"
                "const ENABLED_GUARDS = ['a_one', 'b_two', 'c_three']; // @guards\n"
                "const ONLY = ['solo']; // @guards\n"
                "const NOT_A_GUARD_LINE = ['a_one'];\n")
        for gid, expect in [("a_one", "['b_two', 'c_three']"), ("b_two", "['a_one', 'c_three']"), ("c_three", "['a_one', 'b_two']")]:
            wf, removed = wl.remove_guard_from_lists({"nodes": [node("n", jsCode=code)]}, gid)
            self.assertTrue(removed, gid)
            out = wf["nodes"][0]["parameters"]["jsCode"]
            self.assertIn("const ENABLED_GUARDS = %s; // @guards" % expect, out)
            self.assertIn("const NOT_A_GUARD_LINE = ['a_one'];", out)
        wf, _ = wl.remove_guard_from_lists({"nodes": [node("n", jsCode=code)]}, "solo")
        self.assertIn("const ONLY = []; // @guards", wf["nodes"][0]["parameters"]["jsCode"])
        self.assertFalse(wl.remove_guard_from_lists({"nodes": [node("n", jsCode=code)]}, "a_on")[1])

    def test_guards_in(self):
        wf = {"nodes": [node("guard:dnc", "n8n-nodes-base.if"),
                        node("c", jsCode="const ENABLED_GUARDS = ['dc_price', 'dc_empty']; // @guards\n// 'not_this'")]}
        self.assertEqual(wl.guards_in([wf]), {"dnc", "dc_price", "dc_empty"})


class Resolve(unittest.TestCase):
    def test_fills_credential_and_table_ids(self):
        wf = {"name": "send", "nodes": [{**node("m", url="x", table="__table:inbox__"),
                                         "credentials": {"httpHeaderAuth": {"name": "Meta"}}}]}
        out = wl.resolve(wf, {("httpHeaderAuth", "Meta"): "C1"}, {"inbox": "T1"})
        self.assertEqual(out["nodes"][0]["credentials"]["httpHeaderAuth"], {"id": "C1", "name": "Meta"})
        self.assertEqual(out["nodes"][0]["parameters"]["table"], "T1")

    def test_lists_every_missing_name(self):
        wf = {"name": "send", "nodes": [{**node("m", t="__table:nope__"), "credentials": {"httpHeaderAuth": {"name": "Meta"}}}]}
        with self.assertRaises(wl.DeployError) as e:
            wl.resolve(wf, {}, {})
        self.assertIn("Meta", str(e.exception))
        self.assertIn("nope", str(e.exception))

    def test_live_refusals(self):
        ok = {"name": "send", "nodes": [node("m", "n8n-nodes-base.httpRequest", url="https://graph.facebook.com/x")]}
        self.assertEqual(wl.live_refusals([ok]), [])
        bad = [{"name": "ingress-replay", "nodes": []}, {"name": "sheets-adapter", "_fake": True, "nodes": []},
               {"name": "answer", "nodes": [node("a", url="={{ $env.MOCK_URL }}/v1/messages")]}]
        self.assertEqual(len(wl.live_refusals(bad)), 3)

    def test_has_trigger(self):
        self.assertTrue(wl.has_trigger({"nodes": [node("t", "n8n-nodes-base.executeWorkflowTrigger")]}))
        self.assertFalse(wl.has_trigger({"nodes": [node("t", "n8n-nodes-base.manualTrigger")]}))


if __name__ == "__main__":
    unittest.main()
