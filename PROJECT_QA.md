# PROJECT AMONG VESSELS — Design & Engineering Q&A

> This is the pre-build interview document. It exists so that every later decision has a
> written rationale, and so a reviewer can attack the design *before* it costs code.
> Answers are deliberately opinionated. Where a question has no settled answer, it is marked
> **DEFERRED** with the working assumption the build will use until told otherwise.

**Status:** authored at project kickoff, before Milestone 1 code.
**Companion documents:** `PROJECT_BRAIN.md` (architecture, SWOT, live milestone state).

---

## 0. How do I run it?

```
npm run dev        # serves on 0.0.0.0:5173, open the printed URL
npm run verify     # syntax + import-graph check, no browser needed
npm run test:logic # unit checks for pure systems (grid, grammar, memory, surfaces)
```

`npm install` is **not** required to play: Three.js and Rapier are committed under `vendor/`.
Dependencies are only needed if you want to re-run `npm run vendor` after a version bump.

You cannot double-click `index.html`. No browser will load ES modules or WASM from
`file://` — that is a browser security rule, not a project choice. One local server command
is the price of *any* browser 3D game, so we picked the smallest possible one.

---

## 1. Product definition

### Q1.1 — One sentence: what is this game?
A first-person social-deduction sandbox aboard a broke corporate freighter, where every
crewmate — including you — has a private reason to lie, and where evidence is a physical
object you can pick up, photograph in your memory, or plant on someone else.

### Q1.2 — What is the 90-second core loop?
1. You leave your bunk and walk the spine corridor; the ship is cold, humming, underlit.
2. A task console asks you to reset a breaker in Reactor. On the way you hear two voices in
   MedBay through a vent — one of them is not supposed to be there.
3. You arrive to find a body, or a door forced open, or nothing at all. You do not get a
   convenient pop-up. You get *evidence*: a dropped wrench, a badge, a vent grate unscrewed.
4. You decide whether to call a meeting, say nothing, or use what you know to extract a favour.
5. The ship keeps running while you decide: lights fail, doors seal, someone dies, and the
   Director quietly moves patrol weight toward the sector you just left.

### Q1.3 — What is it explicitly *not*?
Not a shooter campaign, not a crafting/building game, not an open world, not a hero story, not
a lobby game with matchmaking. There is no persistent meta-progression, no cosmetic shop, and
no "kill button on a cooldown". The scope discipline in §7 exists to protect that.

### Q1.4 — How is this different from the thousand *Among Us* clones?
Four mechanical commitments, not vibes:

| Other clones | This project |
| --- | --- |
| Hitscan crosshair, cooldown kill button | Barrel-vector projectiles from the physical muzzle; manual gun states; melee impulses and knockdown |
| A red "suspicious" animation tells you who it is | No tell. Evidence is world-state: doors, vents, blood, missing items, badge IDs |
| NPCs either know everything or nothing | Memory tuples with `certainty` and decay; they can be *wrong* and can *lie* |
| Tasks are a progress bar | Tasks are physical: flip a breaker, carry a crate, weld a vent — and doing them makes noise and takes time |

---

## 2. Structure & architecture

### Q2.1 — How is the codebase organised, and why that way?
Feature-first modules under `src/`, each with one job and a narrow surface:

```
core/     bus, loop, input, rng, config        (no game concepts)
render/   surfaces, textures, materials        (no gameplay)
audio/    procedural synth                     (no gameplay)
world/    blueprint, grid, builder, doors,
          power, props, interaction            (the ship)
player/   controller                           (embodiment)
ui/       hud                                  (DOM overlay)
```

Rule: `world/` may import `core/` and `render/`; `render/` may never import `world/`. If a
module needs to reach "upward", it emits a bus event instead. This keeps the ship builder
replaceable (a future multi-deck layout is a new blueprint, not a rewrite).

### Q2.2 — Why a JSON/JS blueprint plus a builder instead of a hand-placed scene?
A hand-placed `.glb` level is opaque to code: the AI cannot reason about rooms, the power
system cannot know which lights belong to a circuit, and every layout tweak is a Blender
round-trip. A 6-cell-grid blueprint gives the builder, the AI navigator, the Director, and the
meeting UI one shared source of truth — rooms have IDs, doors have IDs, cells have owners.
Geometry is then *derived*, so a designer can change the ship in 20 lines of data.

