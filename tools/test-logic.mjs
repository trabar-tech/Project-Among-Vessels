/**
 * tools/test-logic.mjs
 * Unit checks for the pure systems. No DOM, no THREE, no Rapier.
 *
 *   node tools/test-logic.mjs
 */
import { SHIP } from '../src/world/blueprint.js';
import { buildGrid } from '../src/world/grid.js';
import { planDecor, doorBandHit, DECOR_TYPES } from '../src/world/decorplan.js';
import { generateSurfaceData, SURFACE_SPECS } from '../src/render/surfacegen.js';
import { CONFIG } from '../src/core/config.js';

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

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const grid = buildGrid(SHIP);
const CELL = 2;

/* ------------------------------------------------------------- blueprint -- */

console.log('\nblueprint & grid');

check('room ids are unique', () => {
  const ids = SHIP.rooms.map((r) => r.id);
  assert(new Set(ids).size === ids.length, 'duplicate room id');
});

check('every rect is integer and non-empty', () => {
  for (const room of SHIP.rooms) {
    const [x, z, w, d] = room.rect;
    assert([x, z, w, d].every(Number.isInteger), `${room.id} rect must be integers`);
    assert(w > 0 && d > 0, `${room.id} rect must have positive size`);
  }
});

check('no rooms overlap', () => {
  // buildGrid throws on overlap; reaching here means it held
  assert(grid.occ.size > 0, 'grid is empty');
});

check('every door connects its declared rooms', () => {
  for (const door of SHIP.doors) {
    const isX = door.axis === 'x';
    for (let i = door.start; i < door.end; i++) {
      const a = isX ? grid.roomAtCell(door.line - 1, i) : grid.roomAtCell(i, door.line - 1);
      const b = isX ? grid.roomAtCell(door.line, i) : grid.roomAtCell(i, door.line);
      const pair = [a, b].filter(Boolean).sort().join('+');
      const expected = [door.a, door.b === 'VOID' ? null : door.b].filter(Boolean).sort().join('+');
      assert(pair === expected, `${door.id} at ${i} connects ${pair}, expected ${expected}`);
    }
  }
});

check('wall runs do not block any door opening', () => {
  for (const [edgeKey] of grid.doorEdges) {
    const [axis, lineStr, idxStr] = edgeKey.split(':');
    const line = Number(lineStr);
    const index = Number(idxStr);
    for (const run of grid.walls) {
      if (run.line !== line) continue;
      const orientation = axis === 'z' ? 'alongX' : 'alongZ';
      if (run.orientation !== orientation) continue;
      assert(
        index < run.start || index >= run.end,
        `wall run ${run.orientation}@${run.line} covers door edge ${edgeKey}`
      );
    }
  }
});

check('wall runs are greedily merged (fewer runs than cell edges)', () => {
  const cellEdges = grid.openings.length + grid.walls.reduce((sum, r) => sum + (r.end - r.start), 0);
  assert(grid.walls.length > 0, 'no walls generated');
  assert(
    grid.walls.length < cellEdges,
    `expected merging to reduce ${cellEdges} edges, got ${grid.walls.length} runs`
  );
  assert(grid.stats.wallRuns < 200, `wall run count ${grid.stats.wallRuns} looks unmerged`);
});

check('grid reports every room', () => {
  assert(grid.rooms.size === SHIP.rooms.length, 'room count mismatch');
  for (const room of SHIP.rooms) {
    const record = grid.rooms.get(room.id);
    assert(record && record.cells.length === room.rect[2] * room.rect[3], `${room.id} cell count`);
  }
});

check('spawn point is inside a room', () => {
  const [x, , z] = SHIP.spawn;
  const room = grid.roomAtCell(Math.floor(x / CELL), Math.floor(z / CELL));
  assert(room, `spawn (${x}, ${z}) is not inside any room`);
});

/* ------------------------------------------------------- world placement -- */

console.log('\nfixtures, consoles, props');

