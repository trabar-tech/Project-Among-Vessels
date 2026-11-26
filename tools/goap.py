"""GOAP planner + belief store, shared by goap_probe.py and sim_headless.py.

This is the *reference implementation* of 04_AI_ARCHITECTURE.md §4. It is
deliberately small and readable: the C# runtime (06_ENGINE_AND_3D.md) must be a
faithful port, and tools/check_rules.py + tools/goap_probe.py are how we prove it.

Design constraints taken from the doc:
  - Backward A* from goal over actions whose effects intersect unmet goal
    conditions (the F.E.A.R. trick) — not forward search over all actions.
  - Plan cap: 6 actions, 2000 expansions, hard cost ceiling.
  - Actions are data: preconditions, effects, cost, duration.
  - Agents plan only over BELIEFS they hold, never over world truth.

Stdlib only.
"""
from __future__ import annotations

import heapq
import itertools
from dataclasses import dataclass, field

_MISSING = object()

# Rooms used to instantiate parameterized actions (GOTO, FAKE_TASK, VENT_TO).
ROOMS = ("Cafeteria", "Electrical", "MedBay", "Reactor", "O2", "Admin",
         "Security", "Storage", "UpperEngine", "LowerEngine", "Navigation",
         "Shields", "Weapons", "Corridor")

MAX_PLAN = 6
MAX_EXPANSIONS = 2000
PLAN_COST_CEILING = 500.0


class PlanError(RuntimeError):
    pass


@dataclass(frozen=True)
class Action:
    name: str
    # (key, required_value) pairs; value may be a string/bool/number, or
    # "!x" meaning "must not equal x".
    pre: tuple[tuple[str, object], ...] = ()
    effects: tuple[tuple[str, object], ...] = ()
    cost: float = 1.0
    duration: float = 0.0
    role: str = "any"  # "crew" | "impostor" | "any"

    def applicable_in(self, state: dict) -> bool:
        """A precondition is (key, want). `want` may be ("!=VALUE") to mean
        'must not be VALUE'. Missing keys count as unequal."""
        for key, want in self.pre:
            have = state.get(key, _MISSING)
            if isinstance(want, str) and want.startswith("!="):
                if have == want[2:]:
                    return False
            elif have != want:
                return False
        return True


@dataclass(frozen=True)
class Goal:
    name: str
    conditions: tuple[tuple[str, object], ...]
    base_priority: float = 0.5


@dataclass
class Plan:
    goal: str
    actions: tuple[Action, ...]
    cost: float

    @property
    def length(self) -> int:
        return len(self.actions)

    def names(self) -> list[str]:
        return [a.name for a in self.actions]

    def duration(self) -> float:
        return sum(a.duration for a in self.actions)


def _satisfies(state: dict, conditions: tuple[tuple[str, object], ...]) -> bool:
    for key, want in conditions:
        if state.get(key) != want:
            return False
    return True


def _apply(state: dict, effects: tuple[tuple[str, object], ...]) -> dict:
    out = dict(state)
    for key, value in effects:
        out[key] = value
    return out