### Q2.3 — Why an event bus? Isn't that how spaghetti happens?
It is, if the bus is used for control flow. The rule here: **the bus carries facts and
intents, never return values.** Consumers cannot ask the bus a question. Every topic is
declared in a contract table in `PROJECT_BRAIN.md §3`; adding a topic without a row in that
table is a review failure. Direct calls are still used wherever two systems are structurally
adjacent (e.g. `interaction` → `doors.pry()`).

### Q2.4 — How is time scheduled?
Fixed 1/60 s physics steps with an accumulator capped at 4 substeps (spiral-of-death guard).
Rendering happens once per animation frame with a clamped delta. All gameplay timers are in
fixed steps, so a 30 fps machine and a 144 fps machine simulate the same ship.

### Q2.5 — Rapier or Cannon-es?
**Rapier3D (WASM).** Deciding factors, in order: a purpose-built
`KinematicCharacterController` (autostep, snap-to-ground, slope limits, impulse transfer to
dynamic props) that Cannon has no equivalent for; continuous collision detection for
barrel-vector projectiles that must not tunnel through a 24 cm bulkhead at 60 m/s; and
determinism, which matters once the AI Director needs to reason about physics outcomes.
Cost: a 4.2 MB WASM payload, vendored locally, initialised once behind the loading screen.

### Q2.6 — Why no bundler, and what do we lose?
Vite would give us HMR and tree-shaking. We lose both, and we accept it: the game is a single
page with ~20 modules, so unbundled load is one HTTP/1.1 burst of local files, and shader/asset
sizes dominate anyway. In exchange we gain a build that cannot break, a repo a player can run
without `npm install`, and no dev-server host/origin allowlist to fight inside a preview proxy.
Re-evaluate if the module count passes ~80 or vendor payload passes ~20 MB.

### Q2.7 — How does state persist across milestones?
`PROJECT_BRAIN.md` is the memory: §7 tracks done/active/broken per milestone, §8 is the
decision log. Code contracts (event topics, blueprint schema, memory tuple schema) live in the
same file, so a fresh session can resume without archaeology.

---

## 3. Gameplay

### Q3.1 — What does the player do in minute 1 / 5 / 20?
- **Minute 1:** learn the body. Pointer lock, headbob, the flashlight you have to switch on
  because the corridor is genuinely dark. Read the duty roster on the wall.
- **Minute 5:** learn the ship as a machine. A breaker is off, a door will not open, and the
  ship tells you which circuit is dead via the panel, not via a quest marker.
- **Minute 20:** learn the people. You know who was in Cargo, who lied about it, and who is
  carrying a blood debt that names you. Now the question is what you can prove.

### Q3.2 — Who are the NPCs and how many?
Eight crew: the player plus seven AI, all procedurally assembled from the same rig and outfit
generator so no silhouette telegraphs guilt. Roles: Captain, Security Officer, Engineer,
Medic, Quartermaster (Cargo), Technician, and a forged-ID Stowaway. Roles define *access*
(whose badge opens which door), *duties* (which consoles they use), and *social weight* (who
is believed in a meeting) — never alignment.

### Q3.3 — How does the Blood Debt system work mechanically?
At run start the agenda director assigns zero, one, or two agendas from a weighted pool:

- **Blood Debt** (stowaway or debtor): "Survive, unless <crewmate> is still alive at jump." Objective is conditional, not genocidal.
- **Corporate Directive** (crew role): "Eliminate <crewmate>; they became a liability." Held by someone with *legitimate authority* — often Security.
- **Ledger** (stowaway): "Recover your debt ledger from <crewmate>'s locker. They must not report you."
- **Asset Protection** (any): "Ensure <system> stays online." Tempts sabotage for noble reasons.

Agendas are *motives*, not permission slips. They never grant magical abilities: an agenda
holder must still obtain a weapon, still be seen, still lie about it.

### Q3.4 — Isn't "Security Officer with a kill directive" unfair to the player?
Only if it is unobservable. Counterplay is explicit: (a) agendas force *specific* victims, so
pattern-hunting works across a run; (b) killing leaves physical traces — blood, a dropped
weapon, an opened door logged in the security terminal; (c) role authority is itself evidence:
"why was Security in Quarters at 03:00 with the door sealed?" is a question the meeting UI can
force them to answer; (d) the Director caps how often a lethal agenda spawns in a given run.

