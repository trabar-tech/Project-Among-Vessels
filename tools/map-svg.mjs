/**
 * tools/map-svg.mjs
 * Renders the generated deck to a top-down SVG schematic: room fills, names,
 * areas and circuits, door spans, the spawn point, and every planned decorative
 * fitting by type. Pure data -> markup, no dependencies.
 *
 *   node tools/map-svg.mjs [outfile]      (default: docs/ship-plan.svg)
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SHIP } from '../src/world/blueprint.js';
import { buildGrid } from '../src/world/grid.js';
import { planDecor } from '../src/world/decorplan.js';
import { CONFIG } from '../src/core/config.js';

const CELL = CONFIG.CELL;
const SCALE = 44; // px per metre
const PAD = 64;

const grid = buildGrid(SHIP);
const plan = planDecor({ ship: SHIP, grid });

const { minX, maxX, minZ, maxZ } = grid.bounds;
const width = (maxX - minX) * CELL * SCALE + PAD * 2;
const height = (maxZ - minZ) * CELL * SCALE + PAD * 2 + 40;

const px = (wx) => PAD + (wx - minX * CELL) * SCALE;
const pz = (wz) => PAD + 40 + (wz - minZ * CELL) * SCALE;

const FILL = {
  corridor: '#243038',
  bridge: '#22333a',
  medbay: '#1f3630',
  cargo: '#3a3020',
  reactor: '#3a2422',
  quarters: '#2c2836',
  airlock: '#332a2a',
};
const ACCENT = {
  corridor: '#7fb6c9',
  bridge: '#8fd0e0',
  medbay: '#7fd0a8',
  cargo: '#d7b06a',
  reactor: '#e08a76',
  quarters: '#b3a2d8',
  airlock: '#d89a9a',
};
const DECOR_COLOUR = { vent: '#9fc6d8', conduit: '#d9c27a', junction: '#c88f6a', placard: '#e0e0d0' };

const parts = [];
parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">`);
parts.push(`<rect width="${width}" height="${height}" fill="#08090b"/>`);
parts.push(`<text x="${PAD}" y="${PAD - 22}" fill="#cfd8dc" font-size="20" letter-spacing="2">${SHIP.name.toUpperCase()} — DECK PLAN</text>`);
parts.push(`<text x="${PAD}" y="${PAD - 4}" fill="#6b7b83" font-size="11" letter-spacing="1">${SHIP.registry} · ${(maxX - minX) * CELL} × ${(maxZ - minZ) * CELL} m · ${SHIP.rooms.length} compartments · ${SHIP.doors.length} doors · ${plan.stats.total} derived fittings</text>`);

// grid
parts.push('<g stroke="#14191c" stroke-width="0.5">');
for (let x = minX; x <= maxX; x++) {
  parts.push(`<line x1="${px(x * CELL)}" y1="${pz(minZ * CELL)}" x2="${px(x * CELL)}" y2="${pz(maxZ * CELL)}"/>`);
}
for (let z = minZ; z <= maxZ; z++) {
  parts.push(`<line x1="${px(minX * CELL)}" y1="${pz(z * CELL)}" x2="${px(maxX * CELL)}" y2="${pz(z * CELL)}"/>`);
}
parts.push('</g>');

// rooms
for (const room of SHIP.rooms) {
  const [x0, z0, w, d] = room.rect;
  const X = px(x0 * CELL);
  const Z = pz(z0 * CELL);
  const W = w * CELL * SCALE;
  const H = d * CELL * SCALE;
  parts.push(`<rect x="${X}" y="${Z}" width="${W}" height="${H}" fill="${FILL[room.kind] ?? '#23282c'}" stroke="${ACCENT[room.kind] ?? '#7fb6c9'}" stroke-width="2"/>`);
  parts.push(`<text x="${X + 10}" y="${Z + 22}" fill="${ACCENT[room.kind]}" font-size="13" letter-spacing="1">${room.name.toUpperCase()}</text>`);
  parts.push(`<text x="${X + 10}" y="${Z + 39}" fill="#77868d" font-size="10">${w * d * CELL * CELL} m² · circuit ${room.circuit} · ${room.floor}</text>`);
}

// decor
for (const item of plan.items) {
  const X = px(item.x);
  const Z = pz(item.z);
  const colour = DECOR_COLOUR[item.type] ?? '#888';
  if (item.type === 'conduit') {
    // Conduits run along the wall tangent. yaw maps local +Z onto the wall
    // normal, so local +X (the tangent) is (cos yaw, -sin yaw) in plan space.
    const half = (item.d * SCALE) / 2;
    const tx = Math.cos(item.yaw) * half;
    const tz = -Math.sin(item.yaw) * half;
    parts.push(`<line x1="${X - tx}" y1="${Z - tz}" x2="${X + tx}" y2="${Z + tz}" stroke="${colour}" stroke-width="3" stroke-linecap="round" opacity="0.8"/>`);
  } else if (item.type === 'vent') {
    parts.push(`<rect x="${X - 4}" y="${Z - 4}" width="8" height="8" fill="none" stroke="${colour}" stroke-width="1.6"/>`);
  } else if (item.type === 'junction') {
    parts.push(`<circle cx="${X}" cy="${Z}" r="3" fill="${colour}" opacity="0.9"/>`);
  } else {
    parts.push(`<circle cx="${X}" cy="${Z}" r="2" fill="${colour}" opacity="0.55"/>`);
  }
}

// doors
for (const door of SHIP.doors) {
  const isX = door.axis === 'x';
  const a = door.start * CELL;
  const b = door.end * CELL;
  const line = door.line * CELL;
  if (isX) {
    parts.push(`<line x1="${px(a)}" y1="${pz(line)}" x2="${px(b)}" y2="${pz(line)}" stroke="#f0e6c8" stroke-width="6" stroke-linecap="butt"/>`);
    parts.push(`<text x="${(px(a) + px(b)) / 2}" y="${pz(line) + 4}" fill="#141414" font-size="9" text-anchor="middle">${door.id.replace(/^D_/, '')}</text>`);
  } else {
    parts.push(`<line x1="${px(line)}" y1="${pz(a)}" x2="${px(line)}" y2="${pz(b)}" stroke="#f0e6c8" stroke-width="6" stroke-linecap="butt"/>`);
  }
}

// spawn
const sx = px(SHIP.spawn[0]);
const sz = pz(SHIP.spawn[2]);
parts.push(`<circle cx="${sx}" cy="${sz}" r="7" fill="none" stroke="#8fe0b0" stroke-width="2"/>`);
parts.push(`<circle cx="${sx}" cy="${sz}" r="2.5" fill="#8fe0b0"/>`);
parts.push(`<text x="${sx + 12}" y="${sz + 4}" fill="#8fe0b0" font-size="10">SPAWN</text>`);

// legend
const legendY = height - 30;
let lx = PAD;
const legend = [
  ['#f0e6c8', 'doorway'],
  ['#8fe0b0', 'spawn'],
  [DECOR_COLOUR.vent, 'vent'],
  [DECOR_COLOUR.conduit, 'conduit'],
  [DECOR_COLOUR.junction, 'junction'],
  [DECOR_COLOUR.placard, 'placard'],
];
for (const [colour, label] of legend) {
  parts.push(`<rect x="${lx}" y="${legendY - 8}" width="9" height="9" fill="${colour}"/>`);
  parts.push(`<text x="${lx + 15}" y="${legendY}" fill="#8b989e" font-size="10">${label}</text>`);
  lx += 15 + label.length * 7 + 18;
}
parts.push('</svg>');

const out = resolve(process.argv[2] ?? 'docs/ship-plan.svg');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, parts.join('\n') + '\n');
console.log(`wrote ${out} (${width}×${height}, ${plan.stats.total} fittings)`);
