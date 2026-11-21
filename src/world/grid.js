/**
 * world/grid.js
 * Pure grid reasoning for the ship. No THREE, no DOM, no Rapier.
 *
 * Converts the blueprint's rooms + doors into:
 *   - occupancy      cell -> roomId
 *   - wallRuns       greedily merged collinear boundary segments (one box each)
 *   - lintels        headers above every door opening
 *   - doorEdges      the cell-boundary edges a door removes
 *
 * Merging is what keeps draw calls and collider counts sane: a 2x12 corridor
 * with four doors becomes ~14 boxes instead of ~100 per-cell quads.
 */

/**
 * @typedef {Object} WallRun
 * @property {'alongX'|'alongZ'} orientation  direction the wall runs in
 * @property {number} line      cell line the wall sits on (constant z or x)
 * @property {number} start     inclusive cell index along the run
 * @property {number} end       exclusive cell index along the run
 * @property {string} a         room id on one side
 * @property {string|null} b    room id on the other side (null = void)
 * @property {boolean} exterior true when it borders space
 */

const key = (x, z) => `${x},${z}`;

export function buildGrid(ship) {
  /** @type {Map<string, any>} */
  const rooms = new Map();
  /** @type {Map<string, string>} */
  const occ = new Map();

  // --- occupancy -----------------------------------------------------------
  for (const room of ship.rooms) {
    const [x0, z0, w, d] = room.rect;
    if (![x0, z0, w, d].every(Number.isInteger) || w <= 0 || d <= 0) {
      throw new Error(`[grid] room ${room.id} has an invalid rect ${JSON.stringify(room.rect)}`);
    }
    const cells = [];
    for (let x = x0; x < x0 + w; x++) {
      for (let z = z0; z < z0 + d; z++) {
        const k = key(x, z);
        const existing = occ.get(k);
        if (existing) {
          throw new Error(`[grid] rooms ${existing} and ${room.id} overlap at cell ${k}`);
        }
        occ.set(k, room.id);
        cells.push([x, z]);
      }
    }
    rooms.set(room.id, { ...room, cells });
  }

  // --- door edges ----------------------------------------------------------
  /** @type {Map<string, string>} edgeKey -> doorId */
  const doorEdges = new Map();
  /** @type {Array<{id:string, orientation:'alongX'|'alongZ', line:number, start:number, end:number}>} */
  const lintels = [];

  for (const door of ship.doors) {
    const exterior = door.b === 'VOID'; // hull hatch: one side is space
    if (!rooms.has(door.a) || (!exterior && !rooms.has(door.b))) {
      throw new Error(`[grid] door ${door.id} references unknown room(s) ${door.a}/${door.b}`);
    }
    if (!(door.end > door.start)) {
      throw new Error(`[grid] door ${door.id} has an empty span ${door.start}..${door.end}`);
    }

    const isX = door.axis === 'x'; // wall plane perpendicular to X
    for (let i = door.start; i < door.end; i++) {
      const edgeKey = isX ? `x:${door.line}:${i}` : `z:${door.line}:${i}`;
      const sideA = isX ? [door.line - 1, i] : [i, door.line - 1];
      const sideB = isX ? [door.line, i] : [i, door.line];
      const roomA = occ.get(key(sideA[0], sideA[1])) ?? null;
      const roomB = occ.get(key(sideB[0], sideB[1])) ?? null;

      if (!roomA && !roomB) {
        throw new Error(`[grid] door ${door.id} at ${edgeKey} touches no room`);
      }
      const pair = [roomA, roomB].filter(Boolean).sort().join('+');
      const expected = [door.a, exterior ? null : door.b].filter(Boolean).sort().join('+');
      if (pair !== expected) {
        throw new Error(
          `[grid] door ${door.id} at ${edgeKey} connects ${pair || 'nothing'} but declares ${expected}`
        );
      }
      if (doorEdges.has(edgeKey)) {
        throw new Error(`[grid] door edge ${edgeKey} claimed by both ${doorEdges.get(edgeKey)} and ${door.id}`);
      }
      doorEdges.set(edgeKey, door.id);
    }

    lintels.push({
      id: door.id,
      orientation: isX ? 'alongZ' : 'alongX',
      line: door.line,
      start: door.start,
      end: door.end,
    });
  }

  // --- boundary walls ------------------------------------------------------
  /** @type {Map<number, Map<number, {a:string,b:string|null}>>} */
  const alongX = new Map(); // constant z, spans x
  /** @type {Map<number, Map<number, {a:string,b:string|null}>>} */
  const alongZ = new Map(); // constant x, spans z
  const openings = [];

  const push = (map, line, index, a, b) => {
    let byLine = map.get(line);
    if (!byLine) map.set(line, (byLine = new Map()));
    byLine.set(index, { a, b });
  };

  for (const [cellKey, rid] of occ) {
    const [x, z] = cellKey.split(',').map(Number);

    // four sides: (neighbourCell, orientation, line, index, edgeKey)
    const sides = [
      [[x, z - 1], 'alongX', z, x, `z:${z}:${x}`],
      [[x, z + 1], 'alongX', z + 1, x, `z:${z + 1}:${x}`],
      [[x - 1, z], 'alongZ', x, z, `x:${x}:${z}`],
      [[x + 1, z], 'alongZ', x + 1, z, `x:${x + 1}:${z}`],
    ];

    for (const [nb, orientation, line, index, edgeKey] of sides) {
      const neighbour = occ.get(key(nb[0], nb[1])) ?? null;
      if (neighbour === rid) continue; // interior of a room
      if (doorEdges.has(edgeKey)) {
        openings.push(edgeKey);
        continue;
      }
      if (orientation === 'alongX') push(alongX, line, index, rid, neighbour);
      else push(alongZ, line, index, rid, neighbour);
    }
  }

  const merge = (map, orientation) => {
    /** @type {WallRun[]} */
    const runs = [];
    for (const [line, cells] of map) {
      const indices = [...cells.keys()].sort((p, q) => p - q);
      let cur = null;
      for (const index of indices) {
        const { a, b } = cells.get(index);
        const signature = `${a}|${b ?? 'void'}`;
        if (cur && cur.signature === signature && index === cur.end) {
          cur.end = index + 1;
        } else {
          if (cur) runs.push(strip(cur));
          cur = { orientation, line, start: index, end: index + 1, a, b, signature };
        }
      }
      if (cur) runs.push(strip(cur));
    }
    return runs;
  };

  const strip = (run) => ({
    orientation: run.orientation,
    line: run.line,
    start: run.start,
    end: run.end,
    a: run.a,
    b: run.b,
    exterior: run.b === null,
  });

  const walls = [...merge(alongX, 'alongX'), ...merge(alongZ, 'alongZ')];

  // --- lookups -------------------------------------------------------------
  const bounds = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  for (const [cellKey] of occ) {
    const [x, z] = cellKey.split(',').map(Number);
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minZ = Math.min(bounds.minZ, z);
    bounds.maxX = Math.max(bounds.maxX, x + 1);
    bounds.maxZ = Math.max(bounds.maxZ, z + 1);
  }

  return {
    ship,
    rooms,
    occ,
    doorEdges,
    walls,
    lintels,
    openings,
    bounds,
    stats: {
      cells: occ.size,
      wallRuns: walls.length,
      lintels: lintels.length,
      doors: ship.doors.length,
    },
    roomAtCell: (x, z) => occ.get(key(x, z)) ?? null,
  };
}
