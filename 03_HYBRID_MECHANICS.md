# 03 — Hybrid Mechanics

**Project Among Vessels** · Phase 2 research deliverable · Status: **analysis complete**
Requires: [02_AMONG_US_CORE.md](02_AMONG_US_CORE.md) · Feeds: [04_AI_ARCHITECTURE.md](04_AI_ARCHITECTURE.md)
Canonical data: [`tools/data/balance_defaults.json`](tools/data/balance_defaults.json)

> How SIGNALIS's aesthetic and Project Zomboid's systemic pressure attach to the Among Us spine
> *without* turning the game into three games. The governing rule is simple and enforced throughout:
> **every addition must answer a question the player already has to ask.** If it does not make "who
> was where, and do I believe them?" more interesting, it is cut.

---

## 1. The Integration Model

Two of the three pillars are **attachments**, not new layers:

```
                    ┌────────────────────────────────────────┐
                    │   CORE LOOP (Among Us) — untouched       │
                    │   tasks · kills · sabotage · meetings    │
                    └───────────────┬────────────────────────┘
                                    │
              ┌─────────────────────┴─────────────────────┐
              ▼                                           ▼
    ┌───────────────────┐                     ┌────────────────────────┐
    │ SIGNALIS: a LENS   │                     │ PZ: PRESSURE SYSTEM    │
    │ how it looks       │                     │ what it costs to move  │
    │ how it sounds      │                     │ and to be believed     │
    │ how it feels in    │                     │ (moodles, noise, LOS,  │
    │ the hands          │                     │  granular interaction) │
    └───────────────────┘                     └────────────────────────┘
```

- The **lens** changes no rule. It changes perception, which changes *decisions*, which changes play.
- The **pressure system** adds cost to movement and honesty — but is bounded by the 90-second rule and
  the five beat structure of [02](02_AMONG_US_CORE.md) §1.

---

## 2. SIGNALIS: Aesthetic Direction as Mechanical Constraint

SIGNALIS is a retro-futuristic industrial survival horror: PS1-era low-poly rendering, a CRT framing
device, a monochrome-leaning palette punctuated by one alarm colour, oppressive analog UI, and sound
that carries most of the dread. Its atmosphere is **not** produced by gore or jump scares — it is
produced by *residue*: empty rooms that look recently used, machinery that hums at the wrong pitch,
corridors lit for a purpose you are not part of.

**The design insight we take:** atmosphere is a *legibility* problem. Dread comes from knowing what
something *means* and being unable to act on it in time. That is functionally identical to the
information problem in Among Us. So SIGNALIS does not decorate our game — it *increases the cost of
ignorance*.

### 2.1 Visual grammar (binding specification)

| Element | Specification | Mechanical function |
|---|---|---|
| **Resolution** | 320×180 internal, integer-scaled, 4:3 letterbox option | Small viewport = vision cone feels physically claustrophobic |
| **Palette** | Base: cold desaturated teal/steel/sickly amber. One **alarm colour** (signal red-orange) reserved *exclusively* for: crisis timers, kill flashes, ejection. Never decorative. | Colour is information. If red appears, something is already wrong. |
| **Value range** | Crushed blacks, narrow midtones, blown highlights only from fixtures | Shadow is genuinely opaque; hiding is real |
| **Lighting** | Static baked fixtures + a small dynamic pool around the player. Lights sabotage drops dynamic pool to 35%. | Vision radius *is* the lighting budget |
| **Dithering / CRT** | Ordered dither, scanline, chromatic aberration at screen edge, subtle barrel distortion | Reads as "an instrument you are looking through", not a window |
| **UI as hardware** | Menus, task interfaces, and the meeting screen render as *physical panels* — CRT terminals, stamped steel plates, dot-matrix printouts | Diegetic UI prevents the HUD from becoming an omniscient overlay |
| **Character scale** | ~1.6 units tall in a 14-unit room; camera slightly high-angle top-down | Bodies read as small in large industrial spaces |
| **Animation** | 8–12 fps stepped animation, no motion blur, deliberate input lag on heavy interactions | Weight. Every action has a *commitment window* the player feels. |

