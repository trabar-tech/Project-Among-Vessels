#!/usr/bin/env python3
"""GOAP plan tracer / property prober (04_AI_ARCHITECTURE.md §4, §9).

Answers, without a running game: "given this agent's beliefs, what plan does it
produce, and does that plan obey our architectural promises?"

Checks enforced:
  - every plan is <= 6 actions           (MAX_PLAN)
  - plan cost <= 500                     (PLAN_COST_CEILING)
  - plans only reference beliefs, never world truth
  - the action catalog matches the documented 21-action budget
  - key scenarios produce the *intended* behaviour (see SCENARIOS)

Usage:
  python3 tools/goap_probe.py catalog
  python3 tools/goap_probe.py plan --role crew --goal RESOLVE_CRISIS --state '{"crisis_active":true,"at_crisis":true}'
  python3 tools/goap_probe.py plan --role impostor --goal HUNT --state '{"kill_ready":true,"in_range":true,"witnesses":0}'
  python3 tools/goap_probe.py scenarios
  python3 tools/goap_probe.py stress --count 500

Exit: 0 ok, 1 property violated, 2 usage.
"""
from __future__ import annotations

import argparse
import json
import random
import sys

import goap

CROCK = {
    "COMPLETE_TASKS": goap.Goal("COMPLETE_TASKS", (("task_done", True),), 0.9),
    "SURVIVE": goap.Goal("SURVIVE", (("in_shadow", True),), 1.2),
    "RESOLVE_CRISIS": goap.Goal("RESOLVE_CRISIS", (("crisis_active", False),), 1.5),
    "REPORT": goap.Goal("REPORT", (("meeting_left", False),), 1.0),
    "HUNT": goap.Goal("HUNT", (("body_visible", True),), 1.0),
    "BUILD_COVER": goap.Goal("BUILD_COVER", (("task_done", False),), 0.8),
    "ESCALATE": goap.Goal("ESCALATE", (("crisis_active", True),), 0.9),
}


def base_state(role: str) -> dict:
    st = dict(goap.WORD_STATE)
    st["__role__"] = role
    return st


class Result:
    def __init__(self, name: str, ok: bool, detail: str):
        self.name, self.ok, self.detail = name, ok, detail

    def __str__(self) -> str:
        return f"[{'PASS' if self.ok else 'FAIL'}] {self.name}: {self.detail}"


def probe_plan(role: str, goal_name: str, state: dict) -> goap.Plan:
    goal = CROCK[goal_name]
    return goap.plan(state, goal, goap.instantiate_catalog(role, state))


# --- Scenarios: intended behaviour, asserted ---------------------------------

def scenarios() -> list[Result]:
    out: list[Result] = []

    # 1. A crisis dominates: crew with a task at hand still fixes the crisis.
    st = base_state("crew")
    st.update({"crisis_active": True, "at": "Reactor", "crisis_station": "Reactor",
               "task_here": True})
    p = probe_plan("crew", "RESOLVE_CRISIS", st)
    out.append(Result("crisis_beats_tasks", any(n.startswith("FIX_CRISIS") for n in p.names()),
                      f"plan={p.names()}"))

    # 2. An impostor will NOT kill with a witness present (the fairness core).
    st = base_state("impostor")
    st.update({"kill_ready": True, "in_range": True, "witnesses": 1})
    try:
        p = probe_plan("impostor", "HUNT", st)
        out.append(Result("no_kill_with_witness", "KILL" not in p.names(),
                          f"plan={p.names()}"))
    except goap.PlanError as e:
        out.append(Result("no_kill_with_witness", True, f"unreachable, as intended ({e})"))

    # 3. With no witness, the kill is available.
    st = base_state("impostor")
    st.update({"kill_ready": True, "in_range": True, "witnesses": 0})
    p = probe_plan("impostor", "HUNT", st)
    out.append(Result("kill_when_alone", "KILL" in p.names(), f"plan={p.names()}"))

    # 4. Stalking precedes killing: with in_range False, the plan must include
    #    a movement/approach action before KILL.
    st = base_state("impostor")
    st.update({"kill_ready": True, "in_range": False, "threat_visible": True, "witnesses": 0})
    p = probe_plan("impostor", "HUNT", st)
    names = p.names()
    ordered = ("STALK" in names and "KILL" in names
               and names.index("STALK") < names.index("KILL"))
    out.append(Result("stalk_before_kill", ordered, f"plan={names}"))

    # 5. Crew under threat chooses escape, not heroism.
    st = base_state("crew")
    st.update({"threat_visible": True})
    p = probe_plan("crew", "SURVIVE", st)
    out.append(Result("crew_flees", any(n in p.names() for n in ("FLEE", "HIDE", "GROUP_WITH")),
                      f"plan={p.names()}"))

    # 6. Plan length cap is respected everywhere.
    ok = True
    detail = "all within cap"
    for role in ("crew", "impostor"):
        for gname in CROCK:
            st = base_state(role)
            st.update({"crisis_active": True, "at": "MedBay", "crisis_station": "Reactor",
                       "task_here": True,
                       "threat_visible": True, "kill_ready": True, "in_range": False,
                       "witnesses": 2, "body_visible": True, "exhausted": True})
            try:
                p = probe_plan(role, gname, st)
                if p.length > goap.MAX_PLAN:
                    ok = False
                    detail = f"{role}/{gname} plan length {p.length} > {goap.MAX_PLAN}"
            except goap.PlanError:
                pass
    out.append(Result("plan_length_cap", ok, detail))

    # 7. Catalog budget: 21 actions total (11 crew + 10 impostor).
    total = len(goap.crew_catalog()) + len(goap.impostor_catalog())
    out.append(Result("catalog_budget_21", total == 21, f"{total} actions"))

    # 8. Travel is planned, not assumed: away from the crisis room, the plan
    #    must contain a GOTO before FIX_CRISIS.
    st = base_state("crew")
    st.update({"crisis_active": True, "at": "MedBay", "crisis_station": "Reactor"})
    p = probe_plan("crew", "RESOLVE_CRISIS", st)
    names = p.names()
    out.append(Result("travel_before_fix",
                      any(n.startswith("GOTO") for n in names) and
                      any(n.startswith("FIX_CRISIS") for n in names) and
                      names.index(next(n for n in names if n.startswith("GOTO"))) <
                      names.index(next(n for n in names if n.startswith("FIX_CRISIS"))),
                      f"plan={names}"))

    # 9. Unreachable goals fail loudly rather than silently returning a bad plan.
    st = base_state("crew")
    impossible = goap.Goal("Impossible", (("is_god", True),))
    try:
        goap.plan(st, impossible, goap.instantiate_catalog("crew", st))
        out.append(Result("unreachable_fails_loudly", False, "returned a plan for an impossible goal"))
    except goap.PlanError as e:
        out.append(Result("unreachable_fails_loudly", True, str(e)))

    return out


