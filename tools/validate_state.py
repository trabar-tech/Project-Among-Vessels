#!/usr/bin/env python3
"""Game state-machine + balance invariant validator.

Checks tools/data/state_machine.json and tools/data/balance_defaults.json
against the rules in 02_AMONG_US_CORE.md §3/§8: reachability, terminal
coverage, win-condition exclusivity, voting math, cooldown invariants.

Usage:
  python3 tools/validate_state.py validate
  python3 tools/validate_state.py check-voting --votes Blue:3 Green:2 Pink:2 --alive 10
  python3 tools/validate_state.py demo

Exit codes: 0 = ok, 1 = invariant violated, 2 = usage error.
Stdlib only.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, deque
from pathlib import Path

BASE = Path(__file__).resolve().parent / "data"
SM_PATH = BASE / "state_machine.json"
BAL_PATH = BASE / "balance_defaults.json"


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def reachable_phases(sm: dict) -> set[str]:
    adj: dict[str, list[str]] = {}
    for t in sm["transitions"]:
        adj.setdefault(t["from"], []).append(t["to"])
    seen = {sm["initial_phase"]}
    queue = deque([sm["initial_phase"]])
    while queue:
        cur = queue.popleft()
        for nxt in adj.get(cur, []):
            if nxt not in seen:
                seen.add(nxt)
                queue.append(nxt)
    return seen


def validate(sm: dict, bal: dict) -> list[str]:
    problems: list[str] = []
    phases = set(sm["phases"])
    terminals = set(sm["terminal_phases"])
    # 1. All transition endpoints are known phases.
    for t in sm["transitions"]:
        for end in (t["from"], t["to"]):
            if end not in phases:
                problems.append(f"transition references unknown phase '{end}'")
    # 2. Every phase is reachable from the initial phase.
    reach = reachable_phases(sm)
    for ph in phases - reach:
        problems.append(f"phase '{ph}' is unreachable from '{sm['initial_phase']}'")
    # 3. Terminal phases have no outgoing transitions; non-terminals do.
    outgoing = {t["from"] for t in sm["transitions"]}
    for term in terminals:
        if term in outgoing:
            problems.append(f"terminal phase '{term}' has outgoing transitions")
    for ph in phases - terminals:
        if ph not in outgoing:
            problems.append(f"non-terminal phase '{ph}' has no outgoing transitions (dead end)")
    # 4. Win conditions must be unambiguous *per source phase*: from any one
    #    phase, two different guards must never lead to two different
    #    terminals under the same guard expression (that would be a race).
    per_source: dict[str, dict[str, set[str]]] = {}
    for t in sm["transitions"]:
        if t["to"] in terminals:
            per_source.setdefault(t["from"], {}).setdefault(t["guard"], set()).add(t["to"])
    for src, guardmap in per_source.items():
        for guard, dests in guardmap.items():
            if len(dests) > 1:
                problems.append(f"{src}: guard '{guard}' targets multiple terminals {sorted(dests)}")
    # 4b. Both factions must be able to win, and every terminal must be
    #     produced by an explicit transition (no orphan win states).
    produced = {t["to"] for t in sm["transitions"]}
    for term in terminals - produced:
        problems.append(f"terminal '{term}' is never produced by a transition")
    if not any(t.startswith("GAME_OVER_CREW") for t in terminals):
        problems.append("no crewmate win terminal defined")
    if not any(t.startswith("GAME_OVER_IMPOSTOR") for t in terminals):
        problems.append("no impostor win terminal defined")
    # 5. Balance invariants (mirrors state_machine.json invariants).
    if bal["impostors"] >= bal["players"] / 2:
        problems.append("impostors must be < half the players at start")
    if bal["kill_cooldown_seconds"] < 10:
        problems.append("kill_cooldown_seconds < 10 (too lethal)")
    if bal["sabotage_cooldown_seconds"] < 10:
        problems.append("sabotage_cooldown_seconds < 10")
    if bal["voting_seconds"] < 15:
        problems.append("voting_seconds < 15 (unplayable)")
    if bal["tasks"]["total_per_crewmate"] != (
        bal["tasks"]["common"] + bal["tasks"]["long"] + bal["tasks"]["short"]
    ):
        problems.append("task total != common+long+short")
    # 6. Parity rule sanity: impostors win at parity, so starting crew must
    #    strictly outnumber impostors by at least 2 (one kill + one eject
    #    must not be an instant loss from full strength).
    if bal["players"] - 2 * bal["impostors"] < 2:
        problems.append("starting crew margin < 2; parity loss too easy")
    return problems


def tally_votes(votes: Counter, alive: int) -> dict:
    """Among Us voting math: plurality ejects; tie or all-skip = no ejection."""
    total = sum(votes.values())
    if total > alive:
        raise ValueError(f"votes cast ({total}) exceed alive players ({alive})")
    if not votes:
        return {"ejected": None, "reason": "no votes"}
    top = votes.most_common()
    best_count = top[0][1]
    leaders = [name for name, count in top if count == best_count]
    if len(leaders) > 1:
        return {"ejected": None, "reason": f"tie among {leaders} at {best_count}"}
    if leaders[0].upper() == "SKIP":
        return {"ejected": None, "reason": "skip won plurality"}
    return {"ejected": leaders[0], "reason": f"plurality {best_count}/{total}"}


def parse_votes(spec: str) -> Counter:
    votes: Counter = Counter()
    for pair in spec.split():
        if ":" not in pair:
            raise ValueError(f"bad vote spec '{pair}'; expected Name:count")
        name, count = pair.split(":", 1)
        votes[name] += int(count)
    return votes


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="State-machine / balance validator")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("validate", help="validate state machine + balance files")
    pv = sub.add_parser("check-voting", help="tally a vote spec like 'Blue:3 Green:2'")
    pv.add_argument("--votes", required=True)
    pv.add_argument("--alive", type=int, required=True)
    sub.add_parser("demo", help="run the built-in checks and show output")
    args = p.parse_args(argv)

    if args.cmd == "validate":
        sm, bal = load_json(SM_PATH), load_json(BAL_PATH)
        problems = validate(sm, bal)
        if problems:
            for prob in problems:
                print(f"ERROR: {prob}", file=sys.stderr)
            return 1
        print(f"state machine OK: {len(sm['phases'])} phases, "
              f"{len(sm['transitions'])} transitions, {len(sm['terminal_phases'])} terminals")
        print(f"balance OK: {bal['players']} players, {bal['impostors']} impostors, "
              f"kill CD {bal['kill_cooldown_seconds']}s, voting {bal['voting_seconds']}s")
        return 0
    if args.cmd == "check-voting":
        try:
            result = tally_votes(parse_votes(args.votes), args.alive)
        except ValueError as e:
            print(f"ERROR: {e}", file=sys.stderr)
            return 1
        print(json.dumps(result, indent=2))
        return 0
    if args.cmd == "demo":
        sm, bal = load_json(SM_PATH), load_json(BAL_PATH)
        print("validate:", "OK" if not validate(sm, bal) else validate(sm, bal))
        print("reachable:", sorted(reachable_phases(sm)))
        print("tie example:", tally_votes(Counter({"Blue": 3, "Green": 3}), 10))
        print("plurality example:", tally_votes(Counter({"Blue": 4, "Green": 2, "SKIP": 1}), 10))
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
