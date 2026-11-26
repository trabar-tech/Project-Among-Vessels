# 04 — AI Architecture

**Project Among Vessels** · Phase 2 research deliverable · Status: **specified**
Requires: [02](02_AMONG_US_CORE.md), [03](03_HYBRID_MECHANICS.md) · Feeds: [05_QUICKCHAT_GRAMMAR.md](05_QUICKCHAT_GRAMMAR.md)

> A four-layer hybrid: **Director** (macro pacing) → **Squad** (shared tactical intent) →
> **GOAP planner** (per-agent action sequences) → **Sensors** (what the agent is allowed to believe).
> The architecture is defined as much by what each layer *cannot know* as by what it can do.

---

## 1. Why This Hybrid

| Source | Contribution | Failure if taken alone |
|---|---|---|
| **F.E.A.R. (GOAP)** | Agents plan multi-step actions from preconditions/effects; squads coordinate flanking and suppression | Without sensors it becomes omniscient; without a director the pressure is flat |
| **Alien: Isolation (Director + sensors)** | A macro brain that knows everything but may only *hint*; the hunter must earn knowledge | Without planning the hunter is a random walker |
| **Among Us (social layer)** | Roles, tasks, meetings, lies | Without either, there is no game |

The decisive architectural rule, inherited from Alien: Isolation and made absolute here:

> **The Director may know everything. No agent may act on anything the Director knows.
> Information flows one way: Director → *pressure hints* → sensors → beliefs → plans.**

This is enforced structurally: the suspicion and planning interfaces accept only `Observation`
records produced by the sensor layer. There is no API through which world state can reach a plan.

---

## 2. Layer Map

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ L0  DIRECTOR  (one per match, omniscient, never acts directly)                │
│     dread gauge · tension pacing · hint scheduling · crisis tempo · stakes    │
└───────────────────────────────┬───────────────────────────────────────────────┘
                                │ hints (area, urgency, not positions)
┌───────────────────────────────▼───────────────────────────────────────────────┐
│ L1  SQUAD / SOCIAL LAYER  (per faction: crew bloc, impostor cell)             │
│     shared intent · role assignment · cover/suppression (imp) · search zones   │
│     meeting orchestration · who speaks · who is scapegoated                    │
└───────────────────────────────┬───────────────────────────────────────────────┘
                                │ orders (goal requests, not action scripts)
┌───────────────────────────────▼───────────────────────────────────────────────┐
│ L2  GOAP PLANNER  (per agent)                                                 │
│     goal selection → A* over action space → action sequence → execution       │
│     replan triggers · plan cost · interrupt handling                          │
└───────────────────────────────┬───────────────────────────────────────────────┘
                                │ actions
┌───────────────────────────────▼───────────────────────────────────────────────┐
│ L3  SENSORS + BELIEFS  (per agent)                                            │
│     vision cone · hearing (noise graph) · memory with decay · suspicion model  │
│     ONLY source of socially actionable facts                                  │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Tick budget (target, 10 agents @ 60Hz):**

| Layer | Frequency | Budget |
|---|---|---|
| Sensors | every frame (cheap cone test, 14 rooms) | 0.6 ms total |
| Belief update | 10 Hz | 0.4 ms total |
| GOAP replan | on event or 2 Hz | 3.0 ms worst case, amortised across frames |
| Squad | 2 Hz | 0.3 ms |
| Director | 1 Hz | <0.1 ms |

Total AI budget: **≤ 5 ms/frame** on the reference machine. Planning is *amortised*: at most one
agent plans per frame, round-robin, with stale plans allowed to continue executing.

---

## 3. L3 — Sensors and Beliefs (the epistemic foundation)

Everything social depends on this layer being honest.

### 3.1 Sensor channels

