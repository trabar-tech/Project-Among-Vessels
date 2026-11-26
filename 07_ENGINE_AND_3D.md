# 07 — Engine and 3D

**Project Among Vessels** · Phase 3 deliverable · Status: **slice running, verified**
Requires: [02](02_AMONG_US_CORE.md), [03](03_HYBRID_MECHANICS.md), [06](06_IDENTITY_AND_PASSING.md)
Code: `engine/` · Parity gate: `tools/check_rules.py`

> The game is 3D. This document records the engine decision, the constraints it imposes, the
> rendering direction, and — importantly — exactly what has been **verified** versus what has only
> been **specified**.

---

## 1. The Engine Decision (and the constraint that decided it)

### 1.1 The requirement that outranks preference

This project's entire thesis ([00](00_SWOT_AND_STRATEGY.md), [01](01_DEV_TOOLS.md)) is: **do not ship
what you cannot verify.** A design that cannot be executed is prose. So the engine choice is not
"which engine is best in the abstract" — it is "which engine lets me *run and prove* the systems I am
writing, in this environment, today."

### 1.2 The candidates

| | **Godot 4 (GDScript/C#)** | **TypeScript + three.js + Vite** | **Unity** | **Bevy (Rust)** |
|---|---|---|---|---|
| Fit for a systems-heavy 3D game | Excellent | Good | Excellent | Good |
| Built-in physics/navmesh/audio | Yes | No (assemble) | Yes | Partial |
| Editor & artist pipeline | Good | None | Best | None |
| **Verifiable in this sandbox** | **No** | **Yes** | No | No |
| Deterministic headless runs | Good | Excellent (Node) | Awkward | Excellent |
| Web preview / instant sharing | Export step | Native | Heavy | WASM build |

**Measured fact:** Godot's release binaries could not be downloaded here (the CDN is outside the
sandbox's egress allowlist), so **zero lines of GDScript could be executed or type-checked**.
Meanwhile `tsc --noEmit`, `node --test`, and a live Vite server all run and pass.

### 1.3 Decision

> **Ship on TypeScript + three.js, with the rules core as engine-agnostic TypeScript that has no
> three.js import anywhere in it.**

**Why this is not a compromise but a structural win:**

1. **The rules core is portable.** `engine/src/sim/` imports nothing from three.js. Moving to Godot
   later means porting ~600 lines of pure logic — and `tools/check_rules.py` plus the Python
   reference implementation mean the port has a specification to port *against*.
2. **The renderer is a viewer, not the game.** Every rule is testable without a GPU. This is the same
   discipline that produced the Phase 1 tools.
3. **It runs in the browser**, which means the design can be *looked at* by anyone, immediately.

**The honest risk (stated, not buried):** three.js has no physics engine, no navmesh, no audio
middleware, no scene editor, and no asset pipeline. Those are all *Phase 4* problems, and each one is
a real cost. If the project later needs heavy skeletal animation, occlusion culling at scale, or
console export, Godot becomes the better home — and the portable core makes that migration a port,
not a rewrite.

**What would change my mind:** if the 3D slice grows past ~3,000 lines of rendering code, or if
animation authoring becomes the bottleneck, migrate. The tripwire is measured, not vibes.

---

## 2. What Actually Exists (and what has been verified)

### 2.1 Verified — executed in this environment

| Component | Verification |
|---|---|
| `engine/src/sim/rules.ts` | `tsc --noEmit` clean; constants diffed against JSON by `check_rules.py` |
| `engine/src/sim/vote.ts` | 3 unit tests (plurality, tie, skip) — Among Us math ported 1:1 |
| `engine/src/sim/state.ts` | 2 unit tests including "parity outranks sabotage outranks tasks" |
| `engine/src/sim/suspicion.ts` | 2 unit tests (evidence raises, trust lowers, distrusted speakers can't land accusations) |
| `engine/src/sim/match.ts` | Determinism test + contested-balance test + eject-accuracy test |
| `engine/src/sim/rules.test.ts` | **15 tests, all passing** |
| Map adjacency | Symmetry + connectivity + cut-vertex test (this test found a real defect, §4.2) |
| `engine/src/render/main.ts` | `tsc` clean, Vite build succeeds (498 kB), dev server serves and accepts the preview host |
| Balance | `npm run sim -- --runs 300 --seed 42` → crew win **0.313**, eject accuracy **0.794** |

### 2.2 Specified but NOT visually verified — read this before judging the screenshots

The sandbox has **no browser and no GPU**, so:

- **No frame of the 3D scene has been rendered by me.** The renderer type-checks and the bundle
  builds, but a `THREE.WebGLRenderer` cannot execute headlessly here.
- Therefore: **treat the 3D slice as unproven visually.** It is a first draft written against a
  specification, not a screenshot-validated scene.
- What that means practically: expect to adjust camera feel, lighting intensity, wall gaps, and the
  cone overlay the first time you look at it. Those are the numbers I could not tune without eyes.

This is stated loudly because silently shipping an unverified renderer would be exactly the failure
mode [00](00_SWOT_AND_STRATEGY.md) §W warns about ("verification theater").

### 2.3 The slice's scope

```
engine/
├── index.html              CRT frame, diegetic HUD, alarm colour reserved
├── vite.config.ts          allowedHosts for the sandbox preview proxy
├── src/sim/                RULES CORE — no three.js imports, fully tested
│   ├── rules.ts            constants + map adjacency (JSON-mirrored)
│   ├── vote.ts             Among Us voting math
│   ├── state.ts            phase machine + guards
│   ├── suspicion.ts        6-component belief + claim modulation
│   ├── match.ts            headless match sim (ported from the Python probe)
│   ├── cli.ts              npm run sim
│   └── rules.test.ts       15 tests
└── src/render/             VIEWER — one file, ~500 lines
    └── main.ts             scene, crew AI, cones, camera, HUD, meetings
```

Controls: **WASD** move · **Shift** sprint · **E** log a work order · **R** report · **Space**
emergency meeting · **L** (dev) toggle lights sabotage.

---

## 3. The 3D Presentation Contract

The aesthetic from [03](03_HYBRID_MECHANICS.md) §2 must survive translation into 3D. These are
binding, not aspirational:

### 3.1 Camera

| Property | Value | Why |
|---|---|---|
| Projection | Perspective, **62° FOV**, clamped by letterboxing | Wide lenses flatten dread; 62° keeps rooms reading as *rooms* |
| Pitch | **−52°** (high three-quarter) | You see the floor and not the horizon; the ceiling is implied, never shown |
| Follow | Lagged lerp (0.12), look-ahead 3.2 units in facing direction | The camera commits before the player does — a small, constant pressure |
| Height | 13 units for a 9-unit room | Rooms feel like *pits*, not stages |
| Never | No zoom-out, no free orbit, no tactical overview | [03](03_HYBRID_MECHANICS.md) §2.1: "the player should never have a tactical overview" |

### 3.2 Light and shadow

- One **point light per room**, 256px shadow map (cheap, soft, and *wrong* in a way that reads as
  industrial).
- **Ambient is almost nothing** (`0x1b2a2e`, 0.55) — fixtures do all the work.
- Fixtures **flicker** at a shared frequency with per-position phase offset.
- **Lights sabotage** drops hemisphere light to 0.08, pulls fog from `(26, 54)` to `(10, 24)`, and
  narrows the vision cone from 60° to 20°. The room does not just get darker; it gets *smaller*.

### 3.3 The vision cone as physical information

The cone is not a HUD overlay. It is a translucent additive sector lying on the floor, **one per
crewmate**, and it does mechanical work:

```
Cone geometry = CircleGeometry(1, 40, π/2 − halfAngle, halfAngle × 2)
Radius        = crewVision × (lightsOut ? 0.35 : 1.0)
Crewmate drawn ONLY IF inside the player's cone or within 2.2 units (proximity)
```

That last line is the entire Among Us information model, made physical: **you do not see what you
cannot see.** Unseen crewmates are not ghosted — they are *absent*. The peripheral proximity radius
is the "eyes in the back of the head" rule from [04](04_AI_ARCHITECTURE.md) §3.1, so you cannot stand
directly behind someone and be invisible.

### 3.4 Palette discipline

| Colour | Use |
|---|---|
| `#2a3335`, `#39474a`, `#212a2c` | Floors, walls, trim — everything structural |
| `#5d6c70` | Steel, crates, machinery |
| `#9fd6dc` | Visors, the player's own cone — the *only* cool light |
| `#c9a227` | Interaction prompts, work orders |
| **`#ff4a1f`** | **Reserved exclusively for: crisis overlay, sabotage, death, ejection.** Never decorative. |

If red is on screen, something is already wrong. That rule is worth more atmosphere than any shader.

### 3.5 Diegetic HUD

The HUD is a stamped-metal instrument panel, not an overlay: `VESSEL // KESTREL-9`, `PHASE`,
`TASKS 0/24`, `CREW 10`, and a single moodle word. A scrolling **telemetry console** prints ambient
machine noise ("impact rattle, Storage"), which serves two purposes: it carries atmosphere before
audio exists, and it foreshadows the noise-propagation system from [03](03_HYBRID_MECHANICS.md) §3.2
becoming *actually functional*.

---

## 4. Two Defects the Tools Caught (evidence the discipline works)

### 4.1 The renderer disagreed with the design about invisibility

First pass used `opacity = 0.32` for unseen crewmates — a common "ghost" treatment. That is a **rule
violation**: at 32% opacity the player can locate people they cannot see, which destroys the
information economy the entire game rests on. Fixed to `mesh.visible = false`.

*Caught by:* re-reading [03](03_HYBRID_MECHANICS.md) §2.1 against my own code, not by a test. Worth
logging because it is the class of error tests cannot catch.

### 4.2 The map made a crisis unwinnable

`rules.test.ts` asserts adjacency is symmetric and connected. It failed on first run: `O2 → Admin`
was one-way. Fixing symmetry exposed a worse problem — **O2 was a dead end**, and O2 hosts a
two-person crisis fix ([02](02_AMONG_US_CORE.md) §6.1). A single door lock would have made the
crisis unwinnable by geometry rather than by play.

The test now asserts a stronger property:

```ts
test('two-person crisis rooms have two independent routes', ...)
// Remove the room; its neighbours must still be mutually reachable.
```

O2 and Security each gained a second route; `Reactor` passes. **This is a defect that would have
shipped as "sometimes the O2 crisis is just impossible", and no amount of playtesting would have
found it reliably.**

---

## 5. What Is Deliberately Missing

| Missing | Why | Phase |
|---|---|---|
| Physics / collisions | Walls are visual; movement is planar and free | 4 |
| Pathfinding | Crew walk in straight lines to random room points | 4 |
| Audio | Zero sound; telemetry text stands in | 4 |
| Animation | Bodies rotate and translate; no rigs | 4 |
| Full GOAP in the client | Client uses simple wander; the planner lives in `tools/goap.py` | 4 |
| Real meetings | Client meetings are a stub with random speakers | 3 |
| Identity system in-client | Specified in [06](06_IDENTITY_AND_PASSING.md); not wired into the slice | 3 |
| Save/replay | Determinism exists in the core (`makeRng`), not surfaced | 4 |

The renderer is **~500 lines and one file** on purpose. It is a look-and-feel probe that can be
thrown away without losing a single rule.

---

## 6. The Parity Gate

Two implementations exist. They will drift. `tools/check_rules.py` is the anti-drift device:

```bash
$ python3 tools/check_rules.py
rules in sync: balance, phases, utterance types, map adjacency

$ sed -i 's/killCooldownSeconds: 27.5/killCooldownSeconds: 30/' engine/src/sim/rules.ts
$ python3 tools/check_rules.py
DRIFT: killCooldownSeconds: engine=30.0 json=27.5     # exit 1
```

It parses TypeScript as text (no Node dependency in the Python gate), checking:
balance constants, the `Phase` union vs `state_machine.json`, `UTTERANCE_TYPES` vs the grammar
(Phase-3 identity types are allowed to be absent from the client), and map adjacency symmetry.

**Rule:** the JSON is canonical. If the engine disagrees, the engine is wrong.

---

## 7. Verification Commands

```bash
# --- rules core (no GPU needed) ---
cd engine
npx tsc --noEmit                      # types
node --test --experimental-strip-types src/sim/rules.test.ts   # 15 design-property tests
npx tsx src/sim/cli.ts --runs 300 --seed 42                    # balance probe
npx vite build                        # production bundle

# --- cross-implementation parity ---
cd ..
python3 tools/check_rules.py

# --- run it ---
cd engine && npm run dev              # http://localhost:5173
```

Current results:

| Gate | Result |
|---|---|
| `tsc --noEmit` | clean |
| `rules.test.ts` | **15/15 pass** |
| `check_rules.py` | in sync (verified to fail on injected drift) |
| `tsx sim --runs 300` | crew win **0.313**, eject accuracy **0.794**, avg 167 s |
| `vite build` | 498 kB (128 kB gzip) |
| Visual render | **UNVERIFIED — no GPU/browser in the build environment** |

---

## 8. Roadmap to a Real Game

| Step | Work | Exit criterion |
|---|---|---|
| **3a** | Physics + collision, navmesh-free steering, diegetic task minigames | Player can walk a full loop without clipping |
| **3b** | Real meeting UI driven by `qc_parse.py`-format transcripts | Every line parses; player can accuse/defend |
| **3c** | Identity system in-client: manifest terminal, anomaly counter, ledger writes | `GAME_OVER_CREW_CLEAN_MANIFEST` reachable |
| **3d** | Port `tools/goap.py` to `engine/src/sim/goap.ts`; wire crew to it | `check_rules.py` gains a GOAP-catalog parity check |
| **4a** | Audio: positional footsteps, per-sabotage sirens, silence-on-body | You can locate a crewmate by ear |
| **4b** | Animation: 8–12 fps stepped rigs | Movement reads as weight, not sliding |
| **4c** | Content: 15 task types, 8 moodles, 5 sabotages | Caps from [03](03_HYBRID_MECHANICS.md) §7 respected |

**The tripwire:** if rendering code exceeds ~3,000 lines or animation authoring becomes the
bottleneck, migrate to Godot. `engine/src/sim/` is the portable asset, and its behaviour is already
pinned by tests and by the Python reference.
