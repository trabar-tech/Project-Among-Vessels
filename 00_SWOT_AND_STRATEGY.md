# 00 — SWOT and Strategy

**Project Among Vessels** · Phase 1 deliverable · Status: **frozen for Phase 2**
Prereqs: none · Feeds: [01_DEV_TOOLS.md](01_DEV_TOOLS.md), [04_AI_ARCHITECTURE.md](04_AI_ARCHITECTURE.md), [05_QUICKCHAT_GRAMMAR.md](05_QUICKCHAT_GRAMMAR.md)

> A single-player Among Us sandbox with SIGNALIS's cold retro-industrial dread, Project Zomboid's
> granular systemic pressure, F.E.A.R.'s planned tactical AI, Alien: Isolation's director-driven
> hunter, and a *closed-vocabulary* NPC chat system. This document is the honest self-appraisal of
> the entity building it — including the ways that entity is likely to fail.

---

## Why this document exists first

Every later document in this suite makes claims that are expensive to be wrong about: AI
architectures, suspicion math, grammar semantics, tuning bands. If I write those while blind to my
own failure modes, the failures compound silently. So Phase 1 is a *meta-cognitive* phase: name the
risks, then build the instruments that detect them.

**Core creative vision, restated as a constraint set** (this is the yardstick every later decision
is measured against):

| Pillar | Source | Non-negotiable |
|---|---|---|
| Social deduction core | Among Us | Tasks, sabotage, bodies, meetings, votes, ejection. If this is not the spine, the game is not this game. |
| Atmosphere | SIGNALIS | Retro-futuristic, claustrophobic, industrial. Dread is *pace*, not jump scares. |
| Systemic depth | Project Zomboid | Moodles, noise propagation, line of sight, granular interaction. Pressure, not busywork. |
| Tactical AI | F.E.A.R. | GOAP + squad layer. Bots flank, coordinate, and *plan*, not script. |
| Hunter AI | Alien: Isolation | Macro director + micro sensors. The director knows; the hunter must *earn* knowledge. |
| NPC dialogue | Among Us Quick-Chat | Closed grammar, zero free-form LLM text during gameplay. |

---

## SWOT

### S — Strengths (what this build actually has going for it)

1. **Full-stack authorship, no integration tax.** Design, AI architecture, tooling, and docs come
   from one process. No hand-off loss between "designer intent" and "engineer implementation" —
   a rare luxury in systemic game production, where most failures are translation failures.
2. **Systems thinking over content volume.** The pillars are *systems* (GOAP, moodles, noise,
   director pacing) that generate variety from interaction, not from hand-authored content. This
   is the correct economic choice for a small team: emergence is cheaper than assets.
3. **Research fluency.** Deconstruction of F.E.A.R.'s GOAP, Alien: Isolation's two-brain director,
   Among Us's exact cooldown/voting math, and Project Zomboid's moodle stack is well-documented
   public knowledge. I can synthesize primary sources quickly and accurately.
4. **Tooling-first discipline.** The single biggest predictor of success here is whether logic can
   be *verified without playing*. Phase 1 builds that verification layer before any game code.
5. **Determinism is cheap and I can exploit it.** Headless simulation with fixed seeds gives
   statistical balance evidence in seconds. Most indie teams discover degeneracy in playtests weeks
   later; a seeded sim catches it in a CI run.
6. **Speed of iteration on text artifacts.** Design docs, grammars, and state machines can be
   revised in minutes, keeping the written spec honest against the tools.

### W — Weaknesses (where I will specifically fail if unmanaged)