| Channel | Model | What it yields | Noise |
|---|---|---|---|
| **Sight** | Cone + peripheral circle + LOS raycast ([02](02_AMONG_US_CORE.md) §5) | `SawAgent`, `SawBody`, `SawVent`, `SawTaskPose`, `SawSabotage` | Distance-graded confidence |
| **Hearing** | Noise graph propagation ([03](03_HYBRID_MECHANICS.md) §3.2) | `HeardNoise(type, room, confidence)` | Attenuation + false-positive ambience |
| **Proximity** | Very short radius (1.5 units), 360° | `SawAgent` at high confidence ("someone is right behind me") | None (this is the "eyes in the back of the head" rule) |
| **Station** | Cams / Vitals / Admin / Doorlog | `StationFact` (occupancy, alive-count, entry log) | Stale by up to 3s; sabotaged by Comms |
| **Testimony** | Quick-Chat utterances in meetings | `Claim(speaker, type, slots)` — **never raw truth** | Speaker credibility + claim strength |
| **Self** | Own state | Moodles, inventory, cooldowns | Exact |

**The proximity channel is deliberate.** Alien: Isolation gave its hunter a short rear sensor so
players could not exploit blind spots trivially. We give *every* agent this, symmetric: you cannot
stand directly behind someone's head and be invisible. It converts "sneaking" from an exploit into a
skill of *distance and geometry*.

### 3.2 Observation record (the only currency of belief)

```python
Observation = {
  "kind": "SAW_AGENT" | "SAW_BODY" | "HEARD" | "SAW_VENT" | "SAW_TASK" | "STATION" | "CLAIM",
  "subject": <agent_id | room_id | None>,
  "room": <room_id>,
  "time": <tick>,
  "confidence": 0.0–1.0,          # from distance, occlusion, attenuation
  "source": "SIGHT" | "HEARING" | "PROXIMITY" | "STATION" | "TESTIMONY",
  "witnessed": bool,              # True = first-hand; False = hearsay
}
```

**Invariant:** a belief may only be updated from an `Observation`. There is no `set_suspicion(agent,
x)` from world state anywhere in the codebase. This invariant is what makes bots *fair*.

### 3.3 Memory with decay

Agents keep a bounded episodic buffer (default **24** entries) and a *room-time map*: for each room,
a decaying estimate of "who was there when I was". Decay is exponential:

```
weight(observation, now) = confidence · 0.5 ^ ((now − t) / half_life)
half_life = 90s (play) · extended to 300s for high-confidence first-hand sightings
```

**Why bounded memory:** an unbounded log makes bots into perfect historians, which destroys the
human experience of "wait, who was in Electrical again?" Forgetting is a *feature*. It is also what
makes lying profitable: a lie only needs to survive until the truth decays.

---

## 4. L2 — GOAP Planner (F.E.A.R. inheritance)

### 4.1 Structure

Following F.E.A.R.'s core insight: a **tiny FSM** (`GOTO`, `ANIMATE`, `USE_SMART_OBJECT`) executes
whatever the planner decided, and all intelligence lives in the planner over a declarative world
state.

| Concept | Implementation |
|---|---|
| **World state** | Flat dict of ~22 boolean/numeric facts (`has_task_in_room`, `target_visible`, `kill_ready`, `in_vent`, `is_alone_with(target)`, `crisis_active`, …) |
| **Actions** | ~20 total; each has preconditions, effects, cost, and a duration |
| **Goals** | ~10 priority-scored; highest-priority satisfiable goal is planned toward |
| **Search** | Backward A* from goal over actions whose effects intersect unmet conditions (F.E.A.R. trick) |
| **Replan triggers** | Goal priority flip, plan invalidated (precondition broken), timeout (6s), interrupt event |
| **Plan cap** | 6 actions, 2000 node expansions, 2 ms hard stop (fall back to previous plan) |

### 4.2 Action catalog (v1 — 20 actions, hard cap)

**Crewmate**

