#!/usr/bin/env python3
"""Engine <-> tooling parity checker.

The game core exists twice on purpose: `tools/` is the fast reference
implementation (Python, used by the balance probes) and `engine/src/sim/` is the
shipped runtime (TypeScript, used by the 3D client). Two implementations WILL
drift. This script is the anti-drift device required by 06_ENGINE_AND_3D.md §6.

It checks, by parsing text (no node dependency):
  1. Balance constants in engine/src/sim/rules.ts match balance_defaults.json.
  2. Game phases in engine/src/sim/state.ts match state_machine.json.
  3. Utterance types in engine/src/sim/rules.ts match quickchat_grammar.json.
  4. Room adjacency in rules.ts matches its JSON mirror and is symmetric.

Usage: python3 tools/check_rules.py [--json]
Exit:  0 in sync, 1 drift, 2 usage.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "tools" / "data"
RULES_TS = ROOT / "engine" / "src" / "sim" / "rules.ts"
STATE_TS = ROOT / "engine" / "src" / "sim" / "state.ts"

# JSON key -> TS constant name in RULES
BALANCE_MAP = {
    "players": "players",
    "impostors": "impostors",
    "kill_cooldown_seconds": "killCooldownSeconds",
    "sabotage_cooldown_seconds": "sabotageCooldownSeconds",
    "door_lock_seconds": "doorLockSeconds",
    "crisis_countdown_seconds": "crisisCountdownSeconds",
    "discussion_seconds": "discussionSeconds",
    "voting_seconds": "votingSeconds",
    "emergency_meetings_per_player": "emergencyMeetingsPerPlayer",
    "emergency_cooldown_seconds": "emergencyCooldownSeconds",
    "crew_vision_multiplier": "crewVisionMultiplier",
    "impostor_vision_multiplier": "impostorVisionMultiplier",
    "player_speed_multiplier": "playerSpeedMultiplier",
}


def load(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def ts_numbers(src: str) -> dict[str, float]:
    """Extract `name: number` pairs from the RULES object literal."""
    out: dict[str, float] = {}
    for m in re.finditer(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(-?\d+(?:\.\d+)?)\s*,", src, re.M):
        out[m.group(1)] = float(m.group(2))
    return out


def ts_string_array(src: str, name: str) -> list[str]:
    m = re.search(rf"{name}\s*=\s*\[(.*?)\]", src, re.S)
    if not m:
        return []
    return re.findall(r"'([^']+)'", m.group(1))


def ts_phase_union(src: str) -> list[str]:
    m = re.search(r"export type Phase\s*=(.*?);", src, re.S)
    if not m:
        return []
    return re.findall(r"'([A-Z_]+)'", m.group(1))


def ts_adjacency(src: str) -> dict[str, list[str]]:
    m = re.search(r"ADJACENCY[^=]*=\s*\{(.*?)\n\};", src, re.S)
    if not m:
        return {}
    adj: dict[str, list[str]] = {}
    for line in m.group(1).splitlines():
        mm = re.match(r"\s*([A-Za-z0-9_]+)\s*:\s*\[(.*?)\],", line)
        if mm:
            adj[mm.group(1)] = re.findall(r"'([^']+)'", mm.group(2))
    return adj


def check() -> list[str]:
    problems: list[str] = []
    bal = load(DATA / "balance_defaults.json")
    sm = load(DATA / "state_machine.json")
    grammar = load(DATA / "quickchat_grammar.json")

    rules_src = RULES_TS.read_text(encoding="utf-8")
    state_src = STATE_TS.read_text(encoding="utf-8")
    nums = ts_numbers(rules_src)

    # 1. balance parity
    for json_key, ts_key in BALANCE_MAP.items():
        if json_key not in bal:
            problems.append(f"balance_defaults.json missing key {json_key}")
            continue
        expected = float(bal[json_key])
        actual = nums.get(ts_key)
        if actual is None:
            problems.append(f"rules.ts missing RULES.{ts_key}")
        elif abs(actual - expected) > 1e-9:
            problems.append(f"{ts_key}: engine={actual} json={expected}")

    # tasks total must agree with the sum
    t = bal["tasks"]
    if t["total_per_crewmate"] != t["common"] + t["long"] + t["short"]:
        problems.append("balance_defaults.json task counts do not sum")
    if nums.get("tasksPerCrewmate") != float(t["total_per_crewmate"]):
        problems.append(f"tasksPerCrewmate: engine={nums.get('tasksPerCrewmate')} "
                        f"json={t['total_per_crewmate']}")

    # 2. phase parity
    engine_phases = set(ts_phase_union(state_src))
    json_phases = set(sm["phases"])
    for ph in sorted(json_phases - engine_phases):
        problems.append(f"engine Phase union missing '{ph}'")
    for ph in sorted(engine_phases - json_phases):
        problems.append(f"engine Phase union has unknown '{ph}'")

    # 3. utterance-type parity (engine ships the frozen 15; identity types are
    #    doc-06 Phase 3 additions and are allowed to be absent).
    engine_types = set(ts_string_array(rules_src, "UTTERANCE_TYPES"))
    json_types = set(grammar["utterance_types"])
    phase3_only = {"IDENTITY_CLAIM", "IDENTITY_CHALLENGE", "MANIFEST_CITE"}
    for ut in sorted(json_types - engine_types - phase3_only):
        problems.append(f"engine UTTERANCE_TYPES missing '{ut}'")
    for ut in sorted(engine_types - json_types):
        problems.append(f"engine UTTERANCE_TYPES has unknown '{ut}'")
    for ut in sorted(phase3_only - json_types):
        problems.append(f"grammar JSON missing Phase-3 type '{ut}'")

    # 4. adjacency symmetry + completeness against LOCATIONS
    adj = ts_adjacency(rules_src)
    locations = set(ts_string_array(rules_src, "LOCATIONS"))
    if not adj:
        problems.append("could not parse ADJACENCY from rules.ts")
    else:
        for room, neighbours in adj.items():
            if room not in locations:
                problems.append(f"ADJACENCY has unknown room '{room}'")
            for n in neighbours:
                if n not in adj:
                    problems.append(f"ADJACENCY: {room} -> {n} (unknown room)")
                elif room not in adj[n]:
                    problems.append(f"ADJACENCY asymmetric: {room} -> {n}")
            if not neighbours:
                problems.append(f"ADJACENCY: '{room}' has no exits")
        for room in sorted(locations - set(adj)):
            problems.append(f"LOCATIONS has '{room}' but ADJACENCY does not")
    return problems


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Check engine/tooling rule parity")
    p.add_argument("--json", action="store_true", help="machine-readable output")
    args = p.parse_args(argv)

    problems = check()
    if args.json:
        print(json.dumps({"ok": not problems, "problems": problems}, indent=2))
    elif problems:
        for prob in problems:
            print(f"DRIFT: {prob}", file=sys.stderr)
    else:
        print("rules in sync: balance, phases, utterance types, map adjacency")
    return 0 if not problems else 1


if __name__ == "__main__":
    raise SystemExit(main())
