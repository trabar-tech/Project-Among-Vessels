# Project Among Vessels

A first-person **social-deduction & emergent survival sandbox** aboard the *ISV Kestrel-90* —
a broke megacorp freighter where eight souls are aboard and seven are registered.

No one is a hero. Every crewmate, including you, has a private reason to lie. Evidence is
physical: a pried door, a dead breaker, a dropped tool, a badge that opened the wrong hatch.

**Status: Milestone 1 complete** — the ship is walkable, powered, and interactive.
Combat (M2), NPCs with senses and memory (M3), and agendas/meetings (M4) are next.

---

## Run it

```bash
npm run dev        # serves on 0.0.0.0:5173 — open the printed URL
```

`npm install` is **not** required to play. Three.js and Rapier are committed under `vendor/`,
so the page has no CDN dependency and there is no build step.

You do need a local server: browsers refuse to load ES modules and WASM over `file://`.
`tools/dev-server.mjs` is a ~70-line, zero-dependency replacement for a bundler.

```bash
npm install        # only for the dev tooling below
npm run verify     # syntax, import graph, import map, layering rules
npm run test:logic # blueprint/grid/surface unit checks
npm run test:smoke # headless integration: real Rapier steps, real ship, HUD
npm run map:report # ASCII deck plan + room/door/decor tables; exits 1 on a bad layout
npm run check      # all four gates in sequence (verify, logic, smoke, map)
npm run vendor     # re-copy pinned deps into /vendor after a version bump
```

---

## Controls

| Input | Action |
| --- | --- |
| `W A S D` | Move |
| `Shift` | Sprint |
| `Ctrl` / `C` | Crouch |
| `Space` | Jump |
| `E` | Interact · **hold** to pry an unpowered door |
| `F` | Flashlight (drains battery) |
| `R` | Reset to spawn (stuck escape hatch) |
| `−` / `=` | Lower / raise exposure |
| `F3` | Diagnostics (fps, draw calls, triangles, bodies) |
| `Esc` | Release mouse |

---

## What is in Milestone 1

- **Procedural ship** from a cell blueprint: 7 compartments, 6 doors, 116 grid cells merged
  into **32 wall runs / 9 draw groups**, with world-projected UVs so nothing stretches.
- **Derived bulkhead dressing**: a pure planner walks every wall run, works out which side the
  room is on, and samples two lanes — vents and conduit up at 2.0–2.5 m, junction boxes and
  placards at hand height. Candidates are rejected if they would hit a doorway, a sign, a
  console, a prop or each other, so **50 fittings across all 7 rooms in 3 merged draw calls**
  can never float in a doorway. `decorplan.js` is renderer-free and unit-tested.
- **Procedural PBR art**: albedo + roughness + metalness (ORM-packed) + normal maps generated
  from height fields in Canvas2D, in ~230 ms total, seeded and deterministic.
- **Real image-based lighting**: a procedural gradient (warm lamp pools, cold work light, deck
  bounce) is prefiltered with `PMREMGenerator` and fed to `scene.environment`, and the
  bulkheads are painted steel (metalness ≈0.22, bare metal only at scratches and rivets)
  instead of a mirror with nothing to reflect. That is why the default exposure is 1.2.
- **Power system**: four circuits (fore lights, habitat, industrial, door servos) on a breaker
  panel. Trip one and the lights in that group flicker out and the doors stop answering.
- **Physical doors**: kinematic sliding panels, auto-open on approach, and manual prying when
  the servo bus is dead. A closed door is a real wall to the character controller.
- **First-person body**: Rapier kinematic capsule with autostep, snap-to-ground, headbob,
  landing dip, sprint/crouch pacing, and a flashlight with a real shadow map.
- **Diegetic interaction**: centre-screen raycast, wireframe focus, hover prompts, hold-to-use,
  consoles that read out corporate telemetry instead of a quest log.
- **Procedural audio**: Web Audio engine hum, air handling, footsteps per deck surface, door
  servos, breaker clacks and UI tones. No audio files.
- **HUD**: room tag, circuit board state, lamp battery, hold-progress bar, transient toasts,
  visible error panel (no silent black screens).

---

## Layout of the ship

```
                 ┌──────────────┐
                 │    BRIDGE    │
                 └──────┬───────┘
                        │
   MEDBAY ──────────────┤
                        │  CORRIDOR        ┌──────────────┐
                        ├──────────────────│   REACTOR    │
   CARGO ───────────────┤                  └──────────────┘
                        │  (breaker panel lives here)
                        ├──────────────────┌──────────────┐
                        │                  │   QUARTERS   │
                 ┌──────┴───────┐          └──────────────┘
                 │   AIRLOCK    │   (outer hatch welded shut, M4)
                 └──────────────┘
```

---

## Code map

```
src/core/     config, bus (declared topics), fixed-step loop, input, seeded RNG
src/render/   pure pixel generators -> CanvasTextures -> materials & decals
src/audio/    procedural Web Audio synth
src/world/    blueprint -> grid -> merged geometry; doors, power, props, decor, interaction
src/player/   kinematic capsule controller, look, bob, flashlight
src/ui/       DOM HUD
src/main.js   composition root (wiring only)
tools/        dev server, vendor sync, verifier, unit tests, smoke test, map report, texture preview
```

Architecture rationale, event contracts, SWOT and live milestone state live in
[`PROJECT_BRAIN.md`](./PROJECT_BRAIN.md). Design Q&A and scope decisions live in
[`PROJECT_QA.md`](./PROJECT_QA.md).

---

## Notes on honesty in verification

There is no GPU in the build environment, so this repo cannot *see* its own render. What is
verified automatically (31 modules, 35 logic checks, 24 integration checks): the module graph
resolves, the ship generates, every compartment is reachable by BFS over the door graph, every
doorway clears the player capsule, no decorative fitting sits in a doorway or clips furniture,
decoration is deterministic per seed, Rapier really steps, the character controller really walks
through doorways, breakers really kill doors, crates really settle, and the HUD binds every
element in the real `index.html`.

What is **not** automatically verified: lighting balance, texture appearance in motion, and
Web Audio timbre. Those are tuned by eye and ear through the live preview. If the scene reads
too dark or too hot, `−` / `=` adjust exposure at runtime, and `__GAME.lighting(1.4)` scales
the environment, fill lights, fixtures and flashlight together from the console.

The first screenshot that prompted this pass was taken at **2.35 exposure** to make the ship
readable. That number is a symptom, not a setting: it is not the default, and it should not be.
