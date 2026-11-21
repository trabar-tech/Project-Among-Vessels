# PROJECT_BRAIN.md

> **Living master document.** Update at the end of every milestone: §7 state, §8 decisions,
> §9 known bugs. If code and this document disagree, this document is wrong — fix it, then fix
> the code. Companion: `PROJECT_QA.md` (design rationale, Q&A).

**Project:** Project Among Vessels
**Build:** browser-native 3D social-deduction & emergent survival sandbox
**Stack:** Three.js r187 (WebGL2) · Rapier3D 0.21 (WASM) · Web Audio · Canvas2D procedural art
**Runtime:** plain ES modules + import map, deps vendored, zero build step
**Last updated:** Milestone 1 complete and verified headlessly (see §7)

---

## 1. Mission and non-negotiables

1. **No one is a hero.** Roles grant access and authority, never alignment. Motive is hidden; evidence is physical.
2. **The ship is a machine, not a backdrop.** Power, doors, and air are linked systems the player can break.
3. **AI never cheats.** The Director sees aggregates; NPCs see through frustums and hear through walls.
4. **Aim is physical.** No hitscan-from-screen-centre, ever.
5. **Scope is a contract.** §7 is the contract; new ideas go to the deferred list, not into the milestone.

---

## 2. Architecture map

### 2.1 File tree

```
index.html                  entry: import map, boot watchdog, loading/pause overlay, HUD markup
styles.css                  HUD / terminal chrome
package.json                scripts only; runtime needs no install (vendor/ is committed)
PROJECT_BRAIN.md            this file
PROJECT_QA.md               design Q&A and rationale
vendor/                     three.module.js, three.core.js, addons/BufferGeometryUtils, rapier.mjs
tools/
  dev-server.mjs            zero-dep static server (0.0.0.0, no-store, correct MIME)
  sync-vendor.mjs           copies pinned deps from node_modules into vendor/
  verify.mjs                syntax + import-graph + import-map + layering validation
  test-logic.mjs            Node unit checks for blueprint/grid/surfaces
  smoke-test.mjs            jsdom + real Rapier integration run (physics, doors, power, HUD)
  preview-surfaces.mjs      contact sheet of generated textures -> tmp/surface-preview.png
  lib/png.mjs              dependency-free PNG encoder for the preview dump
src/
  core/
    config.js               all tuning constants (cell size, wall height, speeds, budgets)
    bus.js                  topic-declared event bus (facts and intents only)
    loop.js                 fixed-step accumulator + render callback
    input.js                pointer lock, key/mouse state, edge-triggered presses
    rng.js                  seeded mulberry32 + helpers (deterministic runs)
  render/
    surfacegen.js           pure pixel generators (albedo/roughness/height -> normal), no THREE
    textures.js             surfacegen -> CanvasTexture sets, tiling, anisotropy
    materials.js            shared materials, decal/sign/screen textures
  audio/
    synth.js                Web Audio graph: ambience bed, footsteps, doors, breakers, UI
  world/
    blueprint.js            the ship as data: rooms, doors, lights, props, circuits
    grid.js                 occupancy grid, edge extraction, greedy wall-run merging (pure)
    builder.js              blueprint -> merged geometry + Rapier colliders + fixtures
    doors.js                sliding door instances, power gating, manual pry
    power.js                circuit state machine, breakers, flicker choreography
    props.js                static set dressing + a few dynamic rigid-body crates
    interaction.js          raycast hover registry, prompts, press/hold verbs
  player/
    controller.js           Rapier kinematic character controller, look, bob, flashlight
  ui/
    hud.js                  DOM overlay: prompts, room name, circuits, battery, fps, errors
  main.js                   composition root: renderer, world, systems, loop, error trap
```

### 2.2 Module responsibilities and dependency direction

| Module | Owns | May import | Must not |
| --- | --- | --- | --- |
| `core/*` | time, input, randomness, events | nothing but stdlib/three | game concepts |
| `render/*` | pixels and materials | `core/` | know about rooms, doors, NPCs |
| `audio/*` | sound synthesis | `core/` | know about gameplay state |
| `world/*` | ship data → geometry, systems | `core/`, `render/`, `audio/` | touch the camera or DOM |
| `player/*` | embodiment | `core/`, `world/` (read-only) | own world state |
| `ui/*` | DOM overlay | `core/` (bus) | mutate world directly |
| `main.js` | wiring only | everything | contain gameplay rules |

