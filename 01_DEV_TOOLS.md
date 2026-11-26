# 01 — Dev Tools

**Project Among Vessels** · Phase 1 deliverable · Status: **operational**
Mirrors: [00_SWOT_AND_STRATEGY.md](00_SWOT_AND_STRATEGY.md) §W · Feeds: [02](02_AMONG_US_CORE.md), [04](04_AI_ARCHITECTURE.md), [05](05_QUICKCHAT_GRAMMAR.md)

> Every weakness named in the SWOT gets an instrument here. Tools are standard-library Python 3.11,
> deterministic, dependency-free, and runnable in CI. **Canonical data lives in `tools/data/*.json`;
> the prose documents must follow it, never the reverse.**

---

## Tools at a glance

| Tool | Answers the question | Weakness it neutralizes |
|---|---|---|
| [`tools/qc_parse.py`](#1-toolsqc_parsepy--quick-chat-grammar-parser) | "Is this NPC utterance legal, and what does it mean?" | Hallucinated grammar drift, LLM temptation |
| [`tools/validate_state.py`](#2-toolsvalidate_statepy--state-machine--balance-validator) | "Can the game reach every state and end? Is the voting math right?" | Over-engineering, unreachable states, bad win math |
| [`tools/sim_headless.py`](#3-toolssim_headlesspy--headless-ai-simulation-runner) | "Is the tuning degenerate?" | Balance blindness |
| [`tools/check_docs.py`](#4-toolscheck_docspy--documentation-cross-reference-checker) | "Do the docs still agree with reality?" | Context decay, doc/tool divergence |
| [`tools/goap_probe.py`](#8-toolsgoap_probepy--goap-plan-tracer) | "What plan will this agent produce, and does it obey our caps?" | Untestable AI architecture, over-engineering |
| [`tools/check_rules.py`](#9-toolscheck_rulespy--enginetooling-parity-gate) | "Do the game and the tools still agree on the rules?" | Two implementations silently drifting |
| [`tools/tests/test_tools.py`](#5-testing) | "Did any of the above stop working?" | Verification theater |

```
tools/
├── data/
│   ├── quickchat_grammar.json    # canonical grammar (05)
│   ├── balance_defaults.json     # canonical tuning (02 §8, 03 §7)
│   └── state_machine.json        # canonical phase graph (02 §3)
├── qc_parse.py
├── validate_state.py
├── sim_headless.py
├── check_docs.py
└── tests/test_tools.py
```

---

## 1. `tools/qc_parse.py` — Quick-Chat grammar parser

**Purpose.** Executable specification of [05_QUICKCHAT_GRAMMAR.md](05_QUICKCHAT_GRAMMAR.md). Turns a
constrained utterance into an AST plus a suspicion delta. This is the *same* parser the meeting UI and
NPC brains will use in Phase 2 — no second implementation to drift.

**Design.** Utterance form is `TYPE KEY=VALUE ...` with `SPEAKER` carried out-of-band (it is the
channel, not a slot). Validation is layered: type exists → slots allowed for that type → required
slots present → values inside their vocabulary → social constraints (`speaker != target`) → suspicion
delta computed. Errors are human-readable and quote the offending token.

```bash
python3 tools/qc_parse.py validate                       # grammar file self-check
python3 tools/qc_parse.py parse "ACCUSE TARGET=Blue EVIDENCE=VENT" --speaker Red
python3 tools/qc_parse.py demo                           # seven worked examples
python3 tools/qc_parse.py fuzz --count 300 --seed 5      # generate+reparse, expect 0 failures
```

```jsonc
// parse output (abridged)
{
  "type": "ACCUSE",
  "speaker": "Red",
  "slots": { "TARGET": "Blue", "EVIDENCE": "VENT" },
  "suspicion_delta": { "target": "Blue", "delta": 0.3 },
  "render": "Red accuses Blue: VENT."
}
```

**Deliberate choices.**
- *`render` is generated, not stored per phrase.* One template per utterance type keeps the vocabulary
  small and the localisation surface tiny. Variant flavour text is an authoring-time concern.
- *Suspicion deltas live in the grammar file*, not in code, so tuning is data-only.
- *Fuzz mode exists because hand-written examples only test what I thought of.* It generates
  structurally valid utterances across every type and asserts they re-parse — catching missing
  vocabularies and bad render templates automatically. It caught three real bugs on first run
  (`LOCATION` vs `LOCATIONS` vocabulary naming, `TARGET` placeholder collisions, optional-slot render
  crashes).

**Bug postmortem (evidence the tool works).** First `validate` run failed with 18 errors: singular
slot names had no plural vocabulary mapping, and render templates collided on `TARGET`. Both were
invisible to prose review and fatal to runtime. This is the *argument for* Phase 1 tooling.

---

## 2. `tools/validate_state.py` — state machine + balance validator

**Purpose.** Proves the game can reach every phase, terminate every way, and that the voting math
matches Among Us. Guards the invariants in [02_AMONG_US_CORE.md](02_AMONG_US_CORE.md) §3 and §8.

**Checks performed.**
1. Every transition endpoint is a declared phase.
2. Every phase is reachable from `LOBBY` (BFS over the graph).
3. Terminal phases have no outgoing edges; non-terminals have no dead ends.
4. No source phase can reach two *different* terminals under the same guard expression (win races).
5. Both factions have at least one terminal, and every terminal is produced by a transition.
6. Balance: impostors < half the players; cooldowns ≥ 10s; voting ≥ 15s; task counts sum correctly;
   starting crew margin ≥ 2 (so one kill + one ejection is not an instant parity loss).

```bash
python3 tools/validate_state.py validate
# state machine OK: 10 phases, 11 transitions, 4 terminals
# balance OK: 10 players, 2 impostors, kill CD 27.5s, voting 90s

python3 tools/validate_state.py check-voting --votes Blue:3 Green:3 --alive 10   # -> no ejection
python3 tools/validate_state.py check-voting --votes SKIP:5 Blue:2 --alive 10    # -> no ejection
python3 tools/validate_state.py check-voting --votes Blue:4 Green:2 SKIP:1 --alive 10  # -> Blue
```

**Voting math implemented** (faithful to Among Us): strict plurality ejects; **any tie ejects nobody**;
a `SKIP` plurality ejects nobody; votes cast cannot exceed living players. This is the exact rule that
makes abstention strategically meaningful — and the reason NPC abstention is a modelled behaviour.

**Bug postmortem.** The first version flagged the shipped file as having "duplicate terminal guards"
because two different source phases both legitimately ended in `GAME_OVER_IMPOSTOR_PARITY`. The check
was wrong, not the data: ambiguity only matters *per source phase*. Rewriting it as a per-source map
kept the useful invariant and removed the false positive.

---

## 3. `tools/sim_headless.py` — headless AI simulation runner

**Purpose.** Statistical balance evidence with zero rendering, zero LLM, and full determinism per seed.
This is the instrument for the SWOT's "balance blindness" weakness.

**What it models** (deliberately lossy — it is a *probe*, not the game):
- Crew task progression; dead crew keep working at a reduced rate (faithful to Among Us).
- One kill per round, gated by kill cooldown *and* the Director dread gauge.
- Crisis sabotages that cost task time and occasionally end the round outright.
- **Imperfect information:** most kills are unseen; a minority of sightings blame the wrong player.
- **Quick-Chat meeting exchange:** each agent speaks at most twice, accusing their strongest
  suspicion if it clears a threshold; claims propagate to listeners scaled by *speaker trust* and
  *claim strength*, and impostor claims land at lower credibility.
- **Social attack layer:** impostors choose a *scapegoat* — the crewmate the room is already primed
  to doubt — and push that name.
- Trust-weighted plurality vote with abstention below a confidence threshold and vote noise.
- Mis-ejection backfires on the accuser (distrust), so lying badly is punished.

**Commands.**

```bash
python3 tools/sim_headless.py --runs 300 --seed 42     # summary JSON
python3 tools/sim_headless.py guard --runs 300         # CI gate: crew win in [0.30, 0.60]
python3 tools/sim_headless.py sweep --runs 80          # grid over report_chance × vote_confidence
python3 tools/sim_headless.py demo                     # three raw round-by-round results
```

**Measured results at default tuning** (10 players, 2 impostors, 300 runs, seed 42):

| Metric | Value | Interpretation |
|---|---|---|
| Crew win rate | **0.42** | Contested; inside guard band |
| Impostor win by parity | 0.44 | Parity is the impostor's main path |
| Impostor win by sabotage | 0.14 | Crises are a punctuation, not a coin-flip |
| Avg kills / match | 5.3 | Matches the ~6-death arc of a real 10-player match |
| Avg ejections / match | 1.4 | Meetings are scarce and consequential |
| Eject accuracy | 0.81 | **Lies land ~19% of the time** — the design target |
| Task completion at end | 0.80 | Task-win stays a live threat |
| Avg duration | ~214s | Real-time pacing target |

**Sweep evidence (why the default is the default):** 9-point grid over `report_chance` ×
`vote_confidence`, 120 runs per cell, seed 42. Crew win rate:

| `report_chance` \ `vote_confidence` | 0.34 | 0.42 | 0.52 |
|---|---|---|---|
| **0.45** (rarely found bodies) | 0.275 | 0.167 | 0.133 |
| **0.62** (default) | 0.558 | **0.433** | 0.350 |
| **0.80** (bodies always found) | 0.683 | 0.700 | 0.492 |

Both dials move the outcome monotonically, in the directions intuition predicts — but the *range* is
what matters: the same rules produce anywhere from a 13% to a 70% crew win rate depending on two
numbers. That is the tuning surface the game's feel lives on, and it is now measured rather than
argued about. The default sits deliberately in the middle of the grid, in the flattest, most
contested region.

The first model — *before* the Quick-Chat exchange was implemented — produced **97% crew wins** and
then, after one fix, **1%**. Both are degenerate, and both looked plausible on paper. Only the sim
found them. The final model's sensitivity to `report_chance` and `vote_confidence` is exactly the
tuning surface design needs to own.

**Known limits (stated, not hidden).** No spatial model (distances and vision cones are abstracted);
no per-room occupancy; no door locks; no vent routing; no per-agent memory of exact positions. Phase 2
adds a graph-based spatial layer. Until then, treat the sim as directional, not definitive.

---

## 4. `tools/check_docs.py` — documentation cross-reference checker

**Purpose.** Prevent the doc suite from rotting into a set of beautiful lies. Verifies required docs
exist, required headings are present, every internal markdown link resolves, and (in `--strict`) no
`TODO`/`FIXME` remains in a "frozen" document.

```bash
python3 tools/check_docs.py            # docs OK: 7 required docs present, internal links resolve
python3 tools/check_docs.py --strict
```

---

## 5. Testing

```bash
python3 -m unittest discover -s tools/tests -v
```

18 tests, grouped by tool. Beyond liveness, the suite asserts *design properties*:

- `test_default_balance_is_contested` — crew win rate in [0.20, 0.70] over 120 seeded runs.
- `test_eject_accuracy_is_not_perfect` — accuracy < 0.95, i.e. the lying system must remain effective.
  A perfect-detection game has no social deduction in it.
- `test_tie_no_ejection`, `test_skip_plurality_no_ejection`, `test_overvote_rejected` — voting math.
- `test_self_target_rejected`, `test_bad_vocabulary_rejected` — grammar discipline.
- `test_deterministic_per_seed` — reproducibility, so tuning diffs are attributable.

---

## 8. `tools/goap_probe.py` — GOAP plan tracer

**Purpose.** Make the AI architecture in [04](04_AI_ARCHITECTURE.md) §4 *executable*. The planner
(`tools/goap.py`) is the reference implementation the TypeScript runtime must match; the probe asserts
the architectural promises hold.

```bash
python3 tools/goap_probe.py catalog          # the 21-action budget, with costs and effects
python3 tools/goap_probe.py scenarios        # 9 intended-behaviour assertions
python3 tools/goap_probe.py stress --count 500
python3 tools/goap_probe.py plan --role impostor --goal HUNT --state '{"kill_ready":true,"in_range":true,"witnesses":0}'
```

Scenarios asserted (all passing):

| Scenario | Property |
|---|---|
| `crisis_beats_tasks` | A crew agent at the crisis station fixes it instead of doing the task in front of it |
| `no_kill_with_witness` | An impostor **cannot** produce a kill plan while `witnesses > 0` — unreachable, not merely discouraged |
| `kill_when_alone` | With `witnesses == 0` the kill is available |
| `stalk_before_kill` | Approach is always planned before the kill, never assumed |
| `crew_flees` | A threatened crewmate chooses escape/hide/group, never heroism |
| `plan_length_cap` | No plan exceeds 6 actions |
| `catalog_budget_21` | The action catalog matches the documented 20–24 budget |
| `travel_before_fix` | Travel is *planned* (`GOTO(Reactor)` precedes `FIX_CRISIS(Reactor)`), not hand-waved |
| `unreachable_fails_loudly` | Impossible goals raise, rather than silently returning a bad plan |

**Bug postmortem — the probe found a hole in its own architecture.** The first version could not
plan travel at all: `GOTO` was a *parameterized* action and the planner never bound `__target__`, so
"walk to Reactor and fix the crisis" was unplannable and the probe happily reported success by
returning a one-action plan. Two lessons, both logged deliberately:

1. **A probe that only checks "a plan exists" is worthless.** It now asserts plan *content* and
   *ordering*.
2. **Parameterized actions need instantiation.** `goap.instantiate_catalog()` binds rooms per belief
   state, producing ~23 concrete instances from 21 templates — which is also how the runtime must do it,
   and is now the first thing to check when porting to TypeScript.

---

## 9. `tools/check_rules.py` — engine/tooling parity gate

**Why it exists.** The rules now exist twice: Python (fast reference, used by every probe) and
TypeScript (shipped runtime, `engine/src/sim/`). Two implementations *will* drift, and a drifting
balance constant is the worst kind of bug: invisible, plausible, and only visible in feel.

It parses the TypeScript as text — no Node dependency in the Python gate — and compares:

| Check | Source of truth |
|---|---|
| 14 balance constants | `tools/data/balance_defaults.json` |
| `Phase` union (12 phases) | `tools/data/state_machine.json` |
| `UTTERANCE_TYPES` (15 shipped; 18 in grammar) | `tools/data/quickchat_grammar.json` |
| Map adjacency: symmetry, connectivity, no unknown rooms | `rules.ts` ↔ `LOCATIONS` |

```bash
$ python3 tools/check_rules.py
rules in sync: balance, phases, utterance types, map adjacency

$ sed -i 's/killCooldownSeconds: 27.5/killCooldownSeconds: 30/' engine/src/sim/rules.ts
$ python3 tools/check_rules.py
DRIFT: killCooldownSeconds: engine=30.0 json=27.5      # exit 1
```

**The negative test is the point.** A parity checker that has never been seen to fail is decoration;
this one was verified against deliberately injected drift before being documented.

---

## 10. CI contract

```bash
# --- Python reference gate ---
python3 tools/qc_parse.py validate
python3 tools/qc_parse.py fuzz --count 300
python3 tools/validate_state.py validate
python3 tools/sim_headless.py guard --runs 300
python3 tools/goap_probe.py scenarios
python3 tools/goap_probe.py stress --count 300
python3 tools/check_rules.py
python3 tools/check_docs.py --strict
python3 -m unittest discover -s tools/tests

# --- shipped runtime gate ---
cd engine
npx tsc --noEmit
node --test --experimental-strip-types src/sim/rules.test.ts
npx vite build
```

**Rule of the suite:** if a design decision cannot be checked by one of these commands, it is either
(a) a taste decision — fine, log it in [00](00_SWOT_AND_STRATEGY.md) §Decision log — or (b) not yet
understood well enough to build.

## 7. Planned Phase 2 tools (specified now, not built)

| Tool | Purpose | Trigger |
|---|---|---|
| `goap_probe.py` | Plan-trace a single agent against a scenario; assert plan length/cost bounds | Before any GOAP content authoring |
| `noise_probe.py` | Emit a noise event, dump the propagation graph and per-agent audibility | Before audio/stealth tuning |
| `transcript_check.py` | Replay a meeting transcript; assert every line parses and every accusation is grounded in a claim | Before meeting UI work |
| `map_lint.py` | Validate map graph: connectivity, vent parity, task spread, line-of-sight corridors | Before map authoring |
| `manifest_probe.py` | Simulate cover quality vs. check budget; assert crew win moves < 0.08 when checks 0→2 | Before wiring identity into the client |
| `transcript_check.py` | Replay a meeting; assert identity challenges cite identity tokens and guilt claims cite observations | Before identity meeting UI |