| Action | Preconditions | Effects | Cost |
|---|---|---|---|
| `GOTO(room)` | path exists | `at(room)` | distance |
| `DO_TASK(stage)` | `at(task_room)`, task incomplete, not in crisis | task progress | 6–30s |
| `REPORT_BODY` | body visible | triggers meeting | 2 |
| `FIX_CRISIS(station)` | crisis active, `at(station)`, (2-actor requirement met) | crisis resolved | travel + 5s |
| `USE_STATION(type)` | `at(station)` | station facts | 4s standing |
| `FLEE(from)` | threat believed | distance from threat | speed-dependent |
| `GROUP_WITH(agent)` | target visible or believably nearby | reduces isolation risk | travel |
| `HIDE(spot)` | shadow/cover available | unseen by most | 3s |
| `INSPECT_BODY` | body adjacent | cause + rough time | 4s |
| `CALL_MEETING` | button room, meetings left | meeting | travel |
| `REST` | moodle ≥ 2 severity | reduces Exhausted/Winded | 8s |

**Impostor**

| Action | Preconditions | Effects | Cost |
|---|---|---|---|
| `GOTO(room)` | path exists | `at(room)` | distance |
| `FAKE_TASK(room)` | `at(room)`, witnesses plausible | `looks_busy` | 8s |
| `STALK(target)` | target visible/heard, `not alone_witnessed` | proximity | travel |
| `KILL(target)` | `kill_ready`, `in_range`, `witnesses == 0 or acceptable` | target dead, `kill_cd` set | 1.5s |
| `VENT_TO(room)` | `at(vent)`, vent cd ready | `at(room)`, **loud** | travel |
| `SABOTAGE(type)` | `sabotage_ready`, no active crisis | crisis state | 2s |
| `LOCK_DOORS(room)` | door cd ready | doors closed 10s | 1s |
| `FRAME(target)` | meeting active or about to | social intent | 0 (meeting) |
| `ALIBI(room, witness?)` | meeting active | credibility | 0 (meeting) |
| `SELF_REPORT` | body known, no witnesses | meeting on own terms | 2 |

**That is 21 actions total** (11 crew, 10 impostor). The cap is 20–24. Anything beyond is a design
failure, not a feature: more actions mean more search cost and less legible behaviour.

### 4.3 Goal set and priority scoring

Goals are utility-scored, not hard-coded, so the same agent can flip between them fluidly:

| Agent | Goal | Priority formula (sketch) |
|---|---|---|
| Crew | `COMPLETE_TASKS` | base 0.5 + (1 − task_progress) · 0.4 |
| Crew | `SURVIVE` | threat_belief · 1.2 + isolation_penalty · 0.5 |
| Crew | `RESOLVE_CRISIS` | crisis_active · 1.5 (dominates everything) |
| Crew | `GATHER_EVIDENCE` | 0.3 + bodies_seen · 0.4 + director_hint_urgency · 0.3 |
| Crew | `SOCIALISE` | 0.35 + loneliness_factor · 0.3 |
| Impostor | `HUNT` | 0.6 + isolation_opportunity · 0.7 − witness_risk · 0.9 |
| Impostor | `BUILD_COVER` | 0.55 + suspicion_on_self · 0.6 |
| Impostor | `ESCALATE` | crisis_affordability · 0.8 + crew_progress_urgency · 0.6 |
| Impostor | `DEFLECT` | suspicion_on_self · 1.0 (during meetings) |

**Design intent:** witness risk must be able to *outweigh* a kill opportunity. An impostor that kills
whenever it can is a bad liar; an impostor that waits for the room to empty is a character.

---

## 5. L0 — Director (Alien: Isolation inheritance, generalized)

### 5.1 Mandate

The Director manages **pressure over time** for the whole match. It is the only omniscient
component. It never issues actions, only *hints* and *tempo modifiers*.

It exists to solve a real Among Us problem: variance. Without pacing, some matches are silent for two
minutes and some are a slaughter in ninety seconds. The Director compresses both tails.

