/**
 * world/decorplan.js
 * PURE placement planner for wall decoration. No THREE, no Rapier, no DOM.
 *
 * Why a planner instead of hand-placed meshes:
 *   the first version hardcoded two vents at fixed coordinates and one of them
 *   landed inside a door opening, floating in mid-air. Decoration that is placed
 *   by hand can always disagree with the geometry. So decoration is now DERIVED:
 *   walk the merged wall runs, work out which side the room is on, and sample two
 *   lanes along every wall the way a real bulkhead is dressed:
 *
 *     HIGH lane (2.0-2.5 m): vents and conduit runs   -- services
 *     LOW  lane (1.3-1.7 m): junction boxes, placards -- things a hand can reach
 *
 *   Both lanes are rejected if they would intersect a door opening, a console,
 *   a prop, the breaker panel, or another decor item.
 *
 * The planner emits plain data; `decor.js` turns it into three merged meshes, and
 * `tools/test-logic.mjs` asserts the invariants without a renderer.
 */
import { CONFIG } from '../core/config.js';
import { mulberry32 } from '../core/rng.js';

/** Physical envelopes of the decor types, in metres. `y` is the centre height. */
export const DECOR_TYPES = {
  vent: { w: 0.86, h: 0.58, d: 0.09, y: 2.02, radius: 0.5 },
  conduit: { w: 0.07, h: 0.07, d: 1.5, y: 2.44, radius: 0.8 },
  junction: { w: 0.34, h: 0.46, d: 0.11, y: 1.36, radius: 0.32 },
  placard: { w: 0.46, h: 0.32, d: 0.03, y: 1.62, radius: 0.3 },
};

/** High lane is services, low lane is furniture-mounted hardware. */
const HIGH = { vent: 0.62, conduit: 0.38 };
const LOW = { junction: 0.72, placard: 0.28 };

/** Per-room flavour: how much conduit versus ventilation, and how dense. */
const ROOM_MIX = {
  corridor: { high: { vent: 0.5, conduit: 0.5 }, low: { junction: 0.6, placard: 0.4 }, spacing: 3.0 },
  cargo: { high: { vent: 0.34, conduit: 0.66 }, low: { junction: 0.72, placard: 0.28 }, spacing: 3.6 },
  reactor: { high: { vent: 0.3, conduit: 0.7 }, low: { junction: 0.8, placard: 0.2 }, spacing: 3.4 },
  medbay: { high: { vent: 0.8, conduit: 0.2 }, low: { junction: 0.86, placard: 0.14 }, spacing: 3.4 },
  quarters: { high: { vent: 0.74, conduit: 0.26 }, low: { junction: 0.8, placard: 0.2 }, spacing: 3.6 },
  bridge: { high: { vent: 0.7, conduit: 0.3 }, low: { junction: 0.74, placard: 0.26 }, spacing: 3.8 },
  airlock: { high: { vent: 0.5, conduit: 0.5 }, low: { junction: 0.7, placard: 0.3 }, spacing: 2.6 },
};


/**
 * Shared door-exclusion rule. Returns the door id whose opening volume contains
 * (x, z), or null. Exported so tests and the planner cannot drift apart.
 *
 * @param {any} ship
 * @param {number} x world metres
 * @param {number} z world metres
 * @param {number} [margin] extra clearance along the wall, metres
 */
export function doorBandHit(ship, x, z, margin = 0.55, cell = CONFIG.CELL) {
  for (const door of ship.doors) {
    const isX = door.axis === 'x';
    const centreX = isX ? door.line * cell : ((door.start + door.end) / 2) * cell;
    const centreZ = isX ? ((door.start + door.end) / 2) * cell : door.line * cell;
    const halfSpan = ((door.end - door.start) * cell) / 2;
    const along = isX ? Math.abs(z - centreZ) : Math.abs(x - centreX);
    const normal = isX ? Math.abs(x - centreX) : Math.abs(z - centreZ);
    if (along < halfSpan + margin && normal < 0.9) return door.id;
  }
  return null;
}