check('every light is inside its declared room and circuit', () => {
  for (const light of SHIP.lights) {
    const room = grid.roomAtCell(Math.floor(light.at[0] / CELL), Math.floor(light.at[1] / CELL));
    assert(room === light.room, `${light.id} sits in ${room}, declared ${light.room}`);
    assert(['A', 'B', 'C', 'D'].includes(light.circuit), `${light.id} bad circuit ${light.circuit}`);
  }
});

check('every console is inside its declared room', () => {
  for (const c of SHIP.consoles) {
    const room = grid.roomAtCell(Math.floor(c.at[0] / CELL), Math.floor(c.at[1] / CELL));
    assert(room === c.room, `${c.id} sits in ${room}, declared ${c.room}`);
  }
});

check('every prop is inside a room', () => {
  for (const p of SHIP.props) {
    const room = grid.roomAtCell(Math.floor(p.at[0] / CELL), Math.floor(p.at[1] / CELL));
    assert(room, `${p.kind} at ${p.at.join(',')} is outside the ship`);
  }
});

check('breaker circuits cover every circuit id', () => {
  const covered = new Set(SHIP.breakers.map((b) => b.circuit));
  for (const c of ['A', 'B', 'C', 'D']) assert(covered.has(c), `no breaker for circuit ${c}`);
});

check('room floor materials exist', () => {
  for (const room of SHIP.rooms) {
    assert(SURFACE_SPECS[room.floor], `${room.id} floor "${room.floor}" has no surface spec`);
    assert(SURFACE_SPECS[room.wall], `${room.id} wall "${room.wall}" has no surface spec`);
  }
});

/* -------------------------------------------------------------- surfaces -- */

console.log('\nprocedural surfaces');

for (const name of Object.keys(SURFACE_SPECS)) {
  check(`${name}: buffers, ranges, normals`, () => {
    const data = generateSurfaceData(name, { size: 64 }); // small for test speed
    const n = data.size * data.size * 4;
    assert(data.albedo.length === n, 'albedo buffer size');
    assert(data.orm.length === n, 'orm buffer size');
    assert(data.normal.length === n, 'normal buffer size');

    let albedoSum = 0;
    for (let i = 0; i < n; i += 4) {
      assert(data.orm[i + 3] === 255, 'orm alpha must be opaque');
      assert(data.normal[i + 3] === 255, 'normal alpha must be opaque');
      // normals must point out of the surface (positive Z in tangent space)
      assert(data.normal[i + 2] > 127, 'normal Z must be positive');
      albedoSum += data.albedo[i];
    }
    const mean = albedoSum / (n / 4);
    assert(mean > 3 && mean < 250, `albedo mean ${mean.toFixed(1)} looks blank`);
  });
}

check('surface generation is deterministic', () => {
  const a = generateSurfaceData('hull', { size: 32 });
  const b = generateSurfaceData('hull', { size: 32 });
  for (let i = 0; i < a.albedo.length; i += 997) {
    assert(a.albedo[i] === b.albedo[i], `albedo differs at byte ${i}`);
  }
});

/* -------------------------------------------------- reachability & clears -- */

console.log('\nlayout validation');

const spawnRoom = grid.roomAtCell(Math.floor(SHIP.spawn[0] / CELL), Math.floor(SHIP.spawn[2] / CELL));