### 5.2 The dread gauge

```
dread ∈ [0, 1]     (per-agent and global)

increases when:
  + agent is isolated (no ally within 2 rooms)          +0.02/s
  + hunter is in an adjacent room and unseen            +0.05/s
  + recent kill occurred nearby (< 20s, < 2 rooms)      +0.15 (impulse)
  + crisis active                                       +0.03/s
  + moodles ≥ 2                                         +0.01/s each

decreases when:
  − agent is in a group of ≥ 2                          −0.04/s
  − no threat event for 15s                             −0.02/s
  − agent completed a task                              −0.03 (impulse)
  − meeting just ended (grace window 10s)               −0.20 (impulse)
```

At `dread ≥ 1.0` (peak):
- The impostor's kill planner gains **−0.5 priority on HUNT** (it backs off, repositions, fakes).
- The Director may hint the impostor *away* from the player and toward another crewmate.
- Ambient audio relaxes one step. Lights stabilise.

**The backstage/frontstage rhythm (from Alien: Isolation):** pressure must *peak and release*. A
constant threat is not tension; it is fatigue. Release windows are also where the player does tasks,
which is where the impostor gets to plan — so release is productive for both sides.

### 5.3 Hint mechanism (the fairness boundary)

```python
def hint(impostor_agent, target_area, urgency):
    # NEVER: impostor_agent.known_position = player.position
    impostor_agent.receive_hint(Hint(area=target_area, urgency=urgency))
    # The planner may then choose to GOTO(area) or IGNORE it.
```

| Allowed | Forbidden |
|---|---|
| Area-level nudges ("sweep the engine block") | Exact player position |
| Urgency weighting on existing goals | Forcing a kill |
| Tempo changes (crisis availability) | Deciding a vote outcome |
| Hint to *back off* | Making the player invisible |

The hint must always pass through the agent's own planning and sensors. If the agent arrives and the
player is gone, the agent *searches* — and the search is the experience.

### 5.4 Director modes

| Mode | When | Behaviour |
|---|---|---|
| **Build** | Match start, after a meeting | Low hint rate; lets social structure form |
| **Pressure** | Mid-match, crew ahead on tasks | Higher hint rate; crises more available; more isolation nudges |
| **Release** | After a peak, after an ejection | Suppressed hints for 20–30s; ambient calm |
| **Desperation** | Impostor losing badly (1 imp left, tasks 80%+) | Raises crisis availability, encourages bold framing; **never** grants knowledge |

The Desperation mode is the "director helps the losing side" pattern. It must remain strictly
*opportunity-based*: it makes aggression more viable, it never makes it correct by fiat.

---

## 6. L1 — Squad and Social Layer

### 6.1 Crew blocs (F.E.A.R. squad inheritance, socialized)

F.E.A.R.'s squad layer assigns slots for suppression/advance. Our crew equivalent assigns **social
slots** during play:

| Slot | Assignment logic | Behaviour |
|---|---|---|
| **Buddy** | Highest-trust living crewmate, not already buddied | Travel together; mutual alibi |
| **Sweeper** | Free agent with the best map coverage | Checks chokepoints; the one who finds bodies |
| **Responder** | Nearest to crisis station | Takes crisis fix; calls for a second |
| **Anchor** | Lowest mobility (injured/tired) | Stays near stations, uses cams/vitals |
| **Scout** | Highest curiosity trait | Investigates noises; highest risk, highest information |

This produces emergent squad behaviour without scripting: buddy pairs create alibis, sweepers find
bodies, responders are always near crises (and therefore always suspicious), anchors accumulate
station knowledge.

### 6.2 Impostor cell

Impostors share knowledge (they know each other) but **not actions**. Coordination is limited to:

