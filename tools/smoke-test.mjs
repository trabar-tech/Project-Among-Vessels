/**
 * tools/smoke-test.mjs
 * Headless integration test. Uses jsdom for a realistic `window`/`document`
 * (Rapier's WASM build inspects the environment at init, so a partial stub is
 * not good enough), stubs only Canvas2D, then builds the real ship, props,
 * doors, power, player and physics world and simulates it.
 *
 * This is the closest thing to "it runs in a browser" available without a GPU:
 * Rapier really steps, the character controller really solves, geometry really
 * merges. Rendering and Web Audio are the only untested layers.
 *
 *   node tools/smoke-test.mjs      (dev dependency: jsdom)
 */
import { JSDOM } from 'jsdom';

/* ------------------------------------------------------- realistic DOM -- */

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;

function make2DContext(canvas) {
  const fn = () => {};
  const ctx = {
    canvas,
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: fn,
    measureText: () => ({ width: 12 }),
    createLinearGradient: () => ({ addColorStop: fn }),
    createRadialGradient: () => ({ addColorStop: fn }),
  };
  return new Proxy(ctx, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return fn;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
}

const realCreateElement = document.createElement.bind(document);
document.createElement = (tag) => {
  const el = realCreateElement(tag);
  if (tag === 'canvas') {
    const ctx = make2DContext(el);
    el.getContext = () => ctx;
    el.toDataURL = () => 'data:,';
  }
  return el;
};

/* --------------------------------------------------------------- imports -- */

const THREE = await import('three');
const { default: RAPIER } = await import('@dimforge/rapier3d-compat');

const { SHIP } = await import('../src/world/blueprint.js');
const { createSurfaceTextures } = await import('../src/render/textures.js');
const { createMaterials } = await import('../src/render/materials.js');
const { buildShip, LightPool } = await import('../src/world/builder.js');
const decorPlanner = await import('../src/world/decorplan.js');
const { buildDecor } = await import('../src/world/decor.js');
const { buildProps } = await import('../src/world/props.js');
const { Doors } = await import('../src/world/doors.js');
const { PowerSystem } = await import('../src/world/power.js');
const { Player } = await import('../src/player/controller.js');
const { Bus } = await import('../src/core/bus.js');

/* ---------------------------------------------------------------- utils -- */

let pass = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push(`${name}: ${err.message}`);
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function makeInput(keys = new Set()) {
  return {
    keys,
    pressed: new Set(),
    isDown(code) {
      return this.keys.has(code);
    },
    justPressed(code) {
      return this.pressed.has(code);
    },
    press(code) {
      this.pressed.add(code);
    },
    consumeMouse() {
      return { dx: 0, dy: 0 };
    },
    endFrame() {
      this.pressed.clear();
    },
  };
}

const STEP = 1 / 60;

/* ----------------------------------------------------------------- boot -- */

console.log('\nboot');
const t0 = Date.now();
await RAPIER.init();
const surfaces = await createSurfaceTextures({});
const mats = createMaterials(surfaces);
console.log(`  textures + materials in ${Date.now() - t0} ms`);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(76, 1280 / 720, 0.05, 90);
scene.add(camera);

const world = new RAPIER.World({ x: 0, y: -20, z: 0 });
world.timestep = STEP;

const bus = new Bus();
const audioCues = [];
bus.on('audio:cue', (e) => audioCues.push(e));

const ship = buildShip({ scene, world, RAPIER, mats, ship: SHIP });
const props = buildProps({ scene, world, RAPIER, mats, ship: SHIP, shipBody: ship.staticBody });
const power = new PowerSystem({ scene, mats, ship: SHIP, bus });
const doors = new Doors({ scene, world, RAPIER, mats, ship: SHIP, bus });
const player = new Player({
  world,
  RAPIER,
  camera,
  scene,
  spawn: SHIP.spawn,
  spawnYaw: SHIP.spawnYaw,
  roomAt: ship.roomAt,
  bus,
});
const roomById = new Map(SHIP.rooms.map((r) => [r.id, r]));
player.surfaceOf = (id) => roomById.get(id)?.floor ?? 'deck';
const lightPool = new LightPool({ scene, fixtures: ship.fixtures });

console.log(
  `  ship: ${ship.stats.cells} cells, ${ship.stats.wallRuns} wall runs, ${ship.stats.colliders} colliders, ${ship.stats.drawGroups} merged draw groups`,
  `  decor: ${ship.stats.decorPlan.total} items (${Object.entries(ship.stats.decorPlan.byType).map(([k, v]) => `${k} ${v}`).join(', ')}), ${ship.stats.decor.drawCalls} draw calls, ${ship.stats.decorPlan.rejected} rejected`
);
console.log(`  props: ${props.dynamic.length} dynamic entries`);

/* ------------------------------------------------------------- geometry -- */

console.log('\ngeometry & world');
check('static shell is merged, not per-cell', () => {
  const mergedNames = ship.root.children
    .filter((c) => c.isMesh && /^(walls_|floor_|ceiling$|lintels$|pipes$|ribs$)/.test(c.name))
    .map((c) => c.name);
  assert(mergedNames.length <= 12, `expected <=12 merged shell meshes, got ${mergedNames.length}: ${mergedNames}`);
  assert(mergedNames.includes('walls_hull'), `walls_hull missing (${mergedNames.join(',')})`);
  assert(ship.stats.wallRuns <= 40, `wall runs ${ship.stats.wallRuns}`);
});

check('wall decoration is generated, merged, and clear of doorways', () => {
  assert(ship.decorPlan, 'builder did not produce a decor plan');
  assert(ship.decorPlan.stats.total >= 35, `only ${ship.decorPlan.stats.total} decor items`);
  assert(ship.decorPlan.stats.byType.vent >= 6, `only ${ship.decorPlan.stats.byType.vent} vents`);
  const decorGroup = ship.root.getObjectByName('decor');
  assert(decorGroup, 'decor group missing from the scene graph');
  const decorMeshes = decorGroup.children.filter((c) => c.isMesh && /^decor_/.test(c.name));
  assert(decorMeshes.length === 3, `expected 3 merged decor meshes, got ${decorMeshes.length}`);
  for (const mesh of decorMeshes) {
    assert(mesh.geometry.attributes.position.count > 40, `${mesh.name} looks empty`);
  }
  // The original bug: a vent floating in the reactor doorway.
  const { doorBandHit } = decorPlanner;
  for (const item of ship.decorPlan.items) {
    const hit = doorBandHit(SHIP, item.x, item.z, 0.2);
    assert(!hit, `${item.type} at (${item.x},${item.z}) sits in ${hit}`);
  }
});

check('decor hugs the wall instead of sticking into the room', () => {
  // Local +Z is the wall normal, so every decor type must stay shallow on Z and
  // may only be long on X (the wall tangent). This pins the conduit bug: the
  // first cut rotated the pipe about X and speared 1.5 m into the corridor.
  const cases = [
    { type: 'conduit', w: 0.07, h: 0.07, d: 1.5, minX: 1.2, maxZ: 0.3 },
    { type: 'vent', w: 0.86, h: 0.58, d: 0.09, minX: 0.7, maxZ: 0.2 },
    { type: 'junction', w: 0.34, h: 0.46, d: 0.11, minX: 0.2, maxZ: 0.2 },
    { type: 'placard', w: 0.46, h: 0.32, d: 0.03, minX: 0.4, maxZ: 0.1 },
  ];

  for (const c of cases) {
    const built = buildDecor({
      mats,
      plan: { items: [{ ...c, room: 'TEST', x: 0, y: 2, z: 0, yaw: 0 }] },
      name: `probe_${c.type}`,
    });
    assert(built.meshes.length > 0, `${c.type} produced no geometry`);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const mesh of built.meshes) {
      mesh.geometry.computeBoundingBox();
      const b = mesh.geometry.boundingBox;
      minX = Math.min(minX, b.min.x);
      maxX = Math.max(maxX, b.max.x);
      minZ = Math.min(minZ, b.min.z);
      maxZ = Math.max(maxZ, b.max.z);
    }
    const spanX = maxX - minX;
    const spanZ = maxZ - minZ;
    assert(spanX >= c.minX, `${c.type} only spans ${spanX.toFixed(2)}m along the wall`);
    assert(spanZ <= c.maxZ, `${c.type} protrudes ${spanZ.toFixed(2)}m out of the wall`);
  }
});

