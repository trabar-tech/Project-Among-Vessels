#!/usr/bin/env python3
"""Headless AI simulation runner (no graphics, no LLM).

Runs a deliberately *lossy* model of the core loop from 02_AMONG_US_CORE.md
and 04_AI_ARCHITECTURE.md so tuning errors show up as bad win-rate
distributions before any game code exists.

Modelled systems
  - Crew task progression (dead crew still finish tasks, as in Among Us).
  - Impostor kills on cooldown, paced by the Director dread gauge.
  - Crisis sabotages that cost crew task time when unresolved.
  - Imperfect information: witnesses are unreliable, impostors plant
    suspicion on innocents, and crew abstain when unconfident.
  - Meeting -> noisy plurality vote -> ejection (tie/skip = no ejection).
  - Termination: task win, eject win, parity loss, sabotage loss.

The model is intentionally *not* a gameplay replica; it is a balance probe.
Deterministic per seed.

Usage:
  python3 tools/sim_headless.py --runs 300 --seed 42
  python3 tools/sim_headless.py sweep --runs 100
  python3 tools/sim_headless.py --players 12 --impostors 3 --runs 100 --out results.json

Stdlib only.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from dataclasses import dataclass, field
from pathlib import Path

BAL_PATH = Path(__file__).resolve().parent / "data" / "balance_defaults.json"
NAMES = ["Red", "Blue", "Green", "Pink", "Yellow", "Cyan", "Purple", "White",
         "Black", "Brown", "Orange", "Gray", "Lime", "Maroon", "Rose"]

# --- Model constants (documented tuning surface, see 02 §8) ---------------
WINNERS = ("crew_tasks", "crew_eject", "impostor_parity", "impostor_sabotage")


@dataclass(frozen=True)
class ModelParams:
    """Behavioural constants of the *simulation*, not of the game."""
    round_seconds: float = 30.0
    tasks_per_crew_round: float = 1.45      # task work rate while alive
    ghost_task_rate: float = 0.70           # dead crew work slower
    witness_chance: float = 0.30            # per living crew per kill
    witness_weight: tuple[float, float] = (0.20, 0.45)
    misattribute_chance: float = 0.15       # witness blames the wrong player
    impostor_frame_chance: float = 0.70     # per impostor per meeting
    impostor_frame_weight: tuple[float, float] = (0.12, 0.30)
    paranoia_per_round: float = 0.02        # ambient suspicion drift
    vote_confidence: float = 0.42           # below this, crew skip
    report_chance: float = 0.62             # body found before next kill
    sabotage_chance: float = 0.22           # per round while an impostor lives
    sabotage_unresolved: float = 0.10       # crisis not fixed in time
    sabotage_task_loss: float = 0.45        # tasks not done while diverting
    sabotage_time_seconds: float = 22.0
    # --- Quick-Chat meeting exchange (05_QUICKCHAT_GRAMMAR.md) -------------
    speak_threshold: float = 0.18           # min suspicion before an agent speaks
    utterances_per_agent: int = 2           # grammar: max 3 per speaker
    base_credibility: float = 0.60          # how much listeners trust a claim
    frame_credibility: float = 0.55         # impostor lies land slightly less
    credibility_decay: float = 0.35         # each repeat of the same claim is weaker
    propagation: float = 0.55               # fraction of a claim absorbed
    scapegoat_boost: float = 0.22           # impostor piles suspicion on an innocent
    vote_noise: float = 0.18                # chance a voter picks 2nd-best instead


@dataclass
class Agent:
    name: str
    is_impostor: bool
    tasks_left: int = 0
    suspicion: dict[str, float] = field(default_factory=dict)
    alive: bool = True
    kill_cd: float = 0.0


@dataclass
class SimResult:
    winner: str
    rounds: int
    kills: int
    ejections: int
    correct_ejections: int
    duration_seconds: float
    tasks_done: int
    tasks_total: int


def _clamp(x: float) -> float:
    return max(0.0, min(1.0, x))


def run_one(rng: random.Random, players: int, impostors: int, bal: dict,
            p: ModelParams | None = None) -> SimResult:
    p = p or ModelParams()
    agents = [Agent(NAMES[i], False) for i in range(players)]
    for a in rng.sample(agents, impostors):
        a.is_impostor = True
    by_name = {a.name: a for a in agents}
    tasks_each = bal["tasks"]["total_per_crewmate"]
    crew = [a for a in agents if not a.is_impostor]
    for a in crew:
        a.tasks_left = tasks_each
    for a in agents:
        for other in agents:
            if other is not a:
                a.suspicion[other.name] = rng.uniform(0.0, 0.08)

    kill_cd = float(bal["kill_cooldown_seconds"])
    kill_cd_left = kill_cd
    dread = 0.0
    dread_decay = float(bal["director"]["dread_decay_per_second"]) * p.round_seconds
    dread_peak = float(bal["director"]["dread_peak_threshold"])
    kills = ejections = correct = tasks_done = 0
    tasks_total = tasks_each * len(crew)
    t = 0.0
    round_no = 0
    meeting_gap = 0.0

    while round_no < 300:
        round_no += 1
        t += p.round_seconds
        alive = [a for a in agents if a.alive]
        alive_imps = [a for a in alive if a.is_impostor]
        alive_crew = [a for a in alive if not a.is_impostor]
        alive_crew_all = [a for a in agents if not a.is_impostor]

        # --- Termination (order mirrors 02 §3: eject, parity, sabotage, tasks)
        if not alive_imps:
            return SimResult("crew_eject", round_no, kills, ejections, correct, t,
                             tasks_done, tasks_total)
        if len(alive_imps) >= len(alive_crew):
            return SimResult("impostor_parity", round_no, kills, ejections, correct, t,
                             tasks_done, tasks_total)

        # --- Crew task work (ghosts keep working, at a reduced rate)
        for a in alive_crew_all:
            if a.tasks_left <= 0:
                continue
            rate = p.tasks_per_crew_round if a.alive else p.ghost_task_rate
            if rng.random() < rate:
                a.tasks_left -= 1
                tasks_done += 1

        # --- Sabotage: crisis forces diversion, costing task time
        diverted = False
        if alive_imps and rng.random() < p.sabotage_chance:
            if rng.random() < p.sabotage_unresolved:  # nobody reached the fix in time
                return SimResult("impostor_sabotage", round_no, kills, ejections,
                                 correct, t, tasks_done, tasks_total)
            diverted = True
            t += p.sabotage_time_seconds
            for a in alive_crew:
                if a.tasks_left > 0 and rng.random() < p.sabotage_task_loss:
                    pass  # time lost, no progress this round (modelled below)

        # --- Kills: at most one per round, gated by cooldown and the
        # Director dread gauge (04_AI_ARCHITECTURE.md §5). One shared kill
        # budget keeps this coarse 30s model from double-killing a round.
        dread = max(0.0, dread - dread_decay)
        kill_cd_left -= p.round_seconds
        killed_now = 0
        if kill_cd_left <= 0 and alive_crew and dread < dread_peak:
            imp = rng.choice(alive_imps)
            victim = rng.choice(alive_crew)
            victim.alive = False
            alive_crew.remove(victim)
            kills += 1
            killed_now = 1
            dread += 0.35
            kill_cd_left = kill_cd
            # Unreliable witnesses: most kills are unseen, and a minority of
            # sightings blame the wrong crewmate.
            for w in alive:
                if w in (imp, victim) or w.is_impostor:
                    continue
                if rng.random() < p.witness_chance:
                    blamed = imp.name
                    if rng.random() < p.misattribute_chance:
                        others = [x.name for x in alive if x not in (imp, w)]
                        if others:
                            blamed = rng.choice(others)
                    w.suspicion[blamed] = _clamp(
                        w.suspicion.get(blamed, 0) + rng.uniform(*p.witness_weight))

        # --- Ambient paranoia + impostor framing before the meeting
        for a in alive:
            for other in alive:
                if other is a:
                    continue
                a.suspicion[other.name] = _clamp(
                    a.suspicion.get(other.name, 0) + rng.uniform(0, p.paranoia_per_round))

        # --- Meeting
        meeting_gap += p.round_seconds
        meeting = killed_now > 0 and rng.random() < p.report_chance
        if not meeting and meeting_gap > 210 and rng.random() < 0.25:
            meeting = True  # emergency meeting pressure
        if not meeting:
            continue
        meeting_gap = 0.0
        # --- Meeting: Quick-Chat exchange, then vote ---------------------
        # Every agent states at most `utterances_per_agent` claims about their
        # strongest suspicion (ACCUSE) or an alibi for themselves (ALIBI).
        # Claims propagate through listeners with decaying credibility; an
        # impostor's ACCUSE is a lie and lands slightly softer (04 §7).
        # Impostors first choose a scapegoat: the living crewmate the room is
        # already most primed to doubt. This is the social-attack layer.
        for imp in [a for a in alive if a.is_impostor]:
            innocents = [a for a in alive if not a.is_impostor]
            if not innocents:
                continue
            heat = {a.name: sum(x.suspicion.get(a.name, 0.0) for x in alive)
                    for a in innocents}
            goat = max(heat, key=heat.get)
            if rng.random() < 0.8:
                imp.suspicion[goat] = _clamp(
                    imp.suspicion.get(goat, 0) + p.scapegoat_boost)

        claims: list[tuple[str, str, float]] = []  # (speaker, target, weight)
        speakers = list(alive)
        rng.shuffle(speakers)
        for spk in speakers:
            for _ in range(p.utterances_per_agent):
                cands = {n: v for n, v in spk.suspicion.items()
                         if n in by_name and by_name[n].alive and n != spk.name}
                if not cands:
                    break
                target, score = max(cands.items(), key=lambda kv: kv[1])
                if score < p.speak_threshold:
                    break
                claims.append((spk.name, target, score))
        # Apply claims to listeners.
        for speaker_name, target, strength in claims:
            speaker = by_name[speaker_name]
            cred = p.frame_credibility if speaker.is_impostor else p.base_credibility
            for listener in alive:
                if listener.name in (speaker_name, target):
                    continue
                # Trust: listeners discount speakers they already suspect,
                # and an impostor lying about a crewmate they were seen near
                # is discounted by the credibility decay.
                trust = _clamp(1.0 - listener.suspicion.get(speaker_name, 0.0))
                delta = cred * trust * p.propagation * min(0.35, strength) * p.credibility_decay
                listener.suspicion[target] = _clamp(
                    listener.suspicion.get(target, 0) + delta)
        # --- Vote: highest-suspicion living player if confident, else skip
        votes: dict[str, int] = {}
        for v in alive:
            cands = {n: s2 for n, s2 in v.suspicion.items()
                     if n in by_name and by_name[n].alive and n != v.name}
            if not cands:
                continue
            ranked = sorted(cands.items(), key=lambda kv: kv[1], reverse=True)
            pick, score = ranked[0]
            if len(ranked) > 1 and rng.random() < p.vote_noise:
                pick, score = ranked[1]
            if score >= p.vote_confidence:
                votes[pick] = votes.get(pick, 0) + 1
            else:
                votes["SKIP"] = votes.get("SKIP", 0) + 1
        if not votes:
            continue
        top = max(votes.values())
        leaders = [n for n, c in votes.items() if c == top]
        if len(leaders) == 1 and leaders[0] != "SKIP":
            ejected = by_name[leaders[0]]
            ejected.alive = False
            ejections += 1
            if ejected.is_impostor:
                correct += 1
                # The crew learns: surviving impostors become a bit more suspected.
                for a in agents:
                    if a.alive and not a.is_impostor:
                        for imp in [x for x in alive if x.is_impostor]:
                            a.suspicion[imp.name] = _clamp(
                                a.suspicion.get(imp.name, 0) + 0.05)
            else:
                # A mis-eject is costly social capital: the accuser is distrusted.
                for a in agents:
                    if a.alive:
                        for spk_name, tgt, _ in claims:
                            if tgt == leaders[0]:
                                a.suspicion[spk_name] = _clamp(
                                    a.suspicion.get(spk_name, 0) + 0.10)
    return SimResult("impostor_sabotage", round_no, kills, ejections, correct, t,
                     tasks_done, tasks_total)


def summarise(results: list[SimResult]) -> dict:
    n = len(results)
    by_winner: dict[str, int] = {}
    for r in results:
        by_winner[r.winner] = by_winner.get(r.winner, 0) + 1
    ejections = sum(r.ejections for r in results)
    return {
        "runs": n,
        "win_rates": {k: round(v / n, 3) for k, v in sorted(by_winner.items())},
        "crew_win_rate": round(sum(v for k, v in by_winner.items() if k.startswith("crew")) / n, 3),
        "avg_rounds": round(sum(r.rounds for r in results) / n, 2),
        "avg_kills": round(sum(r.kills for r in results) / n, 2),
        "avg_ejections": round(ejections / n, 2),
        "eject_accuracy": round(
            sum(r.correct_ejections for r in results) / max(1, ejections), 3),
        "avg_duration_seconds": round(sum(r.duration_seconds for r in results) / n, 1),
        "task_completion_at_end": round(
            sum(r.tasks_done / max(1, r.tasks_total) for r in results) / n, 3),
    }


def load_balance() -> dict:
    with BAL_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Headless balance simulation")
    p.add_argument("cmd", nargs="?", default="run", choices=["run", "sweep", "demo", "guard"])
    p.add_argument("--players", type=int, default=None)
    p.add_argument("--impostors", type=int, default=None)
    p.add_argument("--runs", type=int, default=100)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--out", type=Path, default=None, help="write JSON summary here")
    args = p.parse_args(argv)

    bal = load_balance()
    players = args.players or bal["players"]
    impostors = args.impostors or bal["impostors"]
    if impostors >= players / 2:
        print("ERROR: impostors must be < half of players", file=sys.stderr)
        return 1

    if args.cmd == "demo":
        rng = random.Random(args.seed)
        for _ in range(3):
            print(run_one(rng, players, impostors, bal))
        return 0

    if args.cmd == "guard":
        # Regression guard: default tuning must keep a contested match.
        # Band documented in 02_AMONG_US_CORE.md §8 and 01_DEV_TOOLS.md.
        lo, hi = 0.30, 0.60
        rng = random.Random(args.seed)
        results = [run_one(rng, players, impostors, bal) for _ in range(args.runs)]
        s = summarise(results)
        rate = s["crew_win_rate"]
        status = "OK" if lo <= rate <= hi else "FAIL"
        print(f"guard: crew_win_rate={rate} band=[{lo},{hi}] -> {status}")
        print(json.dumps(s, indent=2))
        return 0 if status == "OK" else 1

    if args.cmd == "sweep":
        grid = []
        for report in (0.45, 0.62, 0.80):
            for conf in (0.34, 0.42, 0.52):
                rng = random.Random(args.seed)
                res = [run_one(rng, players, impostors, bal,
                               ModelParams(report_chance=report, vote_confidence=conf))
                       for _ in range(args.runs)]
                s = summarise(res)
                grid.append({"report_chance": report, "vote_confidence": conf,
                             "crew_win_rate": s["crew_win_rate"],
                             "avg_rounds": s["avg_rounds"]})
        print(json.dumps(grid, indent=2))
        return 0

    rng = random.Random(args.seed)
    results = [run_one(rng, players, impostors, bal) for _ in range(args.runs)]
    summary = summarise(results)
    summary.update({"players": players, "impostors": impostors, "seed": args.seed})
    print(json.dumps(summary, indent=2))
    if args.out:
        args.out.write_text(json.dumps(summary, indent=2), encoding="utf-8")
        print(f"wrote {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
