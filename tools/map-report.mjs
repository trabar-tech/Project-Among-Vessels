/**
 * tools/map-report.mjs
 * Human-readable report on the generated ship: ASCII plan, room/door tables,
 * decoration coverage, reachability distances, and budget figures.
 *
 * Doubles as a validator: exits non-zero if the layout violates an invariant, so
 * it can run in CI alongside the other checks.
 *
 *   node tools/map-report.mjs
 */
import { SHIP } from '../src/world/blueprint.js';
import { buildGrid } from '../src/world/grid.js';
import { planDecor, doorBandHit, DECOR_TYPES } from '../src/world/decorplan.js';
import { CONFIG } from '../src/core/config.js';

const CELL = CONFIG.CELL;
const grid = buildGrid(SHIP);
const plan = planDecor({ ship: SHIP, grid });
const problems = [];

const LETTER = { BRIDGE: 'B', CORRIDOR: 'S', MEDBAY: 'M', CARGO: 'G', REACTOR: 'R', QUARTERS: 'Q', AIRLOCK: 'A' };
const pad = (v, n) => String(v).padStart(n);
const padEnd = (v, n) => String(v).padEnd(n);

/* --------------------------------------------------------------- ascii map -- */

const { minX, maxX, minZ, maxZ } = grid.bounds;
const doorCells = new Set();
for (const door of SHIP.doors) {
  const isX = door.axis === 'x';
  for (let i = door.start; i < door.end; i++) {
    if (isX) {
      doorCells.add(`${door.line - 1},${i}`);
      doorCells.add(`${door.line},${i}`);
    } else {
      doorCells.add(`${i},${door.line - 1}`);
      doorCells.add(`${i},${door.line}`);
    }
  }
}

console.log(`\n  ${SHIP.name.toUpperCase()} // ${SHIP.registry}`);
console.log(`  ${maxX - minX} x ${maxZ - minZ} cells @ ${CELL} m  (${(maxX - minX) * CELL} x ${(maxZ - minZ) * CELL} m)\n`);

// column ruler (tens digit then units, two chars per cell)
let ruler1 = '     ';
let ruler2 = '     ';
for (let x = minX; x < maxX; x++) {
  ruler1 += x % 10 === 0 ? pad(Math.floor(x / 10), 2) : '  ';
  ruler2 += pad(x % 10, 2);
}
console.log(ruler1);
console.log(ruler2);

for (let z = minZ; z < maxZ; z++) {
  let row = `${pad(z, 3)}  `;
  for (let x = minX; x < maxX; x++) {
    const room = grid.roomAtCell(x, z);
    const key = `${x},${z}`;
    if (doorCells.has(key)) row += ' +';
    else if (room) row += ` ${LETTER[room] ?? '?'}`;
    else row += ' .';
  }
  console.log(row);
}
console.log('\n  legend: ' + Object.entries(LETTER).map(([id, ch]) => `${ch}=${id.toLowerCase()}`).join('  '));
console.log('          += doorway volume   .= open space outside the hull');

/* ------------------------------------------------------------------ rooms -- */

const spawnRoom = grid.roomAtCell(Math.floor(SHIP.spawn[0] / CELL), Math.floor(SHIP.spawn[2] / CELL));

const adjacency = new Map(SHIP.rooms.map((r) => [r.id, new Set()]));
for (const door of SHIP.doors) {
  if (door.b === 'VOID') continue;
  adjacency.get(door.a)?.add(door.b);
  adjacency.get(door.b)?.add(door.a);
}
const dist = new Map([[spawnRoom, 0]]);
const queue = [spawnRoom];
while (queue.length) {
  const cur = queue.shift();
  for (const next of adjacency.get(cur) ?? []) {
    if (!dist.has(next)) {
      dist.set(next, dist.get(cur) + 1);
      queue.push(next);
    }
  }
}

