/**
 * world/builder.js
 * Turns the blueprint into a walkable ship.
 *
 * Performance strategy (see PROJECT_BRAIN.md 3, W3):
 *   every wall run is merged into one BufferGeometry per material, UVs are
 *   projected from world space so long walls tile instead of stretching, and
 *   colliders are one cuboid per merged run (not per cell).
 */
import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { buildGrid } from './grid.js';
import { addCubeCollider, applyWorldUV, boxGeo, cylGeo, mergeAll, mesh } from './geom.js';

const C = CONFIG.CELL;
const WALL_H = CONFIG.WALL_HEIGHT;
const DOOR_H = CONFIG.DOOR_HEIGHT;

function addMerged(group, geometries, material, name) {
  if (!geometries.length) return null;
  const scale = material.userData?.uvScale ?? 0.25;
  for (const g of geometries) applyWorldUV(g, scale);
  const merged = mergeAll(geometries);
  if (!merged) return null;
  const m = mesh(merged, material);
  m.name = name;
  group.add(m);
  return m;
}

export function buildShip({ scene, world, RAPIER, mats, ship }) {
  const grid = buildGrid(ship);
  const root = new THREE.Group();
  root.name = 'ship';
  scene.add(root);

  const staticBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const rooms = [...grid.rooms.values()];
  const stats = { ...grid.stats, colliders: 0, drawGroups: 0 };

  /* ------------------------------------------------------------- floors -- */
  const floorGeos = new Map();
  for (const room of rooms) {
    const [x0, z0, w, d] = room.rect;
    const wx = (x0 + w / 2) * C;
    const wz = (z0 + d / 2) * C;
    const ww = w * C;
    const dd = d * C;

    const key = room.floor ?? 'deck';
    if (!floorGeos.has(key)) floorGeos.set(key, []);
    floorGeos.get(key).push(boxGeo(ww, CONFIG.FLOOR_THICKNESS, dd, wx, -CONFIG.FLOOR_THICKNESS / 2, wz));

    addCubeCollider(RAPIER, world, staticBody, {
      w: ww,
      h: CONFIG.FLOOR_THICKNESS,
      d: dd,
      x: wx,
      y: -CONFIG.FLOOR_THICKNESS / 2,
      z: wz,
      friction: 1.0,
    });
    stats.colliders++;

    // ceiling slab doubles as the "don't jump into space" lid
    addCubeCollider(RAPIER, world, staticBody, {
      w: ww,
      h: CONFIG.CEILING_THICKNESS,
      d: dd,
      x: wx,
      y: WALL_H + CONFIG.CEILING_THICKNESS / 2,
      z: wz,
      friction: 0.9,
    });
    stats.colliders++;
  }

  for (const [key, geos] of floorGeos) {
    addMerged(root, geos, mats[key] ?? mats.deck, `floor_${key}`);
    stats.drawGroups++;
  }

  /* ------------------------------------------------------------ ceilings -- */
  const ceilingGeos = [];
  for (const room of rooms) {
    const [x0, z0, w, d] = room.rect;
    ceilingGeos.push(
      boxGeo(
        w * C,
        CONFIG.CEILING_THICKNESS,
        d * C,
        (x0 + w / 2) * C,
        WALL_H + CONFIG.CEILING_THICKNESS / 2,
        (z0 + d / 2) * C
      )
    );
  }
  addMerged(root, ceilingGeos, mats.ceiling, 'ceiling');
  stats.drawGroups++;

  /* --------------------------------------------------------------- walls -- */
  const wallGeos = new Map(); // materialName -> geometries
  for (const run of grid.walls) {
    const room = grid.rooms.get(run.a);
    const matName = run.exterior ? 'reactor' : room?.wall ?? 'hull';
    const thickness = run.exterior ? CONFIG.EXTERIOR_THICKNESS : CONFIG.WALL_THICKNESS;
    const length = (run.end - run.start) * C;
    const mid = ((run.start + run.end) / 2) * C;

    let geo;
    let collider;
    if (run.orientation === 'alongX') {
      const z = run.line * C;
      geo = boxGeo(length, WALL_H, thickness, mid, WALL_H / 2, z);
      collider = { w: length, h: WALL_H, d: thickness, x: mid, y: WALL_H / 2, z };
    } else {
      const x = run.line * C;
      geo = boxGeo(thickness, WALL_H, length, x, WALL_H / 2, mid);
      collider = { w: thickness, h: WALL_H, d: length, x, y: WALL_H / 2, z: mid };
    }

    if (!wallGeos.has(matName)) wallGeos.set(matName, []);
    wallGeos.get(matName).push(geo);
    addCubeCollider(RAPIER, world, staticBody, { ...collider, friction: 0.9 });
    stats.colliders++;
  }
  for (const [matName, geos] of wallGeos) {
    addMerged(root, geos, mats[matName] ?? mats.hull, `walls_${matName}`);
    stats.drawGroups++;
  }

  /* ------------------------------------------------------------- lintels -- */
  const lintelGeos = [];
  const lintelH = WALL_H - DOOR_H;
  for (const lintel of grid.lintels) {
    const length = (lintel.end - lintel.start) * C;
    const mid = ((lintel.start + lintel.end) / 2) * C;
    const y = DOOR_H + lintelH / 2;
    let geo;
    let collider;
    if (lintel.orientation === 'alongX') {
      const z = lintel.line * C;
      geo = boxGeo(length, lintelH, CONFIG.WALL_THICKNESS, mid, y, z);
      collider = { w: length, h: lintelH, d: CONFIG.WALL_THICKNESS, x: mid, y, z };
    } else {
      const x = lintel.line * C;
      geo = boxGeo(CONFIG.WALL_THICKNESS, lintelH, length, x, y, mid);
      collider = { w: CONFIG.WALL_THICKNESS, h: lintelH, d: length, x, y, z: mid };
    }
    lintelGeos.push(geo);
    addCubeCollider(RAPIER, world, staticBody, { ...collider, friction: 0.9 });
    stats.colliders++;
  }
  addMerged(root, lintelGeos, mats.hull, 'lintels');
  stats.drawGroups++;

  /* ------------------------------------------------------------ fixtures -- */
  const fixtures = [];
  for (const fixture of ship.lights) {
    const [wx, wz] = fixture.at;
    const tone = fixture.tone ?? 'warm';

    const housing = mesh(new THREE.BoxGeometry(1.15, 0.12, 0.36), mats.propDark);
    housing.position.set(wx, WALL_H - 0.1, wz);
    root.add(housing);

    const base = tone === 'cold' ? mats.lampCold : mats.lampWarm;
    const mat = base.clone();
    mat.emissiveIntensity = base.emissiveIntensity;
    const lamp = mesh(new THREE.BoxGeometry(0.98, 0.05, 0.24), mat, { cast: false });
    lamp.position.set(wx, WALL_H - 0.165, wz);
    root.add(lamp);

    fixtures.push({
      id: fixture.id,
      room: fixture.room,
      circuit: fixture.circuit,
      position: new THREE.Vector3(wx, WALL_H - 0.42, wz),
      material: mat,
      baseIntensity: base.emissiveIntensity,
      tone,
      color: tone === 'cold' ? 0xbfe9ff : 0xffdfae,
      phase: Math.random() * Math.PI * 2,
      level: 1,
    });
  }

  /* ------------------------------------------------------------ consoles -- */
  const consoles = [];
  for (const spec of ship.consoles) {
    const g = new THREE.Group();
    g.name = `console_${spec.id}`;
    g.position.set(spec.at[0], 0, spec.at[1]);
    g.rotation.y = spec.facing;

    const pedestal = mesh(new THREE.BoxGeometry(1.25, 0.95, 0.52), mats.propDark);
    pedestal.position.set(0, 0.475, 0);
    g.add(pedestal);

    const desk = mesh(new THREE.BoxGeometry(1.36, 0.07, 0.64), mats.propMetal);
    desk.position.set(0, 0.98, 0.04);
    g.add(desk);

    const frame = mesh(new THREE.BoxGeometry(1.06, 0.72, 0.06), mats.propDark);
    frame.position.set(0, 1.36, -0.13);
    frame.rotation.x = -0.26;
    g.add(frame);

    const screenMat = spec.screen === 'PWR' ? mats.screenWarn : mats.screen;
    const screen = mesh(new THREE.PlaneGeometry(0.96, 0.62), screenMat, { cast: false });
    screen.position.set(0, 1.37, -0.095);
    screen.rotation.x = -0.26;
    g.add(screen);

    const keys = mesh(new THREE.BoxGeometry(0.82, 0.035, 0.2), mats.propMetal);
    keys.position.set(0, 1.02, 0.2);
    g.add(keys);

    root.add(g);
    addCubeCollider(RAPIER, world, staticBody, {
      w: 1.36,
      h: 1.0,
      d: 0.7,
      x: spec.at[0],
      y: 0.5,
      z: spec.at[1],
      ry: spec.facing,
    });
    stats.colliders++;

    consoles.push({
      id: spec.id,
      label: spec.label,
      room: spec.room,
      object: g,
      screen,
    });
  }

  /* --------------------------------------------------------------- signs -- */
  // Above every door, on both faces: the name of where the door leads.
  const signY = DOOR_H + 0.42;
  for (const door of ship.doors) {
    const spanMid = ((door.start + door.end) / 2) * C;
    const width = Math.min(1.9, (door.end - door.start) * C - 0.5);

    const sides = [];
    if (door.axis === 'x') {
      const x = door.line * C;
      const left = grid.roomAtCell(door.line - 1, door.start);
      const right = grid.roomAtCell(door.line, door.start);
      sides.push({ x: x - 0.16, z: spanMid, ry: -Math.PI / 2, id: left, other: right });
      sides.push({ x: x + 0.16, z: spanMid, ry: Math.PI / 2, id: right, other: left });
    } else {
      const z = door.line * C;
      const south = grid.roomAtCell(door.start, door.line - 1);
      const north = grid.roomAtCell(door.start, door.line);
      sides.push({ x: spanMid, z: z - 0.16, ry: Math.PI, id: south, other: north });
      sides.push({ x: spanMid, z: z + 0.16, ry: 0, id: north, other: south });
    }

    for (const side of sides) {
      if (!side.id || !side.other) continue;
      const dest = grid.rooms.get(side.other);
      const mat = mats.sign(dest?.name ?? 'SEALED', dest?.kind === 'airlock' ? 'CYCLE' : 'DECK 1');
      const sign = mesh(new THREE.PlaneGeometry(width, width * 0.24), mat, { cast: false });
      sign.position.set(side.x, signY, side.z);
      sign.rotation.y = side.ry;
      sign.name = `sign_${door.id}_${side.other}`;
      root.add(sign);
    }
  }

  /* ------------------------------------------------------ hull hatches -- */
  // Welded plate over the airlock's aft bulkhead. Scenery for now; venting is M4.
  for (const hatch of ship.hatches ?? []) {
    const g = new THREE.Group();
    g.name = `hatch_${hatch.id}`;
    g.position.set(hatch.at[0], 0, hatch.at[1]);
    g.rotation.y = hatch.facing;

    const plate = mesh(new THREE.BoxGeometry(3.4, 2.5, 0.14), mats.reactor);
    plate.position.y = 1.35;
    g.add(plate);

    const trim = mesh(new THREE.BoxGeometry(3.7, 0.26, 0.05), mats.hazard, { cast: false });
    trim.position.set(0, 2.62, 0.1);
    g.add(trim);

    const wheel = mesh(new THREE.TorusGeometry(0.42, 0.055, 8, 20), mats.propMetal);
    wheel.position.set(0, 1.35, 0.16);
    g.add(wheel);

    for (const [x, y] of [
      [-1.5, 0.22],
      [1.5, 0.22],
      [-1.5, 2.48],
      [1.5, 2.48],
    ]) {
      const bolt = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 6), mats.propMetal, { cast: false });
      bolt.rotation.x = Math.PI / 2;
      bolt.position.set(x, y, 0.1);
      g.add(bolt);
    }

    root.add(g);
  }

  /* ------------------------------------------------------- pipes & ribs -- */
  const pipeGeos = [];
  for (const [x, r, y] of [
    [8.34, 0.085, 2.86],
    [11.66, 0.075, 2.9],
    [8.42, 0.05, 2.72],
  ]) {
    pipeGeos.push(cylGeo(r, r, 22.4, 10, x, y, 12.2, 'z'));
  }
  // reactor run
  pipeGeos.push(cylGeo(0.1, 0.1, 9.2, 10, 19.3, 2.9, 9, 'z'));
  pipeGeos.push(cylGeo(0.07, 0.07, 9.2, 8, 12.8, 2.75, 9, 'z'));
  addMerged(root, pipeGeos, mats.propMetal, 'pipes');
  stats.drawGroups++;

  const ribGeos = [];
  for (let z = 2; z <= 22; z += 4) {
    ribGeos.push(boxGeo(0.16, WALL_H, 0.42, 8.1, WALL_H / 2, z));
    ribGeos.push(boxGeo(0.16, WALL_H, 0.42, 11.9, WALL_H / 2, z));
  }
  addMerged(root, ribGeos, mats.propMetal, 'ribs');
  stats.drawGroups++;

  /* --------------------------------------------------------- wall vents -- */
  for (const [x, z, ry] of [
    [11.86, 7.4, -Math.PI / 2],
    [8.14, 19.4, Math.PI / 2],
  ]) {
    const vent = new THREE.Group();
    vent.position.set(x, 1.9, z);
    vent.rotation.y = ry;
    const plate = mesh(new THREE.BoxGeometry(0.9, 0.62, 0.05), mats.propDark, { cast: false });
    vent.add(plate);
    for (let i = 0; i < 5; i++) {
      const slot = mesh(new THREE.BoxGeometry(0.72, 0.05, 0.03), mats.propMetal, { cast: false });
      slot.position.set(0, -0.2 + i * 0.1, 0.04);
      vent.add(slot);
    }
    root.add(vent);
  }

  /* -------------------------------------------------------------- lookup -- */
  const roomAt = (wx, wz) => grid.roomAtCell(Math.floor(wx / C), Math.floor(wz / C));

  const box = new THREE.Box3().setFromObject(root);
  stats.bounds = {
    min: box.min.toArray().map((n) => +n.toFixed(1)),
    max: box.max.toArray().map((n) => +n.toFixed(1)),
  };

  return { grid, root, fixtures, consoles, staticBody, roomAt, stats };
}