| Protocol | Effect |
|---|---|
| **Kill token** | Only one impostor may hunt at a time; the other builds cover. Prevents double-kills that trivialize the game |
| **Crisis claim** | One impostor "owns" the next sabotage; the other must not spend the shared cooldown |
| **Frame handoff** | In meetings, one accuses while the other defends the accused — a two-voice pattern that reads as consensus |
| **Bus protocol** | If an impostor is certain to be ejected, the other should *vote with the crowd* to preserve credibility |

The Bus Protocol is a genuine strategic choice with a real cost, and it emerges from the same
suspicion model the crew uses. This is the kind of behaviour that makes players say "the bots are
scary" — it is not scripted dialogue, it is a plan.

### 6.3 Meeting orchestration

The meeting is a separate mini-architecture because it has no movement and no physics — only
information exchange. It runs a fixed schedule:

```
t=0.0   meeting opens; each agent computes a SPEAK INTENT
        (basis: strongest suspicion, or strongest alibi need, or nothing)
t=0.5   speaker order resolved by: evidence strength desc, then assertiveness trait
t=0.5–25 each speaker emits ≤3 Quick-Chat utterances (see 05 §7)
        after each utterance, all listeners update beliefs (credibility-weighted)
t=25    VOTE INTENT computed for all agents: argmax suspicion, or SKIP if below threshold
t=30    voting opens; votes locked in over 60s as a *public* or *anonymous* tally
```

**Why speakers are ordered by evidence strength:** it makes the meeting *legible*. Weak claims come
after strong ones, so a listener can notice when someone's story is built to contradict what was just
said. It also produces the natural rhythm of good social deduction: the strong claim lands, then the
room reacts.

---

## 7. Suspicion Model (the heart of the lie economy)

Suspicion is not one number per pair. It is a small structured belief per (observer, subject):

```python
Suspicion = {
  "presence_anomaly": 0.0,   # I expected you elsewhere (task/claim mismatch)
  "proximity_to_body": 0.0,  # you were near a death
  "behavioural_tell": 0.0,   # faking, idling, vent-adjacent, loitering
  "testimony_pressure": 0.0, # others' claims against you
  "credibility_debt": 0.0,   # times your story didn't hold
  "trust_credit": 0.0,       # times you were verified / useful
}
```

Final score:

```
S(observer, subject) = σ( 1.0·presence_anomaly
                        + 1.3·proximity_to_body
                        + 0.8·behavioural_tell
                        + 0.9·testimony_pressure
                        + 1.1·credibility_debt
                        − 1.0·trust_credit )
```

where `σ` is a logistic squashing to [0,1]. Weights are **per-persona** (see §8), which is how
different NPCs feel like different people rather than one brain with different hats.

### 7.1 Evidence weights (from first-hand observation)

| Observation | presence | proximity | tell | debt |
|---|---|---|---|---|
| Saw vent enter/exit | 0.1 | 0.3 | **0.9** | 0.2 |
| Saw kill | 0.9 | **1.0** | 0.9 | 0.8 |
| Body found, subject seen leaving that room | 0.6 | 0.8 | 0.1 | 0.1 |
| Subject claimed room A, seen in B | **0.9** | 0.1 | 0.1 | **0.7** |
| Subject "doing task" at a station with no active task | 0.4 | 0.0 | 0.7 | 0.3 |
| Subject absent from any expected area for > 40s | 0.5 | 0.2 | 0.2 | 0.1 |
| Subject completed a visual task / was in a 2-person crisis fix | 0.0 | 0.0 | 0.0 | −0.5 (trust) |

### 7.2 Testimony weighting (from claims)

A claim's effect on a listener scales as:

```
effect = claim_weight
       × credibility(speaker)          # 1 − S(listener, speaker)
       × claim_strength                 # from grammar STRENGTH / evidence type
       × consistency_bonus              # +25% if it matches a first-hand observation
       × contradiction_penalty          # ×0.5 if it contradicts the listener's own memory
```