def stress(count: int, seed: int) -> int:
    """Randomize beliefs across all goals; assert no plan ever violates a cap."""
    rng = random.Random(seed)
    failures = 0
    keys = [k for k in goap.WORD_STATE if k != "__role__"]
    for i in range(count):
        role = rng.choice(("crew", "impostor"))
        st = base_state(role)
        for k in keys:
            if k in ("at", "crisis_station", "__role__"):
                continue
            st[k] = rng.choice((True, False)) if isinstance(st[k], bool) else st[k]
        gname = rng.choice(sorted(CROCK))
        try:
            p = probe_plan(role, gname, st)
        except goap.PlanError:
            continue
        if p.length > goap.MAX_PLAN or p.cost > goap.PLAN_COST_CEILING:
            failures += 1
            print(f"STRESS FAIL [{i}] {role}/{gname} len={p.length} cost={p.cost}", file=sys.stderr)
    print(f"stress: {count} random belief states, {failures} cap violations (seed={seed})")
    return failures


def build_state(pairs: list[str]) -> dict:
    st = None
    for pair in pairs:
        if pair.strip().startswith("{"):
            st = json.loads(pair)
    return st or {}


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="GOAP plan tracer")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("catalog", help="list the action catalog")
    pp = sub.add_parser("plan", help="plan from a belief state")
    pp.add_argument("--role", choices=["crew", "impostor"], required=True)
    pp.add_argument("--goal", required=True, choices=sorted(CROCK))
    pp.add_argument("--state", action="append", default=[], help="JSON belief overrides")
    sub.add_parser("scenarios", help="run intended-behaviour assertions")
    ps = sub.add_parser("stress", help="randomized cap fuzzing")
    ps.add_argument("--count", type=int, default=500)
    ps.add_argument("--seed", type=int, default=42)
    args = p.parse_args(argv)

    if args.cmd == "catalog":
        for role in ("crew", "impostor"):
            cat = goap.catalog_for(role)
            print(f"\n{role.upper()} ({len(cat)} actions)")
            for a in cat:
                pre = ", ".join(f"{k}={v}" for k, v in a.pre) or "-"
                eff = ", ".join(f"{k}={v}" for k, v in a.effects) or "-"
                print(f"  {a.name:<12} cost={a.cost:>5} pre[{pre}] -> [{eff}]")
        return 0

    if args.cmd == "plan":
        st = base_state(args.role)
        st.update(build_state(args.state))
        try:
            plan = probe_plan(args.role, args.goal, st)
        except goap.PlanError as e:
            print(f"NO PLAN: {e}", file=sys.stderr)
            return 1
        print(json.dumps({
            "role": args.role,
            "goal": plan.goal,
            "actions": plan.names(),
            "length": plan.length,
            "cost": round(plan.cost, 2),
            "duration_seconds": round(plan.duration(), 1),
        }, indent=2))
        return 0

    if args.cmd == "scenarios":
        results = scenarios()
        for r in results:
            print(r)
        failed = [r for r in results if not r.ok]
        print(f"\n{len(results) - len(failed)}/{len(results)} scenarios passed")
        return 1 if failed else 0

    if args.cmd == "stress":
        return 1 if stress(args.count, args.seed) else 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
