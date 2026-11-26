"""Unit tests for scripts/report_metrics.py (no n8n needed). Run: python -m unittest tests/test_report_metrics.py"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import report_metrics as rm  # noqa: E402

PRICES = {"haiku_input": 1.0, "haiku_output": 5.0, "jev_per_call": 0.001}


def row(**kw):
    base = {"logged_at": "2026-12-01T15:00:10Z", "wa_id": "15550000001", "direction": "in", "author": "customer"}
    return {**base, **kw}


class Metrics(unittest.TestCase):
    def test_booking_rate_counts_crm_events(self):
        rows = [row(direction="event", kind="crm_enquiry"), row(direction="event", kind="crm_enquiry"),
                row(direction="event", kind="crm_booked"), row(direction="event", kind="click_mark_booked")]
        m = rm.metrics(rows, PRICES)
        self.assertEqual((m["enquiries"], m["bookings"]), (2, 1))
        self.assertEqual(m["booking_rate"], 0.5)

    def test_no_enquiries_gives_no_rate(self):
        self.assertIsNone(rm.metrics([], PRICES)["booking_rate"])

    def test_cost_per_conversation(self):
        rows = [row(classifier='{"route":"price_question"}'),
                row(direction="out", author="bot", draft="A deep clean is $120.", input_tokens=1000, output_tokens=200),
                row(wa_id="15550000002", classifier="")]
        m = rm.metrics(rows, PRICES)
        # Haiku: 1000 * 1 / 1M + 200 * 5 / 1M = 0.002; Jev: 1 classifier + 1 draft check = 0.002
        self.assertEqual(m["conversations"], 2)
        self.assertEqual(m["jev_calls"], 2)
        self.assertAlmostEqual(m["cost_total"], 0.004)
        self.assertAlmostEqual(m["cost_per_conversation"], 0.002)

    def test_busiest_minute(self):
        rows = [row(logged_at="2026-12-01T15:00:01Z"), row(logged_at="2026-12-01T15:00:59Z"),
                row(logged_at="2026-12-01T15:01:00Z"), row(direction="out", logged_at="2026-12-01T15:01:02Z")]
        m = rm.metrics(rows, PRICES)
        self.assertEqual((m["busiest_minute"], m["busiest_count"]), ("2026-12-01T15:00", 2))

    def test_reply_times_use_bot_replies_only(self):
        rows = [row(direction="out", author="bot", reply_ms=1000), row(direction="out", author="bot", reply_ms=3000),
                row(direction="out", author="bot", reply_ms=8000), row(direction="out", author="owner", reply_ms=60000),
                row(direction="out", author="bot", reply_ms=None)]
        m = rm.metrics(rows, PRICES)
        self.assertEqual((m["replies"], m["reply_median_ms"], m["reply_max_ms"]), (3, 3000, 8000))

    def test_window(self):
        start, end = rm.parse_time("2026-12-01T00:00:00Z"), rm.parse_time("2026-12-02T00:00:00Z")
        self.assertTrue(rm.in_window(row(logged_at="2026-12-01T23:59:59Z"), start, end))
        self.assertFalse(rm.in_window(row(logged_at="2026-12-02T00:00:00Z"), start, end))
        self.assertFalse(rm.in_window(row(logged_at=""), start, end))

    def test_markdown_has_every_metric(self):
        out = rm.markdown(rm.metrics([], PRICES), PRICES, "test")
        for label in ("Enquiry-to-booking rate", "Cost per conversation", "Throughput", "Reply time, median"):
            self.assertIn(label, out)


class ContractShapes(unittest.TestCase):
    def setUp(self):
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import adapter_contract
        self.ac = adapter_contract

    def test_ok_output_matches(self):
        self.assertEqual(self.ac.contract_problems("hubspot", "find_contact", {"ok": True, "contact_id": None}), [])
        self.assertEqual(self.ac.contract_problems("slack", "post", {"ok": True, "ts": "1.2"}), [])

    def test_missing_and_wrong_types(self):
        self.assertEqual(self.ac.contract_problems("slack", "post", {"ok": True}), ["missing key ts"])
        self.assertEqual(self.ac.contract_problems("calendar", "busy", {"ok": True, "busy": "none"}),
                         ["busy should be list, got str"])

    def test_errors(self):
        err = {"ok": False, "error": {"kind": "not_found", "message": "no such deal"}}
        self.assertEqual(self.ac.contract_problems("hubspot", "move_deal", err, "not_found"), [])
        self.assertTrue(self.ac.contract_problems("hubspot", "move_deal", err))
        self.assertTrue(self.ac.contract_problems("hubspot", "move_deal", {"ok": False, "error": {"kind": "boom"}}, "not_found"))
        self.assertTrue(self.ac.contract_problems("hubspot", "move_deal", {"ok": True}, "not_found"))


if __name__ == "__main__":
    unittest.main()