`credibility(speaker) = 1 − S(listener, speaker)` is essential: a known liar's accusations *increase*
suspicion on the accuser rather than the accused. This single formula is why the social layer
self-corrects, and why an impostor must spend credibility carefully rather than spam accusations.

### 7.3 Lying (impostor policy)

Impostor utterances are generated by choosing a *goal* first:

| Lie goal | Trigger | Utterance strategy | Risk |
|---|---|---|---|
| **Cover absence** | Was away from witness during a kill | `ALIBI` (room, time, optional witness) | Cross-checkable |
| **Redirect** | Suspicion on self > 0.45 | `ACCUSE` scapegoat with a plausible evidence token | Backfires if scapegoat is cleared |
| **Corroborate** | Partner is accused | `DEFEND` partner with weak evidence | Links the two if partner falls |
| **Discredit** | Someone accused the impostor with strong evidence | `SUSPICION STRONG` on accuser + `INCONSISTENT_STORY` | Reads as desperate if repeated |
| **Deflect to crisis** | Crisis active | `SABOTAGE_WITNESS` / `TASK_CLAIM` about crisis room | Low risk, low reward |
| **Stay silent** | Suspicion low, no opportunity | No utterance | Silence is itself readable |

**Lying must be *rationally bounded*.** The impostor chooses the lie whose expected suspicion
reduction exceeds its risk of exposure, computed with its own belief model. It does not lie for
flavour. It lies because lying helps.

---

## 8. Personas (where "character" lives)

Personality is a **parameter vector** over the same architecture — never a separate code path:

```python
Persona = {
  "name": "Kessler",
  "trust_bias": 0.7,        # how fast trust_credit accumulates
  "paranoia": 1.2,          # multiplier on proximity_to_body weight
  "assertiveness": 0.8,     # probability of speaking first / interrupting
  "risk_tolerance": 0.3,    # impostor: willingness to kill with partial witness risk
  "memory_half_life": 120,  # seconds
  "lie_boldness": 0.6,      # impostor: preference for high-risk/high-reward lies
  "social_gravity": 0.5,    # tendency to group up
  "curiosity": 0.4,         # tendency to investigate noise
}
```

Eight parameters, all of which change *observable behaviour* through existing systems. This is the
budget cap: no persona may require a new mechanic.

### 8.1 Why this makes bots feel intelligent

The combination of (a) bounded memory, (b) structured suspicion, (c) credibility-weighted testimony,
and (d) rational lying produces behaviours that *look* authored but are not:

- A bot forgets who was in MedBay → asks → gets lied to → believes it. (Memory decay.)
- A bot notices a claim contradicts its own sighting → downgrades the speaker. (Consistency check.)
- An impostor bot notices a crewmate is distrusted → frames them → succeeds. (Scapegoat search.)
- A crewmate bot notices an impostor is quiet → suspects them *less*, which is itself a mistake the
  player can exploit. (Persona weighting.)
- Two buddy bots develop mutual trust credit, become a hard alibi pair, and the impostor must break
  the pair with a crisis. (Squad slots.)

---

## 9. Behaviour Verification (headless)

Every layer must be observable without a renderer. Phase 2 tools (specified in [01](01_DEV_TOOLS.md) §7):

| Tool | Asserts |
|---|---|
| `goap_probe.py` | A given scenario yields a plan within cost/length bounds; no plan exceeds 6 actions; no plan requires inaccessible preconditions |
| `noise_probe.py` | A noise event produces the documented audibility set; vents are always audible from adjacent rooms |
| `transcript_check.py` | Every meeting utterance parses; every accusation references a real claim or observation; no agent accuses from Director knowledge |
| `sim_headless.py` | Balance remains contested ([02](02_AMONG_US_CORE.md) §8) |

**The fairness invariant test** (to be written in Phase 2): run 1000 matches with the Director disabled
and 1000 with it enabled; assert that *agent* action distributions (kills per minute, false accusations
per meeting, correct-ejection rate) remain within 15% of each other. If the Director changes agent
behaviour materially, it is leaking knowledge and must be fixed.