def plan(start: dict, goal: Goal, catalog: tuple[Action, ...]) -> Plan:
    """Backward A* from `goal` toward `start`.

    Raises PlanError when the goal is unreachable, the plan would exceed
    MAX_PLAN actions / PLAN_COST_CEILING, or the search blows MAX_EXPANSIONS.
    """
    if _satisfies(start, goal.conditions):
        return Plan(goal.name, (), 0.0)

    # Only actions that touch at least one goal condition (directly or
    # transitively) are worth considering. This is what keeps the search small.
    counter = itertools.count()
    # Node = (cost, tiebreak, remaining_conditions, plan_so_far, state_hint)
    # We search backward: pick an action that *achieves* an unmet condition,
    # then recurse on that action's preconditions merged with the rest.
    open_heap: list = []
    heapq.heappush(open_heap, (0.0, next(counter), goal.conditions, (), start))
    seen: set = set()
    expansions = 0

    while open_heap:
        cost, _, conditions, plan_acc, current = heapq.heappop(open_heap)
        expansions += 1
        if expansions > MAX_EXPANSIONS:
            raise PlanError(f"search exceeded {MAX_EXPANSIONS} expansions for goal '{goal.name}'")

        if _satisfies(current, conditions):
            acts = tuple(reversed(plan_acc))
            return Plan(goal.name, acts, cost)

        key = (tuple(sorted((k, str(v)) for k, v in conditions)), len(plan_acc))
        if key in seen:
            continue
        seen.add(key)

        for action in catalog:
            if action.role not in ("any", current.get("__role__", "any")):
                continue
            # Does this action achieve any currently-unmet condition?
            achieves = [
                (k, want) for k, want in conditions
                if any(ek == k and ev == want for ek, ev in action.effects)
            ]
            if not achieves:
                continue
            if len(plan_acc) + 1 > MAX_PLAN:
                continue
            # Remaining conditions after this action: drop the ones it achieves,
            # add its preconditions.
            remaining = tuple(c for c in conditions
                              if not any(ek == c[0] and ev == c[1] for ek, ev in action.effects))
            merged = remaining + action.pre
            new_cost = cost + action.cost
            if new_cost > PLAN_COST_CEILING:
                continue
            heapq.heappush(open_heap, (new_cost, next(counter), merged,
                                       plan_acc + (action,), current))
    raise PlanError(f"goal '{goal.name}' unreachable with the current catalog")


class BeliefStore:
    """Bounded, decaying memory of observations (04 §3.3).

    This is the ONLY input to suspicion. Nothing may write suspicion directly
    from world state; that invariant is what keeps the bots fair.
    """

    def __init__(self, capacity: int = 24, half_life: float = 90.0):
        self.capacity = capacity
        self.half_life = half_life
        self._obs: list[dict] = []

    def observe(self, obs: dict, now: float) -> None:
        obs = dict(obs)
        obs.setdefault("t", now)
        self._obs.append(obs)
        if len(self._obs) > self.capacity:
            # Drop the least valuable: lowest confidence * decayed weight.
            self._obs.sort(key=lambda o: o.get("confidence", 0.5)
                           * (0.5 ** ((now - o["t"]) / self.half_life)))
            self._obs = self._obs[-self.capacity:]

    def weight(self, obs: dict, now: float) -> float:
        age = max(0.0, now - obs["t"])
        return float(obs.get("confidence", 0.5)) * (0.5 ** (age / self.half_life))

    def all(self, now: float) -> list[tuple[dict, float]]:
        return [(o, self.weight(o, now)) for o in self._obs]

    def forget(self) -> None:
        self._obs.clear()


# --- Canonical catalogs ----------------------------------------------------
# 21 actions for v1 crew+impostor (04 §4.2). Kept in the same order as the doc
# so check_rules.py can prove engine parity by name and count.

WORD_STATE = {
    "at": "Cafeteria",
    "task_here": False,
    "task_done": False,
    "crisis_active": False,
    "crisis_station": "Reactor",
    "at_crisis": False,
    "body_visible": False,
    "threat_visible": False,
    "kill_ready": False,
    "in_range": False,
    "witnesses": 0,
    "at_vent": False,
    "sabotage_ready": False,
    "meeting_left": True,
    "in_shadow": False,
    "exhausted": False,
    "with_ally": False,
    "kill_cd": 0.0,
    "__role__": "crew",
}


def crew_catalog() -> tuple[Action, ...]:
    return (
        Action("GOTO", (("at", "!__target__"),), (("at", "__target__"),), cost=12.0, duration=12.0, role="crew"),
        Action("DO_TASK", (("task_here", True), ("task_done", False), ("crisis_active", False)),
               (("task_done", True),), cost=4.0, duration=8.0, role="crew"),
        Action("REPORT_BODY", (("body_visible", True),), (("meeting_left", True),), cost=2.0, role="crew"),
        Action("FIX_CRISIS", (("crisis_active", True), ("at_crisis", True)), (("crisis_active", False),),
               cost=6.0, duration=5.0, role="crew"),
        Action("USE_STATION", (("at", "Security"),), (("with_ally", True),), cost=4.0, duration=4.0, role="crew"),
        Action("FLEE", (("threat_visible", True),), (("threat_visible", False),), cost=8.0, duration=6.0, role="crew"),
        Action("GROUP_WITH", (("threat_visible", True),), (("with_ally", True),), cost=10.0, role="crew"),
        Action("HIDE", (("threat_visible", True),), (("in_shadow", True), ("threat_visible", False)),
               cost=5.0, duration=3.0, role="crew"),
        Action("INSPECT_BODY", (("body_visible", True),), (("body_visible", False),), cost=4.0, duration=4.0, role="crew"),
        Action("CALL_MEETING", (("at", "Cafeteria"), ("meeting_left", True)), (("meeting_left", False),),
               cost=6.0, role="crew"),
        Action("REST", (("exhausted", True),), (("exhausted", False),), cost=8.0, duration=8.0, role="crew"),
    )