console.log('\n  ROOMS');
console.log(`  ${padEnd('id', 10)}${padEnd('name', 17)}${padEnd('kind', 10)}${pad('m2', 6)}  ${padEnd('circuit', 9)}${padEnd('floor', 9)}${pad('decor', 6)}${pad('doors', 7)}${pad('hops', 6)}`);
for (const room of SHIP.rooms) {
  const [x0, z0, w, d] = room.rect;
  const decor = plan.items.filter((i) => i.room === room.id).length;
  const doors = SHIP.doors.filter((dr) => dr.a === room.id || dr.b === room.id).length;
  const hops = dist.has(room.id) ? dist.get(room.id) : '—';
  if (!dist.has(room.id)) problems.push(`${room.id} is unreachable from ${spawnRoom}`);
  console.log(
    `  ${padEnd(room.id, 10)}${padEnd(room.name, 17)}${padEnd(room.kind, 10)}${pad(w * d * CELL * CELL, 6)}  ${padEnd(room.circuit, 9)}${padEnd(room.floor, 9)}${pad(decor, 6)}${pad(doors, 7)}${pad(hops, 6)}`
  );
}

/* ------------------------------------------------------------------ doors -- */

console.log('\n  DOORS');
console.log(`  ${padEnd('id', 12)}${padEnd('between', 26)}${padEnd('kind', 10)}${pad('width', 7)}${pad('headroom', 10)}${pad('sides', 7)}`);
for (const door of SHIP.doors) {
  const width = (door.end - door.start) * CELL;
  const sides = door.b === 'VOID' ? 1 : 2;
  const between = `${door.a} <-> ${door.b}`;
  if (width < CONFIG.PLAYER_RADIUS * 2 + 0.8) problems.push(`${door.id} is too narrow (${width} m)`);
  console.log(
    `  ${padEnd(door.id, 12)}${padEnd(between, 26)}${padEnd(door.kind ?? 'standard', 10)}${pad(width, 7)}${pad(CONFIG.DOOR_HEIGHT, 10)}${pad(sides, 7)}`
  );
}

/* ------------------------------------------------------------------ decor -- */

console.log('\n  DECORATION (planned, not hand-placed)');
console.log(`  ${padEnd('type', 10)}${pad('count', 7)}   lanes / heights`);
for (const [type, count] of Object.entries(plan.stats.byType).sort()) {
  console.log(`  ${padEnd(type, 10)}${pad(count, 7)}   y=${DECOR_TYPES[type]?.y ?? '?'}`);
}
console.log(`  ${padEnd('total', 10)}${pad(plan.stats.total, 7)}   rejected candidates: ${plan.stats.rejected}`);

const rejectReasons = {};
for (const r of plan.rejected) {
  const key = r.reason.split(' ')[0];
  rejectReasons[key] = (rejectReasons[key] ?? 0) + 1;
}
console.log('  rejection reasons: ' + Object.entries(rejectReasons).map(([k, v]) => `${k}=${v}`).join(', '));

for (const item of plan.items) {
  const door = doorBandHit(SHIP, item.x, item.z, 0.2);
  if (door) problems.push(`decor ${item.type} in ${item.room} sits in ${door}`);
}

/* ----------------------------------------------------------------- budget -- */

const colliders = SHIP.rooms.length * 2 + grid.stats.wallRuns + grid.stats.lintels + SHIP.consoles.length;
console.log('\n  BUDGET');
console.log(`  cells ${grid.stats.cells}  wall runs ${grid.stats.wallRuns}  lintels ${grid.stats.lintels}  doors ${grid.stats.doors}`);
console.log(`  static colliders (est.) ${colliders}  fixtures ${SHIP.lights.length}  decor ${plan.stats.total}  decor draw calls 3`);
console.log(`  props ${SHIP.props.length} (${SHIP.props.filter((p) => p.dynamic).length} dynamic)  consoles ${SHIP.consoles.length}`);

/* ----------------------------------------------------------------- result -- */

if (problems.length) {
  console.log(`\n  ${problems.length} PROBLEM(S):`);
  for (const p of problems) console.log(`   ✗ ${p}`);
  process.exit(1);
}
console.log('\n  layout OK\n');