Dependency direction is enforced by review, and checked cheaply by `tools/verify.mjs` (it
rejects `render/` importing `world/`).

### 2.3 Frame flow

```
rAF
 └─ loop.frame(dt)
     ├─ input.endFrame()                  edge states cleared each fixed step
     ├─ accumulate dt, up to 4 × (1/60)
     │   ├─ player.fixedUpdate(step)      char controller solve, look, bob
     │   ├─ doors.fixedUpdate(step)       target openness, kinematic slide
     │   ├─ power.fixedUpdate(step)       flicker envelopes, breaker timers
     │   ├─ interaction.fixedUpdate()     10 Hz hover raycast
     │   ├─ world.step()                  Rapier fixed step
     │   └─ props.sync()                  rigid body -> mesh
     └─ render(alpha)                     camera pose, light pool, hud.update()
```

### 2.4 Event bus contracts

Topics must be declared in `core/bus.js` before use. Payloads are plain JSON-able objects.

| Topic | Payload | Producer | Consumers |
| --- | --- | --- | --- |
| `power:circuit` | `{circuit, live, reason}` | `power` | `builder` (lights), `doors`, `hud`, `audio` |
| `power:flicker` | `{circuit, seconds, intensity}` | `power` | `builder` (lights), `hud` |
| `door:state` | `{doorId, state, powered}` | `doors` | `hud`, `audio`, `interaction` |
| `door:pry` | `{doorId, progress}` | `doors` | `hud` |
| `interact:hover` | `{id, label, verb, hold, progress, enabled}` \| `null` | `interaction` | `hud` |
| `interact:used` | `{id, action, holdSeconds}` | `interaction` | `audio`, `hud`, systems |
| `player:room` | `{roomId, prevRoomId}` | `player` | `hud`, `audio`, (later) Director |
| `player:footstep` | `{roomId, surface, speed}` | `player` | `audio` |
| `player:flashlight` | `{on, battery}` | `player` | `hud` |
| `ui:prompt` | `{text, tone}` | any | `hud` |
| `audio:cue` | `{cue, opts}` | any | `audio` |
| `game:ready` | `{ms}` | `main` | `hud` |
| `game:error` | `{message, stack}` | `main` | `hud` |
| `debug:stats` | `{fps, steps, drawCalls, triangles}` | `main` | `hud` |

Reserved for later milestones (declared, not yet emitted): `npc:memory`, `npc:speak`,
`meeting:open`, `meeting:vote`, `agenda:assigned`, `ship:jump`, `run:end`.

### 2.5 Data contracts

**Blueprint (M1, stable).** Grid units are cells of `config.CELL` metres; `rect` is
`[x, z, widthCells, depthCells]` with the origin at cell corner `(0,0)`.

```js
{
  id: 'ISV-KESTREL-90', name: 'ISV Kestrel-90',
  rooms: [
    { id: 'CORRIDOR', name: 'Spine Corridor', kind: 'corridor',
      rect: [4, 0, 2, 12], circuit: 'A', floor: 'deck', wall: 'hull' }
  ],
  doors: [   // axis 'x' => wall perpendicular to X at x = line*CELL
    { id: 'D_MEDBAY', a: 'CORRIDOR', b: 'MEDBAY', axis: 'x', line: 4, start: 1, end: 2,
      kind: 'standard' }      // standard | heavy | airlock | vent
  ],
  lights: [ { id, room, at: [cx, cz], circuit: 'A', intensity: 1.0 } ],
  props:  [ { kind: 'crate', at: [x, z], rot?: 0, dynamic?: true } ],
  breakers: [ { id, circuit, label, at: [x, z], wall: 'N'|'S'|'E'|'W', room } ]
}
```

**Memory tuple (M3, fixed now so sensors are written against it).**
`{ witnessId, subjectId, actionTag, targetObj, roomId, timestamp, certainty, verbClass, believed? }`
where `verbClass ∈ {transitive, activity, change, state}` drives quick-chat conjugation.