/**
 * Keeps a small pool of real point lights on the fixtures nearest the player.
 * Every other fixture is emissive-only, which is what keeps a 16-lamp ship
 * inside the forward renderer's light budget.
 */
export class LightPool {
  constructor({ scene, fixtures, count = CONFIG.LIGHTS_IN_POOL }) {
    this.fixtures = fixtures;
    this.lights = [];
    this._timer = 0;
    for (let i = 0; i < count; i++) {
      const light = new THREE.PointLight(0xffdfae, 0, 18, 1.65);
      light.castShadow = false;
      light.userData.fixture = null;
      light.userData.target = 0;
      scene.add(light);
      this.lights.push(light);
    }
  }

  update(dt, playerPos, power) {
    this._timer += dt;
    if (this._timer > 0.25) {
      this._timer = 0;
      this.#rank(playerPos, power);
    }
    const k = Math.min(1, dt * 10);
    for (const light of this.lights) {
      light.intensity += (light.userData.target - light.intensity) * k;
    }
  }

  #rank(playerPos, power) {
    const scored = [];
    for (const f of this.fixtures) {
      const level = power.level(f.circuit);
      if (level <= 0.02) continue;
      scored.push({ f, level, d: f.position.distanceToSquared(playerPos) });
    }
    scored.sort((a, b) => a.d - b.d);
    const chosen = scored.slice(0, this.lights.length);
    const assigned = new Set();

    // keep stable assignments first (prevents light popping while walking)
    for (const light of this.lights) {
      const held = light.userData.fixture;
      const hit = held && chosen.find((c) => c.f === held);
      if (hit) {
        assigned.add(held);
        const glow = power.level(held.circuit);
        light.userData.target = 8 * glow * (hit.f.baseIntensity / 2.4);
      }
    }
    for (const light of this.lights) {
      if (light.userData.fixture && assigned.has(light.userData.fixture)) continue;
      const next = chosen.find((c) => !assigned.has(c.f));
      if (next) {
        assigned.add(next.f);
        light.userData.fixture = next.f;
        light.position.copy(next.f.position);
        light.color.setHex(next.f.color);
        light.userData.target = 8 * next.level * (next.f.baseIntensity / 2.4);
        light.intensity = 0; // fade in from the new position
      } else {
        light.userData.fixture = null;
        light.userData.target = 0;
      }
    }
  }
}