check('merged meshes have world-space UVs beyond 0..1', () => {
  const walls = ship.root.getObjectByName('walls_hull');
  assert(walls, 'walls_hull mesh missing');
  const uv = walls.geometry.attributes.uv;
  assert(uv, 'no uv attribute');
  let max = 0;
  for (let i = 0; i < uv.count; i++) max = Math.max(max, Math.abs(uv.getX(i)), Math.abs(uv.getY(i)));
  assert(max > 1.5, `UV range looks unprojected (max ${max.toFixed(2)})`);
});

check('every room has a floor collider (player does not fall through)', () => {
  // 2 per room: floor + ceiling, plus walls and lintels
  assert(ship.stats.colliders > SHIP.rooms.length * 2, 'too few colliders');
});

check('fixture list matches blueprint', () => {
  assert(ship.fixtures.length === SHIP.lights.length, 'fixture count mismatch');
  for (const f of ship.fixtures) {
    assert(f.position.y > 2 && f.position.y < 3.2, `fixture ${f.id} at odd height ${f.position.y}`);
  }
});

check('console groups are mounted', () => {
  assert(ship.consoles.length === SHIP.consoles.length, 'console count mismatch');
  for (const c of ship.consoles) assert(c.object.parent === ship.root, `${c.id} not attached`);
});