**Agenda (M4, fixed now).** `{ id, ownerId, kind, targetId?, systemId?, lethal, revealed }`
with `kind ∈ {blood_debt, corporate_directive, ledger, asset_protection}`.

---

## 3. SWOT — HTML5 3D browser constraints

### Strengths (what we lean on)
- **S1 Rapid procedural geometry.** Rooms are derived from a 20-line blueprint; layout iteration costs no artist time.
- **S2 Dynamic lighting and shadows.** Emissive fixtures + a moving light pool give a lit ship without baked lightmaps.
- **S3 Real-time raycasting.** Hover prompts, sensor occlusion, and nav steering all reuse one raycast path.
- **S4 Zero-install deployment.** A URL is the whole distribution channel; `vendor/` means no CDN dependency.

### Weaknesses (and the concrete rule that neutralises each)

| # | Weakness | Mitigation implemented | Where |
| --- | --- | --- | --- |
| W1 | Single-threaded main loop | Fixed 1/60 step, max 4 substeps; expensive perception at 10 Hz staggered per entity; no per-frame allocation in hot paths | `core/loop.js`, `world/interaction.js` |
| W2 | Memory ceiling for high-poly assets | Everything generated from primitives; merged static shell; textures generated at 512² not loaded; target < 250k tris | `world/builder.js`, `render/surfacegen.js` |
| W3 | Draw-call overhead | Greedy wall-run merging + world-aligned UVs → whole static shell in ≤ 12 draws; zero per-cell meshes | `world/grid.js`, `world/builder.js` |
| W4 | Pointer-lock quirks | One click-to-capture overlay, state mirrored from `pointerlockchange` (never assumed), no synthetic requests, ESC path tested | `core/input.js`, `ui/hud.js` |
| W5 | Canvas texture cost | Pixel loops are pure functions (Node-testable, timed by `test:logic`); generated once behind the loading screen | `render/surfacegen.js` |
| W6 | Light count limits | Emissive geometry everywhere; a pooled 5 point lights track the player; only the flashlight casts shadows | `world/builder.js`, `player/controller.js` |

### Opportunities (planned exploit, not wishful thinking)
- **O1** Procedural hull/outfit generation → a ship and a crew that look hand-authored for zero asset cost (M1 hull, M3 crew).
- **O2** Physics-driven combat → knockdown, thrown tools, extinguisher screens; emergent fights instead of HP maths (M2).
- **O3** Lightweight semantic dialogue → memory tuples + a table-driven grammar beat any LLM dependency for coherence and cost (M4).
- **O4** Diegetic evidence → the world itself is the accusation UI; no bespoke "clue" system (M1 evidence props → M4 meetings).

### Threats (and the guardrail)

| # | Threat | Guardrail |
| --- | --- | --- |
| T1 | Physics tunnelling at low FPS | Fixed step; CCD on fast projectiles; capsule character controller (no thin colliders); ragdolls capped and substep-simulated |
| T2 | AI stuck on dynamic props | Nav graph comes from the blueprint, never from physics; props are pushed or the route is re-planned; 3 s no-progress watchdog |
| T3 | Scope creep breaking core loops | Milestone table is a contract; new ideas go to the deferred list with a working assumption |
| T4 | Spaghetti via event bus | Declared topics only; bus carries facts/intents, never return values; §2.4 table is authoritative |
| T5 | Frame spikes on first entry to a room | Geometry built once at load; materials pre-warmed; no lazy generation during play |
| T6 | Preview/proxy breakage (host + origin) | Server binds `0.0.0.0`, no origin allowlist, `no-store`, permissive CORS headers |

---

## 4. Performance budget

| Metric | Budget | Rationale |
| --- | --- | --- |
| Frame time | ≤ 16.6 ms | 60 fps target on integrated graphics |
| Physics step | ≤ 4 ms | ~250 static colliders, ≤ 40 dynamic bodies |
| Static shell draw calls | ≤ 12 | merged geometry per material |
| Total draw calls | ≤ 120 | includes props, doors, fixtures, signs |
| Triangles | ≤ 250k | primitives + merged boxes only |
| Real-time lights | 5 point + 1 spot (shadowed) | WebGL forward renderer limits |
| Generated textures | ≤ 8 × 512² | ~8 MB VRAM with mips |
| Dynamic bodies | ≤ 40 | pooled props |
| Memory | ≤ 250 MB | WASM module is 4.2 MB of that |

