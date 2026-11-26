# Project Among Vessels

> A single-player Among Us sandbox aboard a dying ship: social deduction as the spine,
> SIGNALIS dread as the lens, Project Zomboid pressure as the texture, F.E.A.R. planning and
> Alien: Isolation direction as the brains, and a closed Quick-Chat grammar as the only voice.

**Status: Phase 1 complete — architectural foundation.** This repository contains design documents
and backend verification tooling only. No game client, no web UI, no renderer yet.

---

## The pitch in one paragraph

Ten crewmates. Two of them are lying. You are one of the eight — or maybe you are not. The ship is a
cold industrial machine that hums at the wrong pitch, lit for a purpose you are not part of. Tasks keep
it alive; the impostor kills it a body at a time; sabotage buys the silence needed for a murder while
the crew scatters to fix a dying reactor. Between the sirens you have to answer one question: *who was
where, and do I believe them?* The bots are not scripted actors. They plan, they get tired, they make
noise, they forget, they lie, and they can be talked into killing the wrong person.

---

## What is in this repository

### Design suite (read in order)

| Doc | Contents | Canonical data it defines |
|---|---|---|
| [00_SWOT_AND_STRATEGY.md](00_SWOT_AND_STRATEGY.md) | Honest self-assessment, pillar-conflict map, build order, cut order, decision log | — |
| [01_DEV_TOOLS.md](01_DEV_TOOLS.md) | The verification suite, CI contract, bug postmortems, planned Phase 2 tools | — |
| [02_AMONG_US_CORE.md](02_AMONG_US_CORE.md) | Loop deconstruction, map flow, phases, task pacing math, vision, sabotage, voting, win conditions, launch tuning | `state_machine.json`, `balance_defaults.json` |
| [03_HYBRID_MECHANICS.md](03_HYBRID_MECHANICS.md) | SIGNALIS aesthetic as mechanical constraint; Zomboid moodles, noise propagation, LOS, inventory; budget caps | (reads `balance_defaults.json`) |
| [04_AI_ARCHITECTURE.md](04_AI_ARCHITECTURE.md) | Director → Squad → GOAP → Sensors; suspicion model; lying policy; personas; fairness invariants | — |
| [05_QUICKCHAT_GRAMMAR.md](05_QUICKCHAT_GRAMMAR.md) | Formal grammar, EBNF, semantic tags, suspicion mathematics, truthfulness protocol, worked transcript | `quickchat_grammar.json` |

### Tooling (stdlib Python 3.11, no dependencies)

| Tool | Purpose |
|---|---|
| [`tools/qc_parse.py`](tools/qc_parse.py) | Quick-Chat grammar parser, validator, and fuzzer |
| [`tools/validate_state.py`](tools/validate_state.py) | Phase-machine reachability/invariant checks + Among Us voting math |
| [`tools/sim_headless.py`](tools/sim_headless.py) | Seeded headless balance simulation with Quick-Chat meetings, lying, and the Director dread gauge |
| [`tools/check_docs.py`](tools/check_docs.py) | Documentation cross-reference and stub checker |
| [`tools/tests/test_tools.py`](tools/tests/test_tools.py) | 18 tests asserting design properties, not just liveness |

Canonical data lives in [`tools/data/`](tools/data). **Where a document and a JSON file disagree, the
JSON wins and the document must be corrected.**

---

## Quick start

```bash
# Full verification gate (any failure blocks a merge)
python3 tools/qc_parse.py validate
python3 tools/qc_parse.py fuzz --count 300
python3 tools/validate_state.py validate
python3 tools/sim_headless.py guard --runs 300
python3 tools/check_docs.py --strict
python3 -m unittest discover -s tools/tests
```

Try the interesting bits:

```bash
# What does an NPC utterance actually mean?
python3 tools/qc_parse.py parse "VENT_SIGHTING TARGET=Blue LOCATION=Electrical" --speaker Red

# Is this vote a tie (no ejection) or a plurality (ejection)?
python3 tools/validate_state.py check-voting --votes Blue:3 Green:3 --alive 10
python3 tools/validate_state.py check-voting --votes Blue:4 Green:2 SKIP:1 --alive 10

# Is the game degenerate? (300 seeded matches)
python3 tools/sim_headless.py --runs 300 --seed 42

# Tuning sensitivity grid
python3 tools/sim_headless.py sweep --runs 80
```

---

## Current balance evidence (10 players, 2 impostors, seed 42, 300 runs)

| Metric | Value |
|---|---|
| Crew win rate | **0.42** (guard band 0.30–0.60) |
| Impostor win — parity | 0.44 |
| Impostor win — sabotage | 0.14 |
| Kills per match | 5.3 |
| Ejections per match | 1.4 |
| Eject accuracy | 0.81 (lies land ~19% of the time) |
| Mean match length | ~214 s |

The first version of this simulation produced a 97% crew win rate. The second produced 1%. Both looked
reasonable on paper. That is the entire argument for Phase 1 tooling.

---

## Design invariants (the short list)

1. The Among Us loop is the spine. Every other system attaches to one of its five beats or is cut.
2. No survival system blocks the social loop for more than 90 seconds (the 90-second rule).
3. Moodles degrade capability; they never kill.
4. Vision asymmetry is an information advantage, not a combat one.
5. Ties and skips eject nobody — abstention is a weapon.
6. The Director may know everything; no agent may act on what the Director knows.
7. Beliefs update only from `Observation` records. There is no back door from world state to suspicion.
8. Crewmate NPCs cannot lie — the generation function rejects ungrounded claims. Only impostors have a
   `may_lie` path, and every lie is logged.
9. All NPC speech is the frozen 15-type grammar. No runtime LLM text, ever.
10. If a design claim cannot be checked by a command in `tools/`, it is taste (log it) or not yet
    understood (don't build it).

---

## Roadmap

| Phase | Scope | Exit criterion |
|---|---|---|
| **1 (done)** | Design suite + verification tooling | Full gate green; docs and JSON agree |
| **2** | Headless vertical slice: one map graph, 10 agents, GOAP, Quick-Chat meetings, spatial sim | `sim_headless.py guard` passes **and** a human reads a meeting transcript and believes it |
| **3** | Presentation shell: renderer, CRT/UI direction, audio gates | Loop unchanged; only perception added |
| **4** | Content: maps, tasks, personas, authoring tools | Replayability without new mechanics |

Phase 2 tools already specified: `goap_probe.py`, `noise_probe.py`, `transcript_check.py`,
`map_lint.py` (see [01](01_DEV_TOOLS.md) §7).

---

## Reference vocabulary

Internal documents cite **Among Us**, **SIGNALIS**, **Project Zomboid**, **F.E.A.R.**, and
**Alien: Isolation** as design reference only. No reference-game assets, names, or trademarks belong
in shipped material. Public framing is original.

## License

Public domain (Unlicense) — see [LICENSE](LICENSE).