**Constraint that falls out of this:** the camera must never zoom out to show "the situation". The
player should never have a tactical overview. Any mechanic requiring a bird's-eye read is disqualified.

### 2.2 Audio direction (the primary dread carrier)

Audio does three jobs: **locate**, **warn**, and **lie**.

| Job | Implementation | Why |
|---|---|---|
| **Locate** | Footsteps, doors, task-machine hum, vent clatter are all **diegetic and positional** with distance-based low-pass + reverb per room | Sound becomes the second vision channel. Loud = discoverable |
| **Warn** | Crisis sirens are unique per sabotage (Reactor = deep sub pulse; O2 = rhythmic hiss; Lights = relay chatter) | Players learn to identify a crisis by ear before reading UI |
| **Lie** | Ambient machinery produces *false positives*: distant clanks, hull groans, vent-like rattles in empty rooms | Noise is not perfectly diagnostic; paranoia has a real basis |
| **Silence** | Rooms have per-room ambience beds that cut out entirely when a body is present | The most reliable tell is *absence* — which is also the most deniable claim ("it went quiet for me too") |

**Music policy.** No continuous score during play. Music appears only at:
1. **Meeting call** — a short, harsh, mechanical sting (3–5s).
2. **Crisis countdown** — a rising pulse that *is* the timer, so players can feel urgency without
   reading a number.
3. **Ejection** — the only melodic passage in the game, and it is mournful rather than triumphant.
4. **Game over** — a single sustained tone that decays past comfort.

This is a *cheap* policy and a *high-impact* one: sparse audio makes each cue enormous.

### 2.3 Tone rules (what we do not do)

