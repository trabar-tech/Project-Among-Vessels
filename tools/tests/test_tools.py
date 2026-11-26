"""Unit tests for the dev tools. Run: python3 -m unittest discover -s tools/tests -v"""
import json
import random
import sys
import unittest
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import qc_parse  # noqa: E402
import sim_headless  # noqa: E402
import validate_state  # noqa: E402

GRAMMAR = qc_parse.load_grammar()
BAL = json.loads(validate_state.BAL_PATH.read_text(encoding="utf-8"))
SM = json.loads(validate_state.SM_PATH.read_text(encoding="utf-8"))


class TestQuickChatParser(unittest.TestCase):
    def test_valid_accuse(self):
        ast = qc_parse.parse_utterance("ACCUSE TARGET=Blue EVIDENCE=VENT", "Red", GRAMMAR)
        self.assertEqual(ast["type"], "ACCUSE")
        self.assertEqual(ast["suspicion_delta"]["target"], "Blue")
        self.assertAlmostEqual(ast["suspicion_delta"]["delta"], 0.3)

    def test_valid_vote_skip(self):
        ast = qc_parse.parse_utterance("VOTE_INTENT", "Green", GRAMMAR)
        self.assertEqual(ast["type"], "VOTE_INTENT")
        self.assertNotIn("TARGET", ast["slots"])

    def test_unknown_type_rejected(self):
        with self.assertRaises(qc_parse.ParseError):
            qc_parse.parse_utterance("FLY TARGET=Blue", "Red", GRAMMAR)

    def test_bad_vocabulary_rejected(self):
        with self.assertRaises(qc_parse.ParseError):
            qc_parse.parse_utterance("REPORT_BODY LOCATION=Moon", "Red", GRAMMAR)

    def test_missing_required_slot_rejected(self):
        with self.assertRaises(qc_parse.ParseError):
            qc_parse.parse_utterance("ACCUSE TARGET=Blue", "Red", GRAMMAR)

    def test_self_target_rejected(self):
        with self.assertRaises(qc_parse.ParseError):
            qc_parse.parse_utterance("ACCUSE TARGET=Red EVIDENCE=VENT", "Red", GRAMMAR)

    def test_grammar_validates_clean(self):
        self.assertEqual(qc_parse.validate_grammar(GRAMMAR), [])

    def test_fuzz_all_parse(self):
        self.assertEqual(qc_parse.fuzz(GRAMMAR, 200, 7), 0)


class TestStateValidation(unittest.TestCase):
    def test_shipped_files_validate_clean(self):
        self.assertEqual(validate_state.validate(SM, BAL), [])

    def test_all_phases_reachable(self):
        reach = validate_state.reachable_phases(SM)
        self.assertEqual(reach, set(SM["phases"]))

    def test_plurality_ejects(self):
        out = validate_state.tally_votes(Counter({"Blue": 4, "Green": 2}), 10)
        self.assertEqual(out["ejected"], "Blue")

    def test_tie_no_ejection(self):
        out = validate_state.tally_votes(Counter({"Blue": 3, "Green": 3}), 10)
        self.assertIsNone(out["ejected"])

    def test_skip_plurality_no_ejection(self):
        out = validate_state.tally_votes(Counter({"SKIP": 5, "Blue": 2}), 10)
        self.assertIsNone(out["ejected"])

    def test_overvote_rejected(self):
        with self.assertRaises(ValueError):
            validate_state.tally_votes(Counter({"Blue": 11}), 10)


class TestSimulation(unittest.TestCase):
    def test_deterministic_per_seed(self):
        r1 = sim_headless.run_one(random.Random(123), 10, 2, BAL)
        r2 = sim_headless.run_one(random.Random(123), 10, 2, BAL)
        self.assertEqual(r1, r2)

    def test_default_balance_is_contested(self):
        """Regression guard: default tuning must not be degenerate either way."""
        rng = random.Random(2024)
        results = [sim_headless.run_one(rng, 10, 2, BAL) for _ in range(120)]
        rate = sim_headless.summarise(results)["crew_win_rate"]
        self.assertGreaterEqual(rate, 0.20, f"crew win rate too low: {rate}")
        self.assertLessEqual(rate, 0.70, f"crew win rate too high: {rate}")

    def test_eject_accuracy_is_not_perfect(self):
        """Quick-Chat must leave room for impostors to lie successfully."""
        rng = random.Random(7)
        results = [sim_headless.run_one(rng, 10, 2, BAL) for _ in range(120)]
        acc = sim_headless.summarise(results)["eject_accuracy"]
        self.assertLess(acc, 0.95, f"eject accuracy {acc} means lies never land")

    def test_summary_shape(self):
        rng = random.Random(1)
        results = [sim_headless.run_one(rng, 10, 2, BAL) for _ in range(20)]
        summary = sim_headless.summarise(results)
        self.assertEqual(summary["runs"], 20)
        self.assertAlmostEqual(sum(summary["win_rates"].values()), 1.0, places=2)
        for winner in summary["win_rates"]:
            self.assertIn(winner, {"crew_tasks", "crew_eject", "impostor_parity", "impostor_sabotage"})


if __name__ == "__main__":
    unittest.main()