/* -------------------------------------------------------------- simulate -- */

function stepAll(dt, input) {
  power.fixedUpdate(dt);
  doors.fixedUpdate(dt, player.position, power);
  player.fixedUpdate(dt, input);
  world.step();
  for (const entry of props.dynamic) {
    if (entry.body && entry.mesh) {
      const t = entry.body.translation();
      entry.mesh.position.set(t.x, t.y, t.z);
    }
  }
  input.endFrame();
}

console.log('\nphysics & player');

// settle for half a second with no input
const idle = makeInput();
for (let i = 0; i < 30; i++) stepAll(STEP, idle);

check('player settles on the deck at spawn', () => {
  const p = player.position;
  assert(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z), `non-finite ${p.toArray()}`);
  assert(p.y > 0.6 && p.y < 1.1, `player y=${p.y.toFixed(2)} (expected capsule centre ~0.84)`);
  assert(player.grounded, 'player is not grounded');
});

check('room detection reports the corridor', () => {
  assert(player.roomId === 'CORRIDOR', `player room is ${player.roomId}`);
});

// walk forward (aft, +Z) for 1.5 s
const walk = makeInput(new Set(['KeyW']));
const startZ = player.position.z;
for (let i = 0; i < 90; i++) stepAll(STEP, walk);
const afterWalk = player.position;

check('walking moves the player forward without leaving the deck', () => {
  assert(afterWalk.z > startZ + 0.8, `moved from z=${startZ.toFixed(2)} to ${afterWalk.z.toFixed(2)}`);
  assert(afterWalk.y > 0.6 && afterWalk.y < 1.2, `y drifted to ${afterWalk.y.toFixed(2)}`);
  assert(Math.abs(afterWalk.x - 10) < 1.2, `x drifted to ${afterWalk.x.toFixed(2)}`);
});