check('every compartment is reachable from the spawn point through doors', () => {
  const graph = new Map(SHIP.rooms.map((r) => [r.id, new Set()]));
  for (const door of SHIP.doors) {
    if (door.b === 'VOID') continue;
    graph.get(door.a)?.add(door.b);
    graph.get(door.b)?.add(door.a);
  }
  const seen = new Set([spawnRoom]);
  const queue = [spawnRoom];
  while (queue.length) {
    const current = queue.shift();
    for (const next of graph.get(current) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  const missing = SHIP.rooms.map((r) => r.id).filter((id) => !seen.has(id));
  assert(missing.length === 0, `unreachable: ${missing.join(', ')} (from ${spawnRoom})`);
});

const PLAYER_HEIGHT = CONFIG.PLAYER_HALF_HEIGHT * 2 + CONFIG.PLAYER_RADIUS * 2;
const PLAYER_WIDTH = CONFIG.PLAYER_RADIUS * 2;

check('every doorway is wide and tall enough to walk through', () => {
  for (const door of SHIP.doors) {
    const width = (door.end - door.start) * CELL;
    assert(width >= PLAYER_WIDTH + 0.8, `${door.id} only ${width.toFixed(1)}m wide`);
    assert(CONFIG.DOOR_HEIGHT >= PLAYER_HEIGHT + 0.25, `${door.id} headroom too low`);
  }
});

check('ceiling and wall height leave room for the camera', () => {
  assert(CONFIG.WALL_HEIGHT > CONFIG.EYE_HEIGHT + 0.5, 'eye is too close to the ceiling');
  assert(CONFIG.WALL_HEIGHT > CONFIG.DOOR_HEIGHT + 0.5, 'lintel would be too thin');
});

check('every room has at least one light on a real circuit', () => {
  for (const room of SHIP.rooms) {
    const lights = SHIP.lights.filter((l) => l.room === room.id);
    assert(lights.length > 0, `${room.id} has no fixtures`);
    for (const light of lights) assert(light.circuit === room.circuit || light.circuit === 'A', `${light.id} circuit mismatch`);
  }
});

/* --------------------------------------------------------------- decor ---- */

console.log('\ndecoration planner');

const decorPlan = planDecor({ ship: SHIP, grid });

check('decor is derived and plentiful', () => {
  assert(decorPlan.items.length >= 35, `only ${decorPlan.items.length} decor items`);
  assert(decorPlan.items.length <= 160, `${decorPlan.items.length} decor items is too dense`);
  for (const type of ['vent', 'junction', 'conduit']) {
    assert((decorPlan.stats.byType[type] ?? 0) >= 3, `only ${decorPlan.stats.byType[type] ?? 0} ${type}s`);
  }
});

check('no decor item sits inside a door opening', () => {
  for (const item of decorPlan.items) {
    const door = doorBandHit(SHIP, item.x, item.z, 0.2);
    assert(!door, `${item.type} in ${item.room} at (${item.x}, ${item.z}) blocks ${door}`);
  }
});

check('every decor item is inside the room it claims', () => {
  for (const item of decorPlan.items) {
    const room = grid.roomAtCell(Math.floor(item.x / CELL), Math.floor(item.z / CELL));
    assert(room === item.room, `${item.type} claims ${item.room} but sits in ${room}`);
  }
});

check('every room is decorated', () => {
  for (const room of SHIP.rooms) {
    const count = decorPlan.items.filter((i) => i.room === room.id).length;
    assert(count > 0, `${room.id} has no decoration`);
  }
});

check('decor keeps clear of consoles, props and the breaker panel', () => {
  const obstacles = [];
  for (const c of SHIP.consoles) obstacles.push({ x: c.at[0], z: c.at[1], r: 0.9, what: c.id });
  for (const p of SHIP.props) obstacles.push({ x: p.at[0], z: p.at[1], r: 0.75, what: p.kind });
  obstacles.push({ x: SHIP.breakerPanel.at[0], z: SHIP.breakerPanel.at[1], r: 0.9, what: 'breakers' });
  for (const h of SHIP.hatches ?? []) obstacles.push({ x: h.at[0], z: h.at[1], r: 1.7, what: h.id });

  for (const item of decorPlan.items) {
    for (const o of obstacles) {
      const d = Math.hypot(item.x - o.x, item.z - o.z);
      assert(d > 0.55, `${item.type} at (${item.x},${item.z}) is ${d.toFixed(2)}m from ${o.what}`);
    }
  }
});

check('decor respects its two height lanes', () => {
  for (const item of decorPlan.items) {
    const expected = DECOR_TYPES[item.type].y;
    assert(Math.abs(item.y - expected) < 0.001, `${item.type} at ${item.y}, expected ${expected}`);
    const high = item.y > 1.9;
    assert(item.lane === (high ? 'high' : 'low'), `${item.type} lane/height mismatch`);
  }
});

check('decor planning is deterministic', () => {
  const again = planDecor({ ship: SHIP, grid });
  assert(again.items.length === decorPlan.items.length, 'item count differs between runs');
  for (let i = 0; i < again.items.length; i++) {
    const a = again.items[i];
    const b = decorPlan.items[i];
    assert(a.type === b.type && a.x === b.x && a.z === b.z, `item ${i} differs`);
  }
});

/* ---------------------------------------------------------- set dressing -- */

console.log('\nprop placement');

const PROP_RADIUS = { crate: 0.46, toolcrate: 0.36, barrel: 0.33, bed: 0.95, bunk: 1.0, locker: 0.33, chair: 0.3, core: 1.5, pallet: 0.7, extinguisher: 0.12, hatch: 2.0 };

check('props do not intersect each other', () => {
  for (let i = 0; i < SHIP.props.length; i++) {
    const a = SHIP.props[i];
    const ra = PROP_RADIUS[a.kind] ?? 0.5;
    for (let j = i + 1; j < SHIP.props.length; j++) {
      const b = SHIP.props[j];
      const rb = PROP_RADIUS[b.kind] ?? 0.5;
      const d = Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]);
      assert(d > (ra + rb) * 0.8, `${a.kind}@${a.at} overlaps ${b.kind}@${b.at} (${d.toFixed(2)}m)`);
    }
  }
});