### Q3.5 — Win and loss conditions?
- **Crew win:** survive to jump (voyage clock), with the saboteur/agenda-holder contained (dead, ejected, or brigged) — or the ship intact if no lethal agenda exists.
- **Agenda win:** complete the directive and be alive at jump. Being *suspected* is survivable; being *voted out* is not.
- **Loss for everyone:** reactor breach, hull vent, or everyone dead. The ship is a shared failure state.
- **Death of the player:** not an instant game over — you become a disembodied "black box" observer who can still read terminals, and the run resolves at jump. (DEFERRED: whether dead players get a single corpse-interaction action.)

### Q3.6 — What replaces the kill button?
Intent plus opportunity: a physical weapon taken from an armory or a toolbox, a private space,
and a victim who is alone and does not hear you chamber a round. Combat is *loud* — that is
the whole balance. A silenced kill is a skill expression, not a UI affordance.

### Q3.7 — How are meetings called and what is the cost?
Any living crew can call one from a wall terminal or the Bridge table, at a limited number per
run. Meetings freeze the ship (doors hold, tasks pause), so they are also a way to *stop* a
sabotage — which makes calling one a strategic act rather than a panic button. A meeting with
no evidence costs credibility: the caller's social weight decays.

---

## 4. Combat & props

### Q4.1 — How does aiming work with no crosshair?
The bullet's origin and direction come from the weapon's muzzle bone in world space, after
procedural sway, breathing, movement inertia, and recoil torque are applied. Where the barrel
points is where the round goes; a small crosshair dot may exist as an accessibility toggle, but
it is not the aiming system. This means stance and timing matter, and it means a panicked shot
in a dark corridor misses — by design.

### Q4.2 — Manual gun states sound like friction. Why?
Because a gun that is always ready removes the tension of *deciding to escalate*. The sequence
is `Unprimed → Racked → Safety Off → Fire`, plus manual magazine checks and reloads, each with
a diegetic sound that other entities can hear through walls. The friction is the mechanic: the
click of a safety is a tell. Mitigations against pure annoyance: state is visible on the
weapon model itself (chamber flag, safety lever), the HUD only appears when you raise the
weapon, and NPCs treat "heard a slide rack" as a high-certainty memory.

### Q4.3 — Melee and ragdolls?
Melee is a physics sweep from the held object's transform with an impulse scaled by mass and
swing speed. A hit applies knockback, a stumble, and a chance of active-ragdoll collapse
(temporary loss of control, then a get-up) rather than HP subtraction. Fire extinguishers are
both a weapon and a way to obscure vision. Ragdolls are capped in count and simulated with
fixed substeps to avoid tunnelling at low FPS.

### Q4.4 — Why do props matter so much?
Props are the game's evidence layer. A crate moved, a wrench missing from its foam cutout, a
clipboard on the wrong desk — all of it is state that NPCs can witness and report. Props are
therefore pooled and physics-cheap, but their *positions* are persistent and queryable.

---

## 5. AI

### Q5.1 — Two tiers. What does each actually own?
- **Macro Director (omniscient, never cheats):** sees only aggregates — tension gauge, sector
  activity heat, NPC stress, time since last encounter, ship system health. It reweights
  *sector patrol probability* and motivates events (a light flicker, a distant thump). It never
  passes coordinates to a hunter and never spawns an NPC inside line of sight.
- **Micro NPC (blind and deaf outside its senses):** vision frustum with occlusion and light
  gating, hearing radius with loudness falloff, a behavior tree, a blackboard, and a memory
  store. It cannot know what the Director knows. Everything it "knows" is a memory tuple.

### Q5.2 — Isn't the Director just a cheat with extra steps?
The honest test: if you gave the player the Director's state, they could not point at the
assassin. The Director never says "player is in MedBay"; it says "sector MedBay tension 0.8",
and a patrol NPC chooses its next waypoint from a weighted table that *may* include MedBay.
Encounters are emergent probability, not scripted pursuit. Guardrail: a 20 s cooldown after any
forced encounter, and sectors are 2-room granularity.