check('footsteps were emitted', () => {
  const steps = bus.history.filter((h) => h.topic === 'player:footstep');
  assert(steps.length > 0, 'no player:footstep events');
  assert(steps[0].payload.surface === 'deck', `first surface is ${steps[0].payload.surface}`);
});

// The corridor door to MedBay is at x=8, z in [2,4]. Walk west through it.
player.respawn('test');
player.yaw = Math.PI / 2; // forward = -X
player.body.setTranslation({ x: 10, y: 0.92, z: 3 }, true);
for (let i = 0; i < 20; i++) stepAll(STEP, makeInput());

const doorMed = doors.byId.get('D_MEDBAY');
check('proximity opens a powered door', () => {
  assert(doorMed, 'D_MEDBAY missing');
  assert(doorMed.openness > 0.5, `door openness only ${doorMed.openness.toFixed(2)}`);
  assert(doorMed.powered, 'door should be powered by default');
});

const walkWest = makeInput(new Set(['KeyW']));
for (let i = 0; i < 120; i++) stepAll(STEP, walkWest);
const insideMedbay = player.position;

check('the player can walk through the open doorway into MedBay', () => {
  assert(insideMedbay.x < 7.5, `player x=${insideMedbay.x.toFixed(2)} did not pass the doorway`);
  assert(player.roomId === 'MEDBAY', `player room is ${player.roomId}`);
  assert(insideMedbay.y > 0.6, `player fell to y=${insideMedbay.y.toFixed(2)}`);
});

/* ---------------------------------------------------------------- power -- */

console.log('\npower & doors');

check('tripping the door circuit depowers the doors', () => {
  power.toggle('BRK_D');
  for (let i = 0; i < 60; i++) stepAll(STEP, makeInput());
  assert(!power.isLive('D'), 'circuit D still live');
  assert(power.level('D') < 0.1, `circuit D level ${power.level('D').toFixed(2)}`);
  assert(!doorMed.powered, 'door still reports powered');
});

check('unpowered doors close and stay shut', () => {
  for (let i = 0; i < 120; i++) stepAll(STEP, makeInput());
  assert(doorMed.openness < 0.05, `door openness ${doorMed.openness.toFixed(2)}`);
});

check('a shut, unpowered door is solid', () => {
  // put the player right in front of the closed door and push at it
  player.body.setTranslation({ x: 9.4, y: 0.92, z: 3 }, true);
  player.yaw = Math.PI / 2;
  for (let i = 0; i < 10; i++) stepAll(STEP, makeInput());
  const push = makeInput(new Set(['KeyW']));
  for (let i = 0; i < 90; i++) stepAll(STEP, push);
  assert(player.position.x > 8.05, `player walked through a shut door to x=${player.position.x.toFixed(2)}`);
});

check('prying forces the door open', () => {
  const spec = doorMed.interactable;
  assert(spec.hold() > 0, 'pry should be a hold action');
  spec.onHold(0.2, 1.5);
  for (let i = 0; i < 60; i++) stepAll(STEP, makeInput());
  assert(doorMed.openness > 0.8, `door openness after pry ${doorMed.openness.toFixed(2)}`);
});

check('restoring power brings the servos back', () => {
  power.toggle('BRK_D');
  for (let i = 0; i < 60; i++) stepAll(STEP, makeInput());
  assert(power.isLive('D'), 'circuit D did not come back');
  assert(doorMed.powered, 'door did not regain power');
});

check('door events reached the bus', () => {
  const states = bus.history.filter((h) => h.topic === 'door:state');
  assert(states.length > 0, 'no door:state events');
});

/* ---------------------------------------------------------------- props -- */

console.log('\nprops');