check('props sit inside their room, clear of the walls', () => {
  for (const prop of SHIP.props) {
    if (prop.kind === 'extinguisher') continue; // wall-mounted
    const room = SHIP.rooms.find((r) => {
      const [x0, z0, w, d] = r.rect;
      return prop.at[0] > x0 * CELL && prop.at[0] < (x0 + w) * CELL && prop.at[1] > z0 * CELL && prop.at[1] < (z0 + d) * CELL;
    });
    assert(room, `${prop.kind} at ${prop.at} is outside every room`);
    const [x0, z0, w, d] = room.rect;
    const margin = 0.25;
    assert(prop.at[0] - x0 * CELL > margin, `${prop.kind} clips the west wall`);
    assert((x0 + w) * CELL - prop.at[0] > margin, `${prop.kind} clips the east wall`);
    assert(prop.at[1] - z0 * CELL > margin, `${prop.kind} clips the north wall`);
    assert((z0 + d) * CELL - prop.at[1] > margin, `${prop.kind} clips the south wall`);
  }
});

/* --------------------------------------------------------------- budget --- */

console.log('\nbudgets');

check('geometry and decoration stay inside the performance budget', () => {
  assert(grid.stats.wallRuns <= 40, `wall runs ${grid.stats.wallRuns}`);
  const colliderEstimate = SHIP.rooms.length * 2 + grid.stats.wallRuns + grid.stats.lintels + SHIP.consoles.length;
  assert(colliderEstimate <= 120, `collider estimate ${colliderEstimate}`);
  assert(decorPlan.items.length <= 160, `decor ${decorPlan.items.length}`);
  assert(SHIP.lights.length <= 20, `fixtures ${SHIP.lights.length}`);
});

check('renderer-facing numbers are sane', () => {
  assert(CONFIG.EXPOSURE > 0.8 && CONFIG.EXPOSURE < 2.0, `exposure ${CONFIG.EXPOSURE}`);
  assert(CONFIG.FLASHLIGHT_INTENSITY > 5, 'flashlight would be invisible');
  assert(CONFIG.LIGHTS_IN_POOL >= 3 && CONFIG.LIGHTS_IN_POOL <= 8, 'pooled light count out of range');
  assert(CONFIG.MAX_PIXEL_RATIO <= 2, 'pixel ratio cap too high for integrated GPUs');
});

/* ---------------------------------------------------------------- report -- */

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log('grid stats:', JSON.stringify(grid.stats));
console.log('decor:', JSON.stringify(decorPlan.stats));
console.log('bounds:', JSON.stringify(grid.bounds));