### Q5.3 — How expensive is vision?
One sphere/cone test per NPC against a small candidate set (props + crew within 18 m), then a
single physics raycast to the target's chest for occlusion, plus a light-level sample for
darkness gating. Staggered across frames at 10 Hz per NPC, not per frame. Hearing is
distance-plus-loudness with a wall attenuation factor, evaluated on event emission, not polled.

### Q5.4 — Memory tuples: what exactly is stored?
`{ witnessId, subjectId, actionTag, targetObj, roomId, timestamp, certainty }`, plus the
witness's *believed* version once they lie. Certainty decays with time and with contradictory
memories; `certainty < 0.35` memories are not spoken as fact but as suspicion ("I think…").
Memories are capped per NPC (oldest low-certainty entries evicted) and are the only input to
speech.

### Q5.5 — Lying: how do NPCs stay consistent?
A lie is generated once, at utterance, by mutating `subjectId` or `roomId`, then written back
into the memory store as a *believed* tuple with a `lie` flag. Subsequent utterances draw from
the same mutated tuple, so an NPC cannot accidentally tell two different stories. If another
NPC contradicts them, both memories gain a contradiction flag and a `SuspicionMatrix` entry.

### Q5.6 — How do NPCs pathfind without getting stuck on props?
Navigation comes from the blueprint, not from the physics mesh: waypoint graph at room centres
plus door nodes, A* over the graph, then local steering toward the next waypoint with a short
obstacle raycast. Dynamic props are never baked into the graph; if a prop blocks a doorway, the
NPC pushes it (physics impulse) or reports "route blocked" and takes the long way. Stuck
watchdog: no progress for 3 s → re-plan.

### Q5.7 — What is `ArchetypeBehavior`, and why now?
An interface (`senses`, `decide`, `speak`, `onDamage`) implemented by the human archetype. A
future non-human mimic plugs in by implementing the same interface and registering with the
entity factory; no core system changes. We define the seam now and keep the human
implementation thin enough that the seam stays honest.

---

## 6. Meetings & speech

### Q6.1 — Grammar rules: what is the actual difference?
Both forms are grammatical English; the rule is about *lexical aspect*, not correctness.

| Action tag class | Example | Synthesised line |
| --- | --- | --- |
| Transitive gerund (takes an object) | `sabotage(wires)` | "I saw **Blue sabotaging** wires in Electrical." |
| Intransitive / task / activity | `medbay_scan` | "I saw **Red doing** a medbay scan in MedBay." |
| Change of state | `open(door)` | "I saw **Red open** the Cargo door." |
| Stative / possession | `hold(ledger)` | "I saw **Red carrying** a ledger." |