/**
 * @param {{ship:any, grid:any, seed?:number, avoid?:Array<{x:number,z:number,r:number,what?:string}>}} args
 * @returns {{items:Array<any>, rejected:Array<any>, stats:any}}
 */
export function planDecor({ ship, grid, seed = 0xdec0, avoid = [] }) {
  const CELL = CONFIG.CELL;
  const r = mulberry32(seed);
  const f = (a, b) => a + r() * (b - a);
  const pickWeighted = (weights) => {
    const total = Object.values(weights).reduce((s, v) => s + v, 0);
    let t = r() * total;
    for (const [key, w] of Object.entries(weights)) {
      t -= w;
      if (t <= 0) return key;
    }
    return Object.keys(weights)[0];
  };

  /* --------------------------------------------------------- exclusion --- */

  /** Door openings, expanded along the wall and through it. */
  const doorBands = ship.doors.map((door) => {
    const isX = door.axis === 'x';
    return {
      id: door.id,
      isX,
      centreX: isX ? door.line * CELL : ((door.start + door.end) / 2) * CELL,
      centreZ: isX ? ((door.start + door.end) / 2) * CELL : door.line * CELL,
      halfSpan: ((door.end - door.start) * CELL) / 2,
    };
  });

  /** True if (x,z) is inside a door's opening volume. */
  function inDoorBand(x, z, margin = 0.55) {
    for (const band of doorBands) {
      const along = band.isX ? Math.abs(z - band.centreZ) : Math.abs(x - band.centreX);
      const normal = band.isX ? Math.abs(x - band.centreX) : Math.abs(z - band.centreZ);
      if (along < band.halfSpan + margin && normal < 0.9) return band.id;
    }
    return null;
  }

  // Consoles, props and the breaker panel are solid furniture.
  const furniture = [];
  for (const c of ship.consoles ?? []) furniture.push({ x: c.at[0], z: c.at[1], r: 0.9, what: c.id });
  for (const p of ship.props ?? []) {
    const radius = p.kind === 'core' ? 2.0 : p.kind === 'bunk' || p.kind === 'bed' ? 1.2 : 0.75;
    furniture.push({ x: p.at[0], z: p.at[1], r: radius, what: p.kind });
  }
  if (ship.breakerPanel) {
    furniture.push({ x: ship.breakerPanel.at[0], z: ship.breakerPanel.at[1], r: 0.9, what: 'breakers' });
  }

  // Welded hull hatches occupy a large plate on a bulkhead -- keep it clear.
  for (const hatch of ship.hatches ?? []) {
    furniture.push({ x: hatch.at[0], z: hatch.at[1], r: 1.7, what: `hatch ${hatch.id}` });
  }

  // Every doorway carries a lit nameplate over it (see builder's sign pass),
  // so the wall directly above a door is occupied too. Derived here rather than
  // passed in, so the rule holds for tests and for the builder alike.
  for (const door of ship.doors) {
    const isX = door.axis === 'x';
    const spanMid = ((door.start + door.end) / 2) * CELL;
    const line = door.line * CELL;
    const offsets = [-0.16, 0.16];
    for (const off of offsets) {
      furniture.push(isX
        ? { x: line + off, z: spanMid, r: 0.95, what: `sign ${door.id}` }
        : { x: spanMid, z: line + off, r: 0.95, what: `sign ${door.id}` });
    }
  }
  for (const a of avoid) furniture.push({ x: a.x, z: a.z, r: a.r, what: a.what ?? 'avoid' });

  const hitsFurniture = (x, z, radius) => {
    for (const item of furniture) {
      const dx = x - item.x;
      const dz = z - item.z;
      if (dx * dx + dz * dz < (item.r + radius) * (item.r + radius)) return item.what;
    }
    return null;
  };

  /* ------------------------------------------------------------ placement -- */

  const items = [];
  const rejected = [];

  for (const room of ship.rooms) {
    const mix = ROOM_MIX[room.kind] ?? ROOM_MIX.corridor;

    // Every wall this room touches -- INCLUDING the outer hull. The hull is the
    // longest uninterrupted surface a room has, so excluding it (as the first
    // pass did) starves the planner and leaves the ship bare.
    const runs = grid.walls.filter((run) => run.a === room.id || run.b === room.id);

    for (const run of runs) {
      const alongX = run.orientation === 'alongX';
      const wallLine = run.line * CELL;
      const runStart = run.start * CELL;
      const runEnd = run.end * CELL;
      if (runEnd - runStart < 1.8) continue;

      const thickness = run.exterior ? CONFIG.EXTERIOR_THICKNESS : CONFIG.WALL_THICKNESS;

      // Which side of the wall is this room on? Normal points INTO the room.
      let normal;
      if (alongX) {
        const south = grid.roomAtCell(run.start, run.line - 1);
        normal = south === room.id ? { x: 0, z: -1 } : { x: 0, z: 1 };
      } else {
        const west = grid.roomAtCell(run.line - 1, run.start);
        normal = west === room.id ? { x: -1, z: 0 } : { x: 1, z: 0 };
      }
      const yaw = Math.atan2(normal.x, normal.z);

      const tryPlace = (lane, t) => {
        const clamped = Math.min(Math.max(t, runStart + 0.7), runEnd - 0.7);
        const x = alongX ? clamped : wallLine;
        const z = alongX ? wallLine : clamped;

        const type = pickWeighted(lane === 'high' ? mix.high : mix.low);
        const envelope = DECOR_TYPES[type];

        // Flush to the wall face, pushed out by half its own depth.
        const px = x + normal.x * (thickness / 2 + envelope.d / 2 + 0.015);
        const pz = z + normal.z * (thickness / 2 + envelope.d / 2 + 0.015);

        const doorHit = inDoorBand(px, pz, 0.6);
        if (doorHit) {
          rejected.push({ room: room.id, type, x: +px.toFixed(2), z: +pz.toFixed(2), reason: `door ${doorHit}` });
          return;
        }

        const furnitureHit = hitsFurniture(px, pz, envelope.radius);
        if (furnitureHit) {
          rejected.push({ room: room.id, type, x: +px.toFixed(2), z: +pz.toFixed(2), reason: `furniture ${furnitureHit}` });
          return;
        }

        for (const other of items) {
          const dx = other.x - px;
          const dz = other.z - pz;
          if (dx * dx + dz * dz < 1.0 * 1.0) {
            rejected.push({ room: room.id, type, x: +px.toFixed(2), z: +pz.toFixed(2), reason: `clash ${other.type}` });
            return;
          }
        }

        // Sanity: decor must end up inside this room, not in the void.
        const cell = grid.roomAtCell(Math.floor(px / CELL), Math.floor(pz / CELL));
        if (cell !== room.id) {
          rejected.push({ room: room.id, type, x: +px.toFixed(2), z: +pz.toFixed(2), reason: `outside ${cell}` });
          return;
        }

        items.push({
          type,
          lane,
          room: room.id,
          x: +px.toFixed(3),
          y: envelope.y,
          z: +pz.toFixed(3),
          yaw: +yaw.toFixed(3),
          w: envelope.w,
          h: envelope.h,
          d: envelope.d,
        });
      };

      const spacing = mix.spacing;
      for (let s = runStart; s <= runEnd - 1.4; s += spacing) {
        tryPlace('high', s + f(-0.5, 0.5));
        tryPlace('low', s + spacing * 0.5 + f(-0.45, 0.45));
      }
    }
  }

  const byType = {};
  const byRoom = {};
  const byLane = { high: 0, low: 0 };
  for (const item of items) {
    byType[item.type] = (byType[item.type] ?? 0) + 1;
    byRoom[item.room] = (byRoom[item.room] ?? 0) + 1;
    byLane[item.lane]++;
  }

  return {
    items,
    rejected,
    stats: { total: items.length, byType, byRoom, byLane, rejected: rejected.length },
  };
}