def impostor_catalog() -> tuple[Action, ...]:
    return (
        Action("GOTO", (("at", "!__target__"),), (("at", "__target__"),), cost=12.0, duration=12.0, role="impostor"),
        Action("FAKE_TASK", (("at", "Electrical"),), (("task_done", False),), cost=8.0, duration=8.0, role="impostor"),
        Action("STALK", (("threat_visible", True),), (("in_range", True),), cost=6.0, role="impostor"),
        Action("KILL", (("kill_ready", True), ("in_range", True), ("witnesses", 0)),
               (("kill_ready", False), ("body_visible", True)), cost=1.5, duration=1.5, role="impostor"),
        Action("VENT_TO", (("at_vent", True),), (("at", "__target__"), ("witnesses", 0)), cost=5.0, role="impostor"),
        Action("SABOTAGE", (("sabotage_ready", True), ("crisis_active", False)), (("crisis_active", True),),
               cost=2.0, duration=2.0, role="impostor"),
        Action("LOCK_DOORS", (("sabotage_ready", True),), (("witnesses", 0),), cost=1.0, role="impostor"),
        Action("FRAME", (("meeting_left", True),), (("meeting_left", False),), cost=0.0, role="impostor"),
        Action("ALIBI", (("meeting_left", True),), (("meeting_left", False),), cost=0.0, role="impostor"),
        Action("SELF_REPORT", (("body_visible", True), ("witnesses", 0)), (("meeting_left", True),),
               cost=2.0, role="impostor"),
    )


def catalog_for(role: str) -> tuple[Action, ...]:
    """Template catalog (counted by the budget check: 21 actions)."""
    return crew_catalog() if role == "crew" else impostor_catalog()


def instantiate_catalog(role: str, state: dict, rooms: tuple[str, ...] = ROOMS) -> tuple[Action, ...]:
    """Bind parameterized actions to concrete rooms for THIS belief state.

    The planner needs concrete instances: `GOTO` must become `GOTO(Electrical)`.
    Instances already true in the current state are dropped (no travel to where
    you already are). This keeps the search space at ~21 + 2*len(rooms).
    """
    out: list[Action] = []
    here = state.get("at")
    crisis_room = state.get("crisis_station", "Reactor")
    for a in catalog_for(role):
        if a.name == "GOTO":
            for room in rooms:
                if room == here:
                    continue
                out.append(Action(f"GOTO({room})", (), (("at", room),), cost=a.cost,
                                  duration=a.duration, role=a.role))
        elif a.name == "FIX_CRISIS":
            out.append(Action(f"FIX_CRISIS({crisis_room})",
                              (("crisis_active", True), ("at", crisis_room)),
                              (("crisis_active", False),), cost=a.cost,
                              duration=a.duration, role=a.role))
        elif a.name == "FAKE_TASK":
            out.append(Action("FAKE_TASK", (("at", "Electrical"),), (("task_here", True),),
                              cost=a.cost, duration=a.duration, role=a.role))
        elif a.name == "VENT_TO":
            for room in rooms:
                if room == here:
                    continue
                out.append(Action(f"VENT_TO({room})",
                                  (("at_vent", True), ("witnesses", 0)),
                                  (("at", room),), cost=a.cost, duration=a.duration,
                                  role=a.role))
        else:
            out.append(a)
    return tuple(out)