check('dynamic crates settled on the deck instead of tunnelling', () => {
  const bodies = props.dynamic.filter((d) => d.body && d.mesh);
  assert(bodies.length >= 5, `only ${bodies.length} dynamic props`);
  for (const entry of bodies) {
    const t = entry.body.translation();
    assert(t.y > -0.2 && t.y < 3.5, `prop at y=${t.y.toFixed(2)} (fell through or flew)`);
    assert(Number.isFinite(t.x) && Number.isFinite(t.z), 'non-finite prop position');
  }
});

/* ------------------------------------------------------------- lighting -- */

console.log('\nlighting pool');

check('light pool assigns at most N real lights near the player', () => {
  for (let i = 0; i < 40; i++) lightPool.update(STEP, player.position, power);
  const active = lightPool.lights.filter((l) => l.userData.fixture);
  assert(active.length <= lightPool.lights.length, 'too many assigned lights');
  assert(active.length > 0, 'no lights assigned to the pool');
});

check('dead circuits give the pool nothing to work with', () => {
  for (const c of ['A', 'B', 'C']) power.toggle(`BRK_${c}`);
  for (let i = 0; i < 60; i++) stepAll(STEP, makeInput());
  for (let i = 0; i < 20; i++) lightPool.update(STEP, player.position, power);
  const lit = lightPool.lights.filter((l) => l.userData.target > 0.5);
  assert(lit.length === 0, `${lit.length} lights still targetting power on a dead ship`);
});

/* ------------------------------------------------------------------ hud -- */

console.log('\nHUD (real index.html markup)');

const fs = await import('node:fs');
const path = await import('node:path');
const { fileURLToPath } = await import('node:url');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const markup = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const hudDom = new JSDOM(markup, { pretendToBeVisual: true });
globalThis.document = hudDom.window.document;

const { Hud } = await import('../src/ui/hud.js');
let hud;
check('HUD binds every element it needs', () => {
  hud = new Hud({ rooms: SHIP.rooms });
  for (const [key, el] of Object.entries(hud.el)) {
    assert(el, `missing element for "${key}"`);
  }
  assert(document.querySelectorAll('#circuits .circuit').length === 4, 'circuit rows');
});

check('HUD renders room, circuits, battery and prompts', () => {
  hud.setRoom('MEDBAY');
  assert(document.getElementById('roomname').textContent === 'MEDBAY', 'room name');

  hud.setCircuit('D', false);
  const rows = [...document.querySelectorAll('#circuits .circuit')];
  const dead = rows.filter((r) => r.classList.contains('dead'));
  assert(dead.length === 1, `expected 1 dead circuit, got ${dead.length}`);

  hud.setBattery(true, 42);
  assert(document.getElementById('battery-pct').textContent === '42%', 'battery percent');
  assert(document.getElementById('battery').classList.contains('on'), 'battery on class');

  hud.prompt({ id: 'door:D_MEDBAY', verb: 'Pry', label: 'Medbay door', hold: 1.4, progress: 0.5 });
  assert(!document.getElementById('prompt').classList.contains('hidden'), 'prompt hidden');
  assert(document.getElementById('prompt-label').textContent === 'Medbay door', 'prompt label');
  assert(
    document.querySelector('#prompt-bar > i').style.width === '50%',
    `progress bar width ${document.querySelector('#prompt-bar > i').style.width}`
  );

  hud.prompt(null);
  assert(document.getElementById('prompt').classList.contains('hidden'), 'prompt did not hide');

  hud.toast('Door servos offline', 'warn');
  const toast = document.getElementById('toast');
  assert(!toast.classList.contains('hidden') && toast.className === 'tone-warn', 'toast state');

  hud.setStats({ fps: 60, calls: 84, tris: 121000, bodies: 23, steps: 1 });
  assert(document.getElementById('stats').textContent.includes('60 fps'), 'stats text');
});

/* --------------------------------------------------------------- result -- */

const bodies = world.bodies?.len?.() ?? 'n/a';
console.log(`\nphysics bodies: ${bodies}`);
console.log(`audio cues raised: ${audioCues.length}`);
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log('smoke test OK');