---

## 5. Controls (M1)

| Input | Action |
| --- | --- |
| Click | Capture mouse / interact with pause overlay |
| `W A S D` | Move |
| `Shift` | Sprint |
| `Ctrl` / `C` | Crouch |
| `Space` | Jump |
| Mouse | Look |
| `E` (press / hold) | Interact / pry door / flip breaker |
| `F` | Flashlight |
| `R` | Reset player to spawn (stuck escape hatch) |
| `−` / `=` | Lower / raise tone-mapping exposure (lighting safety valve) |
| `Esc` | Release mouse |
| `F3` | Toggle debug stats |

---

## 6. Verification protocol

1. `npm run verify` — parse every module (`node --check` semantics), resolve every relative import, confirm every bare specifier in `src/` exists in the `index.html` import map, and enforce the layering rules (`render/` may not import `world/`, `core/` may not import anything above it).
2. `npm run test:logic` — blueprint/grid invariants: no overlapping rooms, every door connected to its declared rooms, no wall run blocking a door opening, lights/consoles/props inside rooms, spawn inside a room; plus surface buffer ranges, determinism, and a PNG contact sheet for eyeballing art.
3. `npm run test:smoke` — **the one that matters.** jsdom provides a realistic `window`/`document`, Canvas2D is stubbed, and then the *real* ship, props, doors, power, player and Rapier world are built and simulated: the player settles on the deck, walks, opens a powered door by proximity, walks through the doorway into MedBay, is stopped by the same door when unpowered, forces it by prying, and the breaker restores servo power. The HUD is instantiated against the real `index.html` markup so a mismatched element id fails the build.
4. Live preview — `window.onerror` / `unhandledrejection` and a 20 s boot watchdog are trapped at the top of `index.html` and rendered as a visible red fault panel, so a silent black screen is impossible.

### Why jsdom, and a trap worth remembering
Rapier's WASM build inspects the JS environment during `init()`. A *partial* `window` stub
(what I first wrote by hand) makes `world.step()` panic with a bare `unreachable`, while a
realistic jsdom window works perfectly. That cost an hour to bisect; the lesson is recorded
here so nobody re-stubs the DOM by hand: **use jsdom for headless runs, never a hand-rolled
half-environment.**

---

## 7. Milestone checklist & current state

### Milestone 1 — Foundation (ship, player, power, interaction)
- [x] `PROJECT_BRAIN.md` with architecture, contracts, SWOT, mitigations
- [x] `PROJECT_QA.md` design Q&A
- [x] Zero-build runtime: import map, vendored Three.js + Rapier, static dev server
- [x] Procedural Canvas2D PBR surfaces (albedo, roughness, normal from height) with deterministic seeds
- [x] Web Audio procedural synth (ambience bed, footsteps, doors, breakers, UI)
- [x] Blueprint → occupancy grid → merged wall/floor/ceiling geometry + colliders
- [x] Doors with power gating, auto-slide, and manual pry
- [x] Breaker circuits cutting lights and door power per room group
- [x] First-person controller: Rapier kinematic capsule, sprint/crouch/jump, headbob, flashlight
- [x] Interaction raycast with hover prompts and hold-to-use
- [x] HUD (prompt, room, circuits, battery, fps), loading + pause overlays, error trap

### Milestone 2 — Combat & props (next)
- [ ] Prop pickup / throw with hand transform
- [ ] Melee sweep impulses and knockdown
- [ ] Manual firearm states, muzzle-vector projectiles, recoil/sway
- [ ] Impact audio + hit reactions

### Milestone 3 — AI
- [ ] Modular NPC rigs and outfit/badge generator
- [ ] Vision frustum + occlusion + darkness gating; hearing with wall attenuation
- [ ] Semantic memory store with certainty decay
- [ ] Behavior tree + blueprint nav graph + stuck watchdog
- [ ] Dual-tier Director with tension gauge and patrol reweighting

