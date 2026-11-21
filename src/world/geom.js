/**
 * world/geom.js
 * Geometry helpers shared by the ship builder and prop set dressing.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Box geometry already translated/rotated into world space, ready to merge. */
export function boxGeo(w, h, d, x = 0, y = 0, z = 0, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

export function cylGeo(r1, r2, h, seg, x = 0, y = 0, z = 0, axis = 'y') {
  const g = new THREE.CylinderGeometry(r1, r2, h, seg);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

/**
 * Replaces UVs with world-aligned projections so merged walls and floors tile
 * without stretching, regardless of how long each run is.
 * @param {THREE.BufferGeometry} geo
 * @param {number} scale  UV units per metre (1 / texture metres)
 */
export function applyWorldUV(geo, scale) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);

  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    const nz = Math.abs(nor.getZ(i));

    let u;
    let v;
    if (ny >= nx && ny >= nz) {
      u = px * scale; // floor / ceiling
      v = pz * scale;
    } else if (nx >= nz) {
      u = pz * scale; // wall facing X
      v = py * scale;
    } else {
      u = px * scale; // wall facing Z
      v = py * scale;
    }
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }

  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/**
 * Merge a list of geometries into one. Returns null for an empty list so callers
 * can skip creating an empty mesh.
 */
export function mergeAll(geometries) {
  if (!geometries.length) return null;
  const merged = mergeGeometries(geometries, false);
  for (const g of geometries) g.dispose();
  if (!merged) return null;
  merged.computeBoundingSphere();
  return merged;
}

/** Adds a static cuboid collider to an existing fixed body. */
export function addCubeCollider(RAPIER, world, body, { w, h, d, x, y, z, ry = 0, friction = 0.95 }) {
  const desc = RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2)
    .setTranslation(x, y, z)
    .setFriction(friction);
  if (ry) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
    desc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
  }
  return world.createCollider(desc, body);
}

/** Simple mesh factory with shadow flags. */
export function mesh(geometry, material, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}