| Weakness | Mechanism | Concrete failure mode | Mitigation (built in Phase 1) |
|---|---|---|---|
| **Hallucinated specifics** | Confident generation of numbers, APIs, or citations that were never verified | A cooldown value or grammar rule in the docs that contradicts the shipped JSON; NPCs "knowing" mechanics that don't exist | Single source of truth in `tools/data/*.json`; `check_docs.py` rejects docs that drift from required structure; every doc states which file wins |
| **Context decay over long builds** | Earlier decisions soften or get contradicted as the conversation grows | Doc 05's grammar renames a slot that doc 04's suspicion model still references | Locked vocabularies + parser as executable spec: `qc_parse.py validate` fails on any drift |
| **Over-engineering** | The pull toward "one more systemic layer" because it is *interesting* | 14 moodles, 9 sabotages, and a 40-action GOAP catalog on day one; nothing ships | Hard budget caps stated per system in [03_HYBRID_MECHANICS.md](03_HYBRID_MECHANICS.md); every system must name the Among Us loop beat it serves |
| **Balance blindness** | Reasoning about emergent systems analytically is unreliable; intuitions are wrong | Tuning that yields 97% crew wins (observed in this very project's first sim run) or 1% crew wins | `sim_headless.py` + regression guard band + unit test asserting contested outcomes |
| **Scope denial** | Treating a sandbox as "just" Among Us plus features | Feature list that cannot be finished or tested | Pillar hierarchy with an explicit *cut order* (§Strategy below) |
| **Sycophancy toward the brief** | Agreeing that every requested pillar harmonizes, instead of designing the seams | A game that is secretly three games stapled together | §Pillar Tension below; explicit conflict resolution rules |
| **LLM temptation in gameplay** | The easy path is "let the NPC ask an LLM what to say" | Non-deterministic, unbalanceable, unfalsifiable NPC speech | Grammar is the *only* channel; LLM permitted offline for authoring variants, never at runtime |
| **Verification theater** | Tests that assert the code runs rather than that the design is sound | Green CI on a degenerate game | Tests assert *design properties* (contested balance, imperfect eject accuracy), not just liveness |

**The two weaknesses I rate most dangerous:** *hallucinated specifics* and *balance blindness*. Both
produce output that looks professional and is wrong. Both are addressed by executables, not prose.

### O — Opportunities

1. **Emergence is free content.** GOAP + noise + moodles + a lying NPC layer produce stories no
   writer authored. A single-player Among Us match with *believable* NPC liars is genuinely
   underserved territory — the social deduction genre is almost entirely multiplayer-dependent.
2. **Closed vocabulary is a feature, not a limitation.** Because Quick-Chat claims are structured,
   they are machine-auditable: suspicion math, lie detection, and deduction become *tractable
   engineering* instead of NLP research. This is the single most differentiated idea in the suite.
3. **Director pacing solves a real design problem.** Among Us is high-variance: some rounds are
   silent, some are meat grinders. A menace/dread gauge that paces pressure can compress that
   variance without scripting outcomes — Alien: Isolation proved the technique for a *single*
   hunter; applying it to a *social* pressure curve is novel.
4. **Headless-first development.** AI, meetings, and balance can all be validated before a renderer
   exists. This de-risks the expensive phase (art/audio direction) behind a cheap one.
5. **Sandbox replayability.** Systemic NPC memory means the same map produces different social
   dynamics per seed — a replayability lever that costs no new assets.
6. **Tooling as documentation.** The parser, validator, and simulator *are* the spec's proof. This
   makes the design suite unusually falsifiable for a pre-production package.

### T — Threats

| Threat | Severity | Why | Countermeasure |
|---|---|---|---|
| **Pillar collision** (Among Us pacing vs. Zomboid granularity) | High | Among Us wants 60–120s of clean tension between meetings; Zomboid wants 20-minute scavenging arcs. Naive merge = a slow social game | §Pillar Tension: the **90-second rule** below |
| **NPC deduction is unconvincing** | High | If bots deduce too well, they solve the game; too poorly, the player feels alone in a room of props | Calibrated suspicion model with credibility, decay, and noise; headless measurement of eject accuracy (target 0.80–0.92 range) |
| **Information asymmetry collapse** | Medium | A bot with perfect knowledge of the kill ruins the fantasy; a bot with realistic senses may never accuse anyone | Two-tier knowledge (director knows / agent earns) enforced architecturally in [04](04_AI_ARCHITECTURE.md) |
| **Tuning thrash** | Medium | Every fix to AI shifts win rates; without a guard, tuning becomes whack-a-mole | Seeded regression guard in CI, band documented in [02](02_AMONG_US_CORE.md) §8 |
| **Doc/tool divergence** | Medium | Two sources of truth silently disagree | JSON is canonical; docs must declare it; `check_docs.py` in CI |
| **Over-scoping the aesthetic** | Low/Med | "SIGNALIS-like" invites expensive custom rendering | Aesthetic spec is *constraint-based* (palette, CRT, audio gates), not asset-count-based |
| **Legal/tonal adjacency** | Low | Direct references to SIGNALIS/Among Us in shipped marketing | Internal design vocabulary only; public framing is original (see §Naming) |

---

## The Pillar Tension Map (where the merge actually hurts)

The brief asks for four pillars that are individually coherent and collectively in conflict. Naming
the conflicts is the design work; pretending they harmonize is the failure.

```
              FAST PACE ─────────────────────────────── SLOW PACE
                 │                                          │
   Among Us ─────●                                          │
   (meetings every 60-120s, short tasks, instant kills)      │
                                                             │
                                       Project Zomboid ──────●
                                       (long scavenge arcs, attrition, moodle death spirals)

              LOW INFORMATION ──────────────────── HIGH INFORMATION
                 │                                          │
   Among Us ─────●  (fog of war, no vitals, "who was where?") │
                                       F.E.A.R. GOAP ───────●
                                       (omniscient tactical planning, perfect squad comms)
```

Three concrete collisions and their binding resolutions:

**C1 — Pacing: Among Us fast loop vs. Zomboid slow attrition.**
*Resolution: the 90-second rule.* No survival system may block the social loop for more than 90
seconds of uninterrupted time. Moodles create *pressure* (reduced speed, noisier movement, worse
task performance) but never a hard gate. A player who ignores every survival need still reaches the
next meeting; they simply arrive with less capability and more noise. **Zomboid is the texture of the
space between meetings, never a second game inside it.**

**C2 — Information: F.E.A.R. omniscience vs. Among Us fog.**
*Resolution: knowledge tiers.* The tactical planner may plan with squad knowledge, but all
*socially actionable* facts (who killed whom, who vented) must pass through the sensory pipeline and
be recorded as *witnessed* facts with confidence. A bot may not accuse from planner knowledge.
Enforced at the type level: suspicion updates accept only `Observation` records, never world state.

**C3 — Expression: Quick-Chat constraint vs. "deep" NPC personality.**
*Resolution: personality lives in selection, not generation.* Every NPC uses the same 15 utterance
types. Personality is the *policy* over that grammar — who they trust, what evidence they weight,
when they speak, whether they lie boldly or deflect. This preserves auditability while giving each
NPC a legible voice.

---

## Strategy

### Build order (and why)

1. **Phase 1 (this suite):** docs + tooling. Cheap, falsifiable, de-risks everything downstream.
2. **Phase 2: headless vertical slice.** One map graph, 10 agents, GOAP, Quick-Chat meetings, seeded
   sim. Exit criterion: `sim_headless.py guard` passes *and* a human reads a meeting transcript and
   believes it. No renderer.
3. **Phase 3: presentation shell.** Renderer, audio gates, CRT/UI direction per [03](03_HYBRID_MECHANICS.md).
   Only after the loop is provably good headless.
4. **Phase 4: content and authoring tools.** Maps, task variants, NPC personas.

Rationale: the expensive, hard-to-revise work is presentation. The cheap, high-leverage work is
loop correctness. Build the cheap thing first and *prove* it.

### Cut order (decided now, not in a panic later)

When scope must shrink, cut in this order — the last item is the game's identity and is never cut:

1. Visual task variety → 2. Moodle count (8 → 4) → 3. Sabotage count (5 → 3) → 4. Squad tactics
depth (GOAP catalog 20 → 12 actions) → 5. Director nuance (2 modes → 1) → 6. **Never cut:** tasks,
kills, meetings, votes, Quick-Chat grammar, impostor lying.

### Decision log (decisive choices made under ambiguity)

| # | Ambiguity | Decision | Reasoning |
|---|---|---|---|
| D1 | Does the player *play* Among Us or *observe* a sandbox? | **Player is a crewmate with full agency**; NPCs fill every other slot. Sandbox = replayable systemic NPC society around the player. | The brief says "single-player Among Us"; removing player agency would delete the social-deduction fantasy. |
| D2 | Is the hunter a monster or an impostor? | **Impostor is the hunter.** The SIGNALIS "thing" is the *dread vocabulary*, not a third faction. | Adding a monster faction fractures the win-condition math of Among Us. Atmosphere is a *lens*, not a faction. |
| D3 | Can NPCs use free text at all? | **No, at runtime.** Grammar only. Offline authoring may use text generation for variant flavour strings. | Determinism, balanceability, auditability, and the brief's explicit constraint. |
| D4 | Real-time or turn-based meetings? | **Real-time with timers** (discussion 30s, voting 90s), matching Among Us. | Turn-based meetings destroy the panic that makes accusations meaningful. |
| D5 | How many impostors at 10 players? | **2.** | 1 is too solvable by process of elimination; 3 makes parity trivial. Validated by sim (see [02](02_AMONG_US_CORE.md) §8). |
| D6 | Does the director control *outcomes*? | **No.** It may only bias *where pressure goes*, never decide a kill, accusation, or vote. | Alien: Isolation's central lesson: the director knows, the agent must still earn knowledge. Otherwise players feel cheated. |
| D7 | Do dead crew still work tasks? | **Yes**, at reduced rate. | Faithful to Among Us and mechanically important: it keeps task-win a live threat after deaths. |

### Success criteria for Phase 1 (self-audit)

- [x] All six documents exist, cross-link, and contain no TODO stubs.
- [x] Every numeric claim in prose is mirrored in a JSON file that a script validates.
- [x] Quick-Chat grammar is machine-parseable, fuzz-tested, and rejects malformed input.
- [x] Balance defaults produce a *contested* match in headless simulation (crew win 0.30–0.60).
- [x] State machine has no unreachable phases, dead ends, or ambiguous terminal guards.
- [x] Weaknesses in §W each map to a concrete artifact in [01_DEV_TOOLS.md](01_DEV_TOOLS.md).

### Naming note

Internal documents use "SIGNALIS", "Among Us", "Project Zomboid", "F.E.A.R.", and "Alien: Isolation"
as *reference vocabulary* only. Public framing must be original: **Among Vessels** is a retro-industrial
social-deduction sandbox about a crew that cannot trust its own ship. No reference game names, assets,
or trademarks in shipped material.