### Milestone 4 — Society
- [ ] Agendas, blood debts, forged IDs
- [ ] Quick-chat synthesizer with verb classes and lie filter
- [ ] Emergency meeting UI: accusations, evidence, interrogation, vote
- [ ] Jump clock, win/loss resolution, post-run report

### M1 verification log (recorded)
```
npm run verify      -> 27 modules, all checks passed
npm run test:logic  -> 20 passed, 0 failed
npm run test:smoke  -> 22 passed, 0 failed
```
Measured constants from the real generated ship:

| Metric | Value |
| --- | --- |
| Grid cells | 116 |
| Wall runs after greedy merge | 32 |
| Lintels / doors | 6 / 6 |
| Static colliders | 59 |
| Merged static-shell draw groups | 9 |
| Dynamic rigid bodies | 8 |
| Surface generation (all 6) | ~230–390 ms |
| Whole ship build (materials + geometry + colliders) | < 1.5 s |

Not verifiable here: lighting balance, texture look in motion, audio timbre. Those are tuned
through the live preview; `−` / `=` change exposure at runtime.

### Current known issues
See §9.

---

## 8. Decision log

| # | Date | Decision | Rationale |
| --- | --- | --- | --- |
| D1 | Kickoff | Rapier3D over Cannon-es | Character controller, CCD, determinism |
| D2 | Kickoff | Single-player vs 7 AI crew before any netcode | Prove the loop; bus is the seam |
| D3 | Kickoff | 6 compartments + airlock, one deck | Deduction density over area |
| D4 | Kickoff | Plain ESM + import map + vendored deps | No build step, no CDN, preview-safe |
| D5 | M1 | Grid blueprint authored in cells, built in metres | Door alignment becomes arithmetic, not guesswork |
| D6 | M1 | Walls merged per line + material with world-aligned UVs | Draw calls and texture stretching solved together |
| D7 | M1 | Emissive fixtures + pooled point lights | Keeps light count inside WebGL forward limits |
| D8 | M1 | Fixed 3.2 m ceiling, 2.1 m doors | Vents, lockers, and NPC capsules sized from these |
| D9 | M1 | Outer hull hatch is welded scenery, not a door | A sliding hatch would animate its panels outside the hull silhouette; venting is an M4 system, so the bulkhead stays solid |
| D10 | M1 | jsdom (not a hand-rolled DOM stub) for headless runs | A partial `window` makes Rapier's WASM panic in `step()`; see §6 |
| D11 | M1 | One ORM texture drives both roughness and metalness | three samples `.g` and `.b` respectively — halves texture memory |
| D12 | M1 | Door power reads the discrete `live` flag, not the flicker level | Otherwise a tripping breaker toggles every door dozens of times per second |

---

## 9. Known bugs / watchlist

| # | Item | Status |
| --- | --- | --- |
| K1 | No GPU in the build environment, so the render itself is verified only by the live preview | Accepted; mitigated by verify + logic + jsdom smoke tests and a visible fault panel |
| K2 | Shadow map only on the flashlight — point lights do not cast | Accepted for M1 (perf) |
| K3 | Crouch lowers the eye but not the capsule | Accepted for M1; revisit if vents become enterable in M3 |
| K4 | Fixtures and consoles are individual meshes (~90 draw calls) rather than merged | Accepted; well inside budget, will instance if M3 NPCs push the count |
| K5 | Doors can slide a panel into a player standing in the pocket | Cosmetic; the character controller pushes the player out on the next solve |
| K6 | Console "use" is flavour text only | By design — tasks arrive with the agenda system in M4 |

---

## 10. Next actions
1. **Milestone 2**: prop pickup from the hover transform, throw with inertia, melee sweep
   impulses, knockdown, manual firearm states, and barrel-vector projectiles with CCD.
2. Tune movement feel against the playtest numbers in `config.js` (walk/sprint acceleration,
   headbob amplitude, door trigger radius).
3. Export a nav graph from `world/grid.js` (room centres + door nodes) so Milestone 3's NPCs
   path on the same source of truth as the geometry.
4. Replace remaining per-fixture meshes with instancing once NPC props raise the draw count.
