#!/usr/bin/env python3
"""Quick-Chat grammar parser / validator.

Parses structured Quick-Chat utterances (see 05_QUICKCHAT_GRAMMAR.md and
tools/data/quickchat_grammar.json) into an AST + suspicion deltas, without
any LLM. This is the reference parser NPCs and the meeting UI will share.

Usage:
  python3 tools/qc_parse.py parse "ACCUSE TARGET=Blue EVIDENCE=VENT" --speaker Red
  python3 tools/qc_parse.py parse "REPORT_BODY LOCATION=Electrical" --speaker Red
  python3 tools/qc_parse.py validate tools/data/quickchat_grammar.json
  python3 tools/qc_parse.py demo
  python3 tools/qc_parse.py fuzz --count 200 --seed 42

Exit codes: 0 = ok, 1 = parse/validation error, 2 = usage error.
Stdlib only. Python 3.11+.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

DATA_PATH = Path(__file__).resolve().parent / "data" / "quickchat_grammar.json"

# Slot name -> vocabulary name in the grammar JSON (slots are singular,
# vocabularies are plural, e.g. slot LOCATION -> vocabulary LOCATIONS).
# Neutral render defaults for optional slots.
RENDER_DEFAULTS = {
    "TARGET": "nobody",
    "EVIDENCE": "NONE",
    "TIME": "UNKNOWN",
    "LOCATION": "unknown",
    "STRENGTH": "MILD",
    "STATUS": "DONE",
    "TOPIC": "WHERE",
    "SABOTAGE": "LIGHTS",
    "TASKS": "none",
}

SLOT_TO_VOCAB = {
    "LOCATION": "LOCATIONS",
    "EVIDENCE": "EVIDENCE",
    "TIME": "TIME",
    "STRENGTH": "STRENGTH",
    "STATUS": "STATUS",
    "TOPIC": "TOPIC",
    "SABOTAGE": "SABOTAGE",
    "TASKS": "TASKS",
}


def load_grammar(path: Path = DATA_PATH) -> dict:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


class ParseError(ValueError):
    pass


def parse_utterance(text: str, speaker: str, grammar: dict) -> dict:
    """Parse one utterance string into an AST dict.

    Format: TYPE KEY=VALUE KEY=VALUE ...
    SPEAKER is supplied out-of-band (it is the channel, not a slot).
    Raises ParseError with a human-readable reason on any violation.
    """
    if not text or not text.strip():
        raise ParseError("empty utterance")
    if not speaker or not speaker.strip():
        raise ParseError("speaker is required")
    tokens = text.strip().split()
    utype = tokens[0].upper()
    types = grammar["utterance_types"]
    if utype not in types:
        raise ParseError(f"unknown utterance type '{utype}'; expected one of {sorted(types)}")
    spec = types[utype]
    slots_spec: dict = spec["slots"]
    slots: dict[str, str] = {}
    for tok in tokens[1:]:
        if "=" not in tok:
            raise ParseError(f"malformed token '{tok}'; expected KEY=VALUE")
        key, value = tok.split("=", 1)
        key = key.upper()
        if key not in slots_spec:
            raise ParseError(f"slot {key} not allowed for {utype}; allowed: {sorted(slots_spec)}")
        if key in slots:
            raise ParseError(f"duplicate slot {key}")
        slots[key] = value
    # Required slots present?
    for key, req in slots_spec.items():
        if req == "required" and key not in slots:
            raise ParseError(f"missing required slot {key} for {utype}")
    # Vocabulary checks (only for slots that are vocabularies).
    vocabs = grammar["vocabularies"]
    for key, value in slots.items():
        vocab_name = SLOT_TO_VOCAB.get(key)
        if vocab_name and vocab_name in vocabs and value not in vocabs[vocab_name]:
            raise ParseError(f"value '{value}' for {key} not in vocabulary {vocabs[vocab_name]}")
    # Constraints.
    cons = grammar.get("constraints", {})
    if cons.get("speaker_ne_target") and slots.get("TARGET", "").lower() == speaker.lower():
        raise ParseError("speaker cannot target themselves (except via DEFEND/ALIBI semantics at runtime)")
    # Suspicion delta.
    delta = float(spec["suspicion"]["default_target_delta"])
    if utype == "SUSPICION" and slots.get("STRENGTH") == "STRONG":
        delta = 0.35
    target = slots.get("TARGET")
    # For ALIBI/DEFEND the delta applies to speaker/self; for others to TARGET.
    delta_target = speaker if utype in ("ALIBI", "DEFEND") else target
    # Fill every placeholder the template may reference; optional slots that
    # were not supplied render as their neutral default so a valid short form
    # (e.g. VOTE_INTENT with no TARGET = skip) never crashes rendering.
    render_slots = {slot: default for slot, default in RENDER_DEFAULTS.items()}
    render_slots.update(slots)
    render = spec["render"].format(SPEAKER=speaker, **render_slots)
    return {
        "type": utype,
        "speaker": speaker,
        "slots": slots,
        "suspicion_delta": {"target": delta_target, "delta": delta},
        "render": render,
    }


def validate_grammar(grammar: dict) -> list[str]:
    """Return a list of problems with the grammar file itself (empty = ok)."""
    problems: list[str] = []
    vocabs = grammar.get("vocabularies", {})
    types = grammar.get("utterance_types", {})
    if not types:
        problems.append("no utterance_types defined")
    for name, spec in types.items():
        if "slots" not in spec or "suspicion" not in spec or "render" not in spec:
            problems.append(f"{name}: missing slots/suspicion/render")
            continue
        for slot in spec["slots"]:
            # Slots that look like vocabularies must exist as vocabularies,
            # except TARGET/SPEAKER which are player names.
            if slot in ("TARGET", "SPEAKER"):
                continue
            vocab_name = SLOT_TO_VOCAB.get(slot)
            if not vocab_name or vocab_name not in vocabs:
                problems.append(f"{name}: slot {slot} has no vocabulary entry")
        # Render template must reference only known placeholders.
        placeholders = {"SPEAKER": "X", "TARGET": "Y"}
        for slot in spec["slots"]:
            placeholders[slot] = "Z"
        try:
            spec["render"].format(**placeholders)
        except KeyError as e:
            problems.append(f"{name}: render references unknown placeholder {e}")
        except Exception as e:  # noqa: BLE001 - report any template error
            problems.append(f"{name}: render template error: {e}")
    return problems


def demo(grammar: dict) -> None:
    examples = [
        ("REPORT_BODY LOCATION=Electrical TIME=JUST_NOW", "Red"),
        ("ACCUSE TARGET=Blue EVIDENCE=VENT", "Red"),
        ("ALIBI LOCATION=MedBay TIME=EARLIER TARGET=Green", "Blue"),
        ("VENT_SIGHTING TARGET=Blue LOCATION=Electrical", "Red"),
        ("TASK_CLAIM TASKS=FixWiring LOCATION=Electrical STATUS=DONE", "Green"),
        ("VOTE_INTENT TARGET=Blue", "Red"),
        ("VOTE_INTENT", "Green"),
    ]
    for text, speaker in examples:
        ast = parse_utterance(text, speaker, grammar)
        print(json.dumps(ast, indent=2))
        print("---")


def fuzz(grammar: dict, count: int, seed: int) -> int:
    """Generate random utterances; every generated one must parse. Returns failures."""
    rng = random.Random(seed)
    vocabs = grammar["vocabularies"]
    failures = 0
    for i in range(count):
        utype = rng.choice(sorted(grammar["utterance_types"]))
        spec = grammar["utterance_types"][utype]
        parts = [utype]
        for slot, req in spec["slots"].items():
            if req != "required" and rng.random() < 0.5:
                continue
            if slot == "TARGET":
                value = rng.choice(["Blue", "Green", "Pink", "Yellow"])
            elif SLOT_TO_VOCAB.get(slot) in vocabs:
                value = rng.choice(vocabs[SLOT_TO_VOCAB[slot]])
            else:
                value = "Blue"
            parts.append(f"{slot}={value}")
        text = " ".join(parts)
        try:
            parse_utterance(text, "Red", grammar)
        except ParseError as e:
            failures += 1
            print(f"FUZZ FAIL [{i}]: {text!r} -> {e}", file=sys.stderr)
    print(f"fuzz: {count} generated, {failures} failures (seed={seed})")
    return failures


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Quick-Chat grammar parser")
    sub = p.add_subparsers(dest="cmd", required=True)
    pp = sub.add_parser("parse", help="parse one utterance")
    pp.add_argument("utterance")
    pp.add_argument("--speaker", required=True)
    pp.add_argument("--grammar", type=Path, default=DATA_PATH)
    pv = sub.add_parser("validate", help="validate a grammar JSON file")
    pv.add_argument("grammar", type=Path, nargs="?", default=DATA_PATH)
    sub.add_parser("demo", help="show example parses")
    pf = sub.add_parser("fuzz", help="generate random valid utterances and re-parse them")
    pf.add_argument("--count", type=int, default=200)
    pf.add_argument("--seed", type=int, default=42)
    args = p.parse_args(argv)

    if args.cmd == "validate":
        grammar = load_grammar(args.grammar)
        problems = validate_grammar(grammar)
        if problems:
            for prob in problems:
                print(f"ERROR: {prob}", file=sys.stderr)
            return 1
        print(f"grammar OK: {len(grammar['utterance_types'])} utterance types, "
              f"{len(grammar['vocabularies'])} vocabularies")
        return 0
    grammar = load_grammar(getattr(args, "grammar", DATA_PATH))
    if args.cmd == "parse":
        try:
            ast = parse_utterance(args.utterance, args.speaker, grammar)
        except ParseError as e:
            print(f"PARSE ERROR: {e}", file=sys.stderr)
            return 1
        print(json.dumps(ast, indent=2))
        return 0
    if args.cmd == "demo":
        demo(grammar)
        return 0
    if args.cmd == "fuzz":
        return 1 if fuzz(grammar, args.count, args.seed) else 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