- No jump scares, no gore-as-reward, no "monster reveal" moments. The horror is social.
- No playful UI copy. Flavour text is bureaucratic, clipped, and slightly wrong ("CREW COMPLEMENT:
  NOMINAL" while two crewmates are dead).
- No triumphant victory sting for the impostor. Winning as impostor should feel like *getting away
  with it*, not like celebrating.
- Death is quiet, brief, and unglamorous. A body is a *document*, not a spectacle.

### 2.4 How the lens changes play (the actual mechanical payoff)

| Aesthetic decision | Mechanical consequence |
|---|---|
| Small viewport, tight cone | Players physically cannot watch two corridors; trust becomes necessary |
| Opaque shadow | Hiding is a real option for crew *and* impostor |
| Diegetic UI only | No minimap omniscience; navigation knowledge is a skill |
| Positional audio with false positives | Witness testimony is genuinely uncertain — which powers the grammar |
| Heavy interaction commitment windows | "I was mid-task" is a credible alibi *and* a credible lie |
| Red reserved for alarms | A red flash at the edge of vision is unambiguous and unforgettable |

---

## 3. Project Zomboid: Systemic Pressure Without Bloat

Zomboid's genius is **granular consequence**: moodles stack, noise propagates, line of sight breaks,
and every action has an inventory and time cost. Its failure mode (for our purposes) is **tempo** — a
Zomboid run is hours; an Among Us round is minutes.

**The 90-second rule** (from [00](00_SWOT_AND_STRATEGY.md) §Pillar Tension) is the binding contract:

> No survival system may block the social loop for more than 90 seconds. Survival systems alter
> *capability and noise*, never *access*. A player who ignores every need still reaches the meeting —
> they arrive slower, louder, and less able to defend themselves.

### 3.1 The Moodle Stack (adapted, cut to eight)

Reference Zomboid has ~20 moodles. We ship **eight**, each mapped to an Among Us consequence:

| Moodle | Trigger | Effect (gameplay) | Social consequence |
|---|---|---|---|
| **Exhausted** | Sustained sprinting / carrying | Speed ↓ 25%, footsteps louder | You cannot outrun an impostor; you cannot sneak |
| **Winded** | Short burst, recovers fast | Speed ↓ 10%, breathing audible in quiet rooms | Breathing is a *tell*: someone hiding nearby is detectable |
| **Injured** | Survived an attack / environmental hazard | Speed ↓ 15%, occasional suppressed grunt | Injured players are *provably* survivors — but also bait |
| **Panicked** | Near a body, dark room, recent kill witnessed | Task interaction slower; occasional involuntary sound | Panic produces noise at the worst time |
| **Cold** | Long time in unheated sections | Shivering: rhythmic micro-noise | Predictable noise signature; trackable by ear |
| **Hungry/Thirsty** | Long match, low stores | Task speed ↓, stamina regen ↓ | Long matches pressure players toward the galley — a known location |
| **Filthy** | Contact with bodies, vents, coolant | Leaves visible residue trail briefly | Physical evidence! A trace the impostor must manage |
| **Focused** (positive) | Rested, fed, calm | Task speed ↑, interaction noise ↓ | Rewards *preparation*, which is a crew skill |

**Design rules for moodles:**
1. **Every moodle must be externally observable in some way** (sound, gait, residue). An invisible
   internal state is dead weight — it cannot be socially weaponised, which is the whole point.
2. **No moodle may be lethal on its own.** They degrade capability; they never kill. Death is the
   impostor's job.
3. **Maximum three moodles active at once.** Beyond three, the player stops reading them and they
   become noise. When a fourth would apply, the *lowest severity* one is suppressed.
4. **Moodles are a shared vocabulary, not a private HUD.** Because they are observable, they become
   Quick-Chat content ("Red was limping", "someone was breathing in the vent corridor").

### 3.2 Noise Propagation

The single most valuable import from Zomboid, and the one that most directly powers the grammar.

**Model.** Noise events are emitted at a position with an intensity and a frequency band. They
propagate through the room graph with per-material attenuation:

```
audibility(agent, event) = intensity(event)
                         − Σ attenuation(material of each room boundary crossed)
                         + boost(if agent in same room)
                         − distance_falloff(agent, event)
```

| Event | Intensity | Band | Attenuation notes |
|---|---|---|---|
| Footstep (walk) | 8 | low | 6 dB per wall |
| Footstep (sprint) | 22 | low-mid | 6 dB per wall |
| Door open/close | 20 | mid | doors are *leaky*: 3 dB |
| Task machine | 18 | mid | continuous while task held |
| Vent enter/exit | 30 | mid-high | deliberately loud; vents are risky |
| Kill | 26 | high | short, sharp, unmistakable *if audible* |
| Sabotage action | 24 | varies | unique per sabotage |
| Panic/vomit/grunt | 16 | mid | involuntary |
| Crisis siren | 40 | low | global, but direction-ambiguous |

**Three consequences:**
1. **Vents are loud.** Using a vent near a listener is a confession. This makes vent travel a real
   risk/reward decision instead of a free teleport.
2. **The killer's own noise is evidence.** A kill is audible through a door; a crewmate who "heard
   something in Electrical" has a *defensible* claim that is also easy to fake.
3. **Sound is directional but imprecise.** A listener learns *approximately* where, which is exactly
   the epistemic quality the Quick-Chat grammar needs (`LOCATION` + `TIME` with `STRENGTH` MILD/STRONG).

**Implementation note:** propagation is computed on the room graph, not per-sample raycasts. Cheap,
deterministic, and auditable by `noise_probe.py` (planned, [01](01_DEV_TOOLS.md) §7).

### 3.3 Line of Sight and the Vision Fallback

Zomboid's LOS model (break sight 2–3 times, path to last-known-position) maps directly onto our
impostor's hunt behaviour and our crew's escape behaviour:

- **Bodies of geometry** that block sight: walls, crates, machinery, closed doors, shadow pools.
- **LOS breaks are discrete and countable.** An agent that breaks LOS twice loses its target.
- **Last-known-position memory** decays: after 8s without reacquisition, the hunter begins a search
  pattern rather than a pursuit (see [04](04_AI_ARCHITECTURE.md) §5).
- **Crew use the same rule.** This symmetry is essential: the impostor must not have a supernatural
  tracking ability the player cannot use.

### 3.4 Granular Interaction (bounded)

Zomboid's interaction granularity is retained *only where it creates social evidence*:

| Interaction | Granularity kept | Why |
|---|---|---|
| Doors | Open / close / **lock-down state** / slam | Slamming is loud and *witnessed*; a door state is a claim |
| Machines | Multi-stage hold with visible progress | Observable = fakeable = suspicious |
| Bodies | Inspect (reveals cause + rough time) / report / **drag** | Inspection and dragging are *commitment windows* — you are vulnerable and visible |
| Vents | Enter/exit with clatter + cooldown | Loud, and the pause afterwards is a tell |
| Lights | Per-room switches, not one global breaker | Creates *partial* darkness = partial information |
| Storage | Small carry limit (2 hands / 1 heavy) | Carrying a body bag or oxygen tank visibly changes your silhouette |

**Cut on purpose:** no hunger/thirst *management* UI, no encumbrance maths, no crafting, no base
building, no barricading, no weapon degradation, no zombie-like third faction. The inventory is
**three slots** and exists purely so that *what you are carrying is visible to others*.

### 3.5 The Inventory (three slots, and why)

```
HAND_L  HAND_R  BACK
```
- **Hands** hold tools/tasks; both hands occupied = cannot open doors quickly, cannot fight, cannot
  report while fumbling.
- **Back** holds a heavy item (oxygen tank, body bag, cable spool) that changes your silhouette and
  slows you.
- **Everything is visible.** An impostor carrying a body bag is making a statement. A crewmate holding
  a fire extinguisher is making a different one.

This is the entire inventory system. It exists to make *intent legible from a distance*, which is the
raw material of suspicion.

---

## 4. The Merged Turn: What a Player Actually Does

A single 70-second play segment at default tuning:

```
0:00  Leave Cafeteria with two others. Footsteps echo. Moodle: Focused.
0:08  Green peels off toward Electrical. You note it (memory event, not a UI popup).
0:15  You take Align Engine Output at Upper Engine. Hold-interaction: 6s, machine hums.
0:21  Sirens: O2. Two-player fix. You are on the wrong side of the ship.
0:23  You sprint — moodle: Winded, footsteps loud. Corridor is dark (Lights were sabotaged last round).
0:35  You pass the MedBay threshold; a body is lying inside. You see it for 0.4s and keep moving.
      Decision point: report (meeting, but you were far from O2) or press on (crisis ticks down).
0:38  You reach O2. Cyan is already there. You take the second keypad. Both hands busy.
0:52  Crisis resolved. Sabotage cooldown for the impostor restarts.
0:55  Cyan: "you came from MedBay?" — you have eight seconds to decide what to admit.
```

Every line in that sequence is a core-loop beat. Nothing is a *side* system. That is the test.

---

## 5. Interface: Diegetic, Minimal, and Honest

| Surface | Rendering | Information given | Information withheld |
|---|---|---|---|
| **Play HUD** | Nothing but moodles (8 icons max) and an interaction prompt | Your own state | Everyone else's state |
| **Task list** | Physical clipboard, opened with a key, occupies the screen | Your tasks | Everyone else's location |
| **Map** | Wall-mounted panel you must *walk to*, static printout | Room names, your position | Other players |
| **Meeting screen** | CRT conference display, four portrait slots, transcript panel | Claims made | Who is lying |
| **Vote panel** | Stamped voting cards; anonymous by default | The tally | Voter identity (when anonymous) |
| **Crisis overlay** | Siren + edge pulse, no numbers | That time is short | Exactly how short (unless a station is checked) |

**Rule:** no HUD element may ever display information the player could not have obtained in-world.
The UI is an *instrument panel*, not an oracle.

---

## 6. Survival Pressure Curve (how Zomboid stays subordinate)

Pressure should *rise* across a match, not sit constant — otherwise the early game has no texture:

| Match phase | Dominant pressure | Player experience |
|---|---|---|
| **Early** (meetings 1–2) | Social ambiguity; few bodies | "Who is quiet?" |
| **Mid** (meetings 3–4) | Moodle stacking + sabotage tempo | "I can't keep up with the crises AND the tasks" |
| **Late** (meetings 5+) | Resource scarcity (power, heat, light), paranoia, injuries | "The ship is failing and one of us is doing it" |

Implementation: a **Ship Integrity** scalar (0–100) that decays slowly with each crisis and each
unfixed sabotage, and never with kills. At low integrity, ambient lights fail more often and rooms
get louder. It is a *mood* dial, not a fail state — it can never itself end the game.

This is where the SIGNALIS lens and the Zomboid pressure merge cleanly: the ship becomes visibly
worse to be inside, which raises the cost of every action, which raises the stakes of every meeting.

---

## 7. Budget Caps (the anti-bloat contract)

Hard ceilings, enforced in review. Any exception requires a logged decision in [00](00_SWOT_AND_STRATEGY.md):

| System | Cap | Rationale |
|---|---|---|
| Moodles | **8** | Beyond 8, players stop reading; also caps sim complexity |
| Sabotage types | **5** (Reactor, O2, Lights, Comms, Doors) | Each needs unique audio, UI, fix flow, AI response |
| Inventory slots | **3** | Any more becomes inventory management, not social signalling |
| Rooms per map | **14** | Beyond 14, travel time breaks the meeting interval budget |
| Task types | **15** | Enough variety for 6 tasks/crewmate without duplicate fatigue |
| Visual/audio "systemic" features per match | **1** (Ship Integrity) | One global pressure dial; no stacked meta-systems |
| Simultaneous moodles shown | **3** | Readability floor |
| Continuous music tracks | **0** | Sparse audio policy (§2.2) |

---

## 8. Anti-Patterns Rejected (with reasons)

| Tempting import | Why rejected |
|---|---|
| Zombie-like third faction | Fractures the two-faction win math; the horror is *social*, not bestial |
| Crafting / base-building | Time cost violates the 90-second rule; also irrelevant to social deduction |
| Weapon combat | Makes kills symmetric; destroys the impostor's asymmetry |
| A "sanity" meter that distorts the screen | Aesthetic noise with no social consequence; the player learns to ignore it |
| Hunger that kills | Moodles must degrade, not execute |
| Skill trees / progression within a match | Among Us is a flat-information game; upgrades break its fairness contract |
| Omniscient minimap | Deletes the entire information economy |
| Quest markers pointing at task stations | Navigation knowledge is a legitimate skill; markers make movement free |

---

## 9. Summary — the four seams

| Seam | Rule that makes it work |
|---|---|
| **SIGNALIS → Among Us** | Atmosphere is legibility: the lens makes the information problem *feel* physical. No rule changes. |
| **Zomboid → Among Us** | Pressure, not access. The 90-second rule and the "no lethal moodles" rule keep survival subordinate. |
| **Zomboid noise → Quick-Chat** | Every noise event is a *claimable fact* with genuine uncertainty — the raw material of testimony. |
| **All three → AI** | Because every state is observable and structured, the AI in [04](04_AI_ARCHITECTURE.md) can reason about it without cheating. |

---

## Appendix A — Sources consulted

- SIGNALIS visual direction (PS1-era aesthetic, CRT framing, low-poly, oppressive palette):
  <https://gamesline.net/game-of-the-year-awards-2022/>
- SIGNALIS audio direction (detuned keys, machine noise, silence as a tool):
  <https://www.rockpapershotgun.com/signalis-review>
- SIGNALIS atmospheric analysis (analog UI, static, industrial hum):
  <https://gameonreviews.com/signalis-review-a-horror-game-you-cant-escape/>
- Project Zomboid moodle semantics and stacking (panic, endurance, pain, sickness, noise from cold):
  <https://gamers.wiki/en/games/project-zomboid/guides/project-zomboid-moodles-guide-every-status-icon-explained>
- Project Zomboid death-spiral analysis (moodles compound; each protects the next):
  <https://gamers.wiki/en/games/project-zomboid/guides/project-zomboid-moodle-stacking-break-death-spirals>
- Project Zomboid detection model (sight + sound, LOS breaks, pathing to last-known position):
  <https://www.bamboogaming.net/project-zomboid/combat>
- PZwiki survival guide (noise carries through walls; break LOS 2–3 times):
  <https://pzwiki.net/wiki/Survival_Guide>

**Adaptation note.** Nothing above is copied mechanically. Each reference behaviour is reduced to a
rule that serves an Among Us beat ([02](02_AMONG_US_CORE.md) §1), then capped by §7's budget table.
Where a reference system would violate the 90-second rule, it is cut and the cut is logged in §8.
