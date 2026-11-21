/**
 * tools/test-logic.mjs
 * Unit checks for the pure systems. No DOM, no THREE, no Rapier.
 *
 *   node tools/test-logic.mjs
 */
import { SHIP } from '../src/world/blueprint.js';
import { buildGrid } from '../src/world/grid.js';
import { generateSurfaceData, SURFACE_SPECS } from '../src/render/surfacegen.js';

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

/* ---------------------------------------------------------------- report -- */

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log('grid stats:', JSON.stringify(grid.stats));
console.log('bounds:', JSON.stringify(grid.bounds));