---

## 10. Failure Modes and Guards

| Failure mode | Symptom | Guard |
|---|---|---|
| **Bots deduce perfectly** | Every meeting ends with a correct ejection | Eject accuracy target < 0.95; memory decay; lie credibility; `vote_confidence` threshold |
| **Bots accuse randomly** | Meetings are noise; player feels alone | Minimum evidence threshold before speaking (`speak_threshold`) |
| **Impostor kills optimally** | Player dies in 40s every match | Witness risk dominates hunt priority; Director dread backoff |
| **Impostor is passive** | No pressure; tasks win trivially | Desperation mode raises crisis availability; `ESCALATE` goal |
| **Director leaks knowledge** | Impostor always arrives where the player is | Hint = area only; fairness invariant test |
| **Planner thrash** | Agent oscillates between goals | Goal hysteresis (±10% to flip), replan cooldown 0.5s |
| **Cookie-cutter personalities** | All NPCs feel the same | Persona vectors vary weights; verify by transcript diversity metric |
| **Meeting deadlock** | Nobody speaks; vote is random | Speak threshold low enough that the highest-suspicion agent always speaks |

---

## 11. Summary

| Layer | Knows | May do | Must not do |
|---|---|---|---|
| **Director** | Everything | Hint areas, pace pressure, gate crises | Reveal positions, force kills, decide votes |
| **Squad** | Faction-shared beliefs | Assign social slots, coordinate one kill at a time | Share first-hand observations it does not have |
| **GOAP** | Its own world state (from beliefs) | Plan 6-action sequences from 21 actions | Plan on facts not in its belief store |
| **Sensors** | Only what physics allows | Produce `Observation` records | Grant truth |

The architecture's promise: **the bots are always fair, always planning, and always capable of being
wrong in interesting ways.**

---

## Appendix A — Sources consulted

- Orkin, J. *Three States and a Plan: The A.I. of F.E.A.R.* — goals compete for activation, planner
  satisfies the highest-priority goal; cost per action added to STRIPS; squad behaviours find
  participants, issue orders, and let agents prioritise orders against other goals:
  <https://www.gamedevs.org/uploads/three-states-plan-ai-of-fear.pdf>
- F.E.A.R. GOAP summary (70 goals / 120 actions shipped; planner + A*; local world-knowledge cache;
  vocalisations emitted as a *consequence* of planning, not as commands):
  <https://en.wikipedia.org/wiki/F.E.A.R._(video_game)>
- GOAP vs. HTN vs. behaviour trees, and the "planner decides, tree executes" hybrid:
  <https://www.socratopia.app/library/game-code-anatomy-en/chapter-12>
- Alien: Isolation — macro director (menace gauge, job/utility system, active vs. passive modes) and
  micro agent (behaviour trees, sensory heuristics, deliberate sub-optimal pacing):
  <https://www.gamedeveloper.com/design/the-perfect-organism-the-ai-of-alien-isolation>
- Alien: Isolation — the director knows the player's location; the alien is *never given* it:
  <https://mcvuk.com/business-news/a-tiger-in-the-office-how-alien-isolations-xenomorph-took-shape/>
- Player-side confirmation of the two-brain model and the "no cheating" rule:
  <https://www.reddit.com/r/patientgamers/comments/mzjxs6/alien_isolation_why_is_the_alien_all_the_time/>

**What we deliberately changed.** Alien: Isolation's director paces *one* hunter against *one* player.
Ours paces a *social* pressure curve across ten agents, so the hint channel is area-level and the
fairness invariant (§9) is asserted both by design and by test. F.E.A.R.'s vocalisations are repurposed:
our agents' "callouts" are not audio flavour, they are parsed Quick-Chat claims that feed other agents'
beliefs ([05](05_QUICKCHAT_GRAMMAR.md)).
