/**
 * world/decor.js
 * Instantiates a decor plan (see decorplan.js) into merged geometry.
 *
 * Everything is static and flush to the wall, so decoration adds ZERO colliders
 * and three draw calls: dark plating, bright metal, hazard trim.
 */
import * as THREE from 'three';
import { mergeAll } from './geom.js';

function place(geometry, item) {
  geometry.rotateY(item.yaw);
  geometry.translate(item.x, item.y, item.z);
  return geometry;
}

export function buildDecor({ mats, plan, name = 'decor' }) {
  const buckets = { dark: [], metal: [], hazard: [] };

  for (const item of plan.items) {
    switch (item.type) {
      case 'vent': {
        // recessed backing plate
        const plate = new THREE.BoxGeometry(item.w, item.h, item.d);
        buckets.dark.push(place(plate, item));

        // louvres stand slightly proud of the plate
        const louvres = 5;
        for (let i = 0; i < louvres; i++) {
          const slat = new THREE.BoxGeometry(item.w * 0.8, 0.05, 0.028);
          slat.translate(0, -0.19 + i * 0.095, item.d / 2 + 0.012);
          buckets.metal.push(place(slat, item));
        }

        // corner screws
        for (const [sx, sy] of [
          [-1, 1],
          [1, 1],
          [-1, -1],
          [1, -1],
        ]) {
          const screw = new THREE.CylinderGeometry(0.018, 0.018, 0.02, 6);
          screw.rotateX(Math.PI / 2);
          screw.translate(sx * (item.w / 2 - 0.05), sy * (item.h / 2 - 0.05), item.d / 2 + 0.01);
          buckets.metal.push(place(screw, item));
        }
        break;
      }

      case 'junction': {
        const box = new THREE.BoxGeometry(item.w, item.h, item.d);
        buckets.dark.push(place(box, item));

        const lip = new THREE.BoxGeometry(item.w * 0.92, 0.035, 0.03);
        lip.translate(0, item.h / 2 - 0.05, item.d / 2 + 0.01);
        buckets.metal.push(place(lip, item));

        for (const sy of [-0.13, 0.13]) {
          const grommet = new THREE.CylinderGeometry(0.032, 0.032, 0.05, 8);
          grommet.rotateX(Math.PI / 2);
          grommet.translate(0, sy, item.d / 2 + 0.02);
          buckets.metal.push(place(grommet, item));
        }
        break;
      }

      case 'conduit': {
        // Local +Z is the wall NORMAL (yaw is atan2(normal.x, normal.z)), so the
        // pipe has to run along local X -- the wall tangent -- or it spears out
        // into the room. Rotating about Z puts the cylinder's length on X.
        const pipe = new THREE.CylinderGeometry(item.w / 2, item.w / 2, item.d, 8);
        pipe.rotateZ(Math.PI / 2);
        buckets.metal.push(place(pipe, item));

        for (const sx of [-item.d * 0.32, item.d * 0.32]) {
          const bracket = new THREE.BoxGeometry(0.06, 0.1, 0.16);
          bracket.translate(sx, 0, 0.03);
          buckets.dark.push(place(bracket, item));
        }
        break;
      }

      case 'placard': {
        const plate = new THREE.BoxGeometry(item.w, item.h, item.d);
        buckets.hazard.push(place(plate, item));
        break;
      }

      default:
        break;
    }
  }

  const group = new THREE.Group();
  group.name = name;

  const mapping = [
    ['dark', mats.propDark, 'decor_dark'],
    ['metal', mats.propMetal, 'decor_metal'],
    ['hazard', mats.hazard, 'decor_hazard'],
  ];

  const meshes = [];
  for (const [bucket, material, meshName] of mapping) {
    const merged = mergeAll(buckets[bucket]);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = meshName;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    meshes.push(mesh);
  }

  return { group, meshes, stats: { drawCalls: meshes.length, items: plan.items.length } };
}