So: intransitive activities get the light verb *doing*; transitive events conjugate the verb
directly and drop *doing*. A tag's class is data (`verbClass: 'transitive' | 'activity' |
'change' | 'state'`), which keeps the synthesiser deterministic and testable.

### Q6.2 — How do I use evidence in a meeting?
Evidence is physical or logged: a carried item you can place on the table, a terminal entry
(door opened at 03:00 by badge #4471), or a memory you personally hold. Presenting forces a
specific NPC to respond to a specific claim, which is more interesting than a free-text chat
box and far cheaper to make coherent.

### Q6.3 — Can the player lie in a meeting?
Yes, via the same structured quick-chat: claim, subject, action, room. The difference is that
NPCs hold their own memories and can contradict you — and the UI shows who contradicted whom,
so the table can see the conflict even if it cannot resolve it.

---

## 7. Scope & milestones

### Q7.1 — What ships in each milestone?

| # | Deliverable | Explicitly *not* in it |
| --- | --- | --- |
| 1 | Ship generator, PBR surfaces, audio synth, FPS controller, doors, breakers, interaction, HUD | Combat, NPCs, agendas |
| 2 | Pickup/throw, melee impulses, manual gun states, barrel-vector projectiles, knockdown | Ragdoll *animation* fidelity (physics-only collapse) |
| 3 | NPC rigs/outfits, vision/hearing, memory tuples, behavior tree, nav graph, Director | Speech, voting |
| 4 | Agendas/blood debts, quick-chat synthesis, meeting debate/vote, win/loss, jump clock | Online multiplayer, meta-progression |

### Q7.2 — What is cut or deferred?
Multiplayer/netcode (the bus is the seam for it), full ragdoll skinning, ship-to-ship travel,
crafting, controller support, save/load mid-run, localized text. Each is a *later* hook, not a
missing piece of the loop.

### Q7.3 — How do we verify "zero console errors" without a GPU in this environment?
Four layers, honestly labelled:
1. `npm run verify` — syntax, import-graph and import-map resolution for every module, plus layering rules.
2. `npm run test:logic` — unit checks for the pure systems (grid generation, greedy run merging, door adjacency, surface data ranges/determinism), plus a PNG contact sheet of the generated textures so art can be reviewed outside a browser.
3. `npm run test:smoke` — a jsdom environment plus **real Rapier**: the ship is built, the player settles, walks, opens a door, walks through the doorway, is blocked when the servo bus dies, forces the door by prying, and the breakers restore it. The HUD is instantiated against the real `index.html`, so a wrong element id fails the build. This is the closest thing to "it runs" that exists without a GPU.
4. The live preview in the user's browser, guarded by a `window.onerror` / `unhandledrejection` trap and a 20-second boot watchdog that render a visible red fault panel instead of a silent black screen.

Only layer 4 can judge *looks* (lighting, texture feel, audio timbre). Layers 1–3 exist so that
layer 4 is rarely where a bug is first discovered — and so that physics and layout regressions
are caught even when nobody is watching the screen.

One trap worth recording: a hand-rolled partial `window` stub makes Rapier's WASM panic inside
`world.step()` with an opaque `unreachable`. Use jsdom for headless runs.

### Q7.4 — Definition of done for a milestone?
Builds and serves with no console errors, all listed features reachable by keyboard/mouse
without a debug console, `PROJECT_BRAIN.md` updated (state, decisions, known bugs), and a
verification pass recorded in §7 of that document.

---

## 8. Technical risks (short form)

| Risk | Mitigation |
| --- | --- |
| Physics tunnelling at low FPS | Fixed 1/60 step, max 4 substeps, CCD on fast projectiles |
| Draw-call explosion from per-cell walls | Wall runs merged greedily by line + material; world-aligned UVs; ≤ 12 draw calls for static shell |
| Too many shadow-casting lights | Emissive fixtures everywhere; a pool of 5 real point lights follows the player; only the flashlight casts shadows |
| Canvas texture generation stalls load | Pure-array generators run once behind a loading screen; 512²; measured in Node via `test:logic` |
| AI stuck on dynamic props | Blueprint nav graph, props never baked, stuck watchdog re-plan |
| Pointer-lock quirks | Single click-to-capture overlay, no synthetic requests, state mirrored from `pointerlockchange` |
| Scope creep | Milestone table is a contract; new ideas go to §9 "deferred" |

---

## 9. Decisions locked in this session

| Decision | Choice | Why |
| --- | --- | --- |
| Physics | Rapier3D (WASM) | Character controller + CCD + determinism |
| Play mode | Single-player, player + 7 AI crew | Playable loop first; bus is the netcode seam |
| Ship scale | 6 compartments + airlock vestibule, one deck | Deduction density over square metres |
| Tooling | Plain ESM + import map + vendored deps + tiny Node server | No build step; no CDN; preview-safe |

### Deferred with a working assumption
- **Jump clock length:** 12 minutes (long enough for two agendas, short enough to finish a run).
- **Dead-player agency:** observer only, one post-mortem interaction. Revisit in M4.
- **Crosshair:** off by default, accessibility toggle. Revisit after playtesting.
- **Player count if multiplayer is ever added:** 8 (same as the AI cast, so the Director does not need retuning).

---

## 10. Open questions to settle before Milestone 4
1. Does the meeting vote require a majority of *living* crew, or a plurality with a tie-break?
2. Is a brig (containment) a real system, or does "contained" only mean dead/ejected?
3. How does the player learn their own agenda — dossier at spawn, or discovered in the world?
4. Does the Stowaway's forged ID survive a terminal check, and if so, what is the tell?
5. Should the Director be allowed to instigate a *non-lethal* event (lights out, door seal) as
   an encounter, or only reweight patrols?
