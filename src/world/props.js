/**
 * world/props.js
 * Physical set dressing. Static props are colliders on the ship body; the
 * handful of flagged dynamic props are real rigid bodies, which is what proves
 * the physics loop works before Milestone 2 adds pickup and throwing.
 */
import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';
import { addCubeCollider, mesh } from './geom.js';

export function buildProps({ scene, world, RAPIER, mats, ship, shipBody }) {
  const group = new THREE.Group();
  group.name = 'props';
  scene.add(group);

  const dynamic = [];
  const rnd = mulberry32(0xb0a7);

  const addStatic = (object, x, z, ry, colliders) => {
    object.position.set(x, 0, z);
    object.rotation.y = ry;
    group.add(object);
    for (const c of colliders) {
      addCubeCollider(RAPIER, world, shipBody, {
        w: c.w,
        h: c.h,
        d: c.d,
        x: x + (c.ox ?? 0),
        y: c.y,
        z: z + (c.oz ?? 0),
        ry: ry + (c.ry ?? 0),
      });
    }
  };

  const addDynamic = ({ object, half, x, y, z, ry, shape = 'box', density = 260 }) => {
    object.position.set(x, y, z);
    object.rotation.y = ry;
    group.add(object);

    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .setLinearDamping(0.35)
        .setAngularDamping(0.65)
        .setCcdEnabled(true)
    );
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
    body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);

    const desc =
      shape === 'cylinder'
        ? RAPIER.ColliderDesc.cylinder(half[1], half[0])
        : RAPIER.ColliderDesc.cuboid(half[0], half[1], half[2]);
    world.createCollider(desc.setDensity(density).setFriction(0.85), body);

    dynamic.push({ mesh: object, body });
  };

  /* -------------------------------------------------------------- makers -- */

  const crate = (scale = 1, paint = true) => {
    const g = new THREE.Group();
    const s = 0.88 * scale;
    const box = mesh(new THREE.BoxGeometry(s, s, s), paint ? mats.propPaint : mats.propMetal);
    g.add(box);
    for (const z of [-0.3 * scale, 0.3 * scale]) {
      const strap = mesh(new THREE.BoxGeometry(s * 1.02, 0.09 * scale, 0.08 * scale), mats.propDark);
      strap.position.set(0, 0, z);
      g.add(strap);
    }
    const lid = mesh(new THREE.BoxGeometry(s * 0.9, 0.03 * scale, s * 0.9), mats.propMetal);
    lid.position.y = s / 2 + 0.015;
    g.add(lid);
    return { object: g, half: [s / 2, s / 2, s / 2] };
  };

  const barrel = () => {
    const g = new THREE.Group();
    const body = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 14), mats.propPaint);
    g.add(body);
    for (const y of [-0.28, 0.28]) {
      const ring = mesh(new THREE.CylinderGeometry(0.315, 0.315, 0.07, 14), mats.propDark);
      ring.position.y = y;
      g.add(ring);
    }
    return { object: g, half: [0.3, 0.45, 0.3] };
  };

  const bed = () => {
    const g = new THREE.Group();
    const frame = mesh(new THREE.BoxGeometry(0.92, 0.16, 1.95), mats.propMetal);
    frame.position.y = 0.5;
    g.add(frame);
    const mattress = mesh(new THREE.BoxGeometry(0.84, 0.14, 1.8), mats.propWhite);
    mattress.position.y = 0.63;
    g.add(mattress);
    const pillow = mesh(new THREE.BoxGeometry(0.6, 0.1, 0.34), mats.propWhite);
    pillow.position.set(0, 0.72, -0.68);
    g.add(pillow);
    for (const [x, z] of [
      [-0.4, -0.85],
      [0.4, -0.85],
      [-0.4, 0.85],
      [0.4, 0.85],
    ]) {
      const leg = mesh(new THREE.BoxGeometry(0.08, 0.44, 0.08), mats.propMetal);
      leg.position.set(x, 0.22, z);
      g.add(leg);
    }
    return { object: g, colliders: [{ w: 0.95, h: 0.72, d: 1.95, y: 0.36 }] };
  };

  const bunk = () => {
    const g = new THREE.Group();
    for (const y of [0.55, 1.6]) {
      const frame = mesh(new THREE.BoxGeometry(1.0, 0.16, 2.0), mats.propMetal);
      frame.position.y = y;
      g.add(frame);
      const mattress = mesh(new THREE.BoxGeometry(0.92, 0.16, 1.9), mats.propWhite);
      mattress.position.y = y + 0.15;
      g.add(mattress);
    }
    for (const [x, z] of [
      [-0.46, -0.94],
      [0.46, -0.94],
      [-0.46, 0.94],
      [0.46, 0.94],
    ]) {
      const post = mesh(new THREE.BoxGeometry(0.08, 1.9, 0.08), mats.propMetal);
      post.position.set(x, 0.95, z);
      g.add(post);
    }
    return { object: g, colliders: [{ w: 1.0, h: 1.75, d: 2.0, y: 0.88 }] };
  };

  const locker = () => {
    const g = new THREE.Group();
    const body = mesh(new THREE.BoxGeometry(0.62, 1.92, 0.46), mats.propDark);
    body.position.y = 0.96;
    g.add(body);
    const door = mesh(new THREE.BoxGeometry(0.54, 1.78, 0.03), mats.propMetal);
    door.position.set(0, 0.98, 0.245);
    g.add(door);
    const handle = mesh(new THREE.BoxGeometry(0.05, 0.22, 0.05), mats.propDark);
    handle.position.set(0.21, 1.0, 0.27);
    g.add(handle);
    for (let i = 0; i < 3; i++) {
      const vent = mesh(new THREE.BoxGeometry(0.34, 0.02, 0.02), mats.propDark, { cast: false });
      vent.position.set(0, 1.62 + i * 0.06, 0.262);
      g.add(vent);
    }
    return { object: g, colliders: [{ w: 0.62, h: 1.92, d: 0.46, y: 0.96 }] };
  };

  const chair = () => {
    const g = new THREE.Group();
    const seat = mesh(new THREE.BoxGeometry(0.52, 0.1, 0.52), mats.propPlastic);
    seat.position.y = 0.45;
    g.add(seat);
    const back = mesh(new THREE.BoxGeometry(0.52, 0.58, 0.09), mats.propPlastic);
    back.position.set(0, 0.75, -0.22);
    g.add(back);
    const post = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 8), mats.propMetal);
    post.position.y = 0.23;
    g.add(post);
    const base = mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.06, 10), mats.propMetal);
    base.position.y = 0.03;
    g.add(base);
    return { object: g, colliders: [{ w: 0.55, h: 1.05, d: 0.55, y: 0.52 }] };
  };

  const core = () => {
    const g = new THREE.Group();
    const base = mesh(new THREE.CylinderGeometry(1.55, 1.7, 0.22, 20), mats.propDark);
    base.position.y = 0.11;
    g.add(base);
    const housing = mesh(new THREE.CylinderGeometry(1.25, 1.25, 2.1, 20), mats.reactor);
    housing.position.y = 1.2;
    g.add(housing);
    const glowMat = mats.reactorGlow.clone();
    glowMat.emissiveIntensity = 2.6;
    for (const y of [0.55, 1.2, 1.85]) {
      const band = mesh(new THREE.CylinderGeometry(1.29, 1.29, 0.09, 20), glowMat, { cast: false });
      band.position.y = y;
      g.add(band);
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const strut = mesh(new THREE.BoxGeometry(0.12, 2.3, 0.12), mats.propMetal);
      strut.position.set(Math.cos(a) * 1.32, 1.2, Math.sin(a) * 1.32);
      g.add(strut);
    }
    const cap = mesh(new THREE.CylinderGeometry(0.55, 0.9, 0.4, 16), mats.propDark);
    cap.position.y = 2.45;
    g.add(cap);
    return {
      object: g,
      colliders: [{ w: 2.6, h: 2.6, d: 2.6, y: 1.3 }],
      glowMat,
    };
  };

  const pallet = () => {
    const g = new THREE.Group();
    const deck = mesh(new THREE.BoxGeometry(1.3, 0.06, 1.2), mats.propPaint);
    deck.position.y = 0.16;
    g.add(deck);
    for (let i = 0; i < 5; i++) {
      const slat = mesh(new THREE.BoxGeometry(0.18, 0.12, 1.2), mats.propPaint);
      slat.position.set(-0.52 + i * 0.26, 0.06, 0);
      g.add(slat);
    }
    return { object: g, colliders: [{ w: 1.3, h: 0.24, d: 1.2, y: 0.12 }] };
  };

  const extinguisher = () => {
    const g = new THREE.Group();
    const body = mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 0.46, 10),
      new THREE.MeshStandardMaterial({ color: 0x8f1f16, metalness: 0.4, roughness: 0.45 })
    );
    body.position.y = 0.95;
    g.add(body);
    const nozzle = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 6), mats.propDark);
    nozzle.position.set(0, 1.22, 0);
    g.add(nozzle);
    const bracket = mesh(new THREE.BoxGeometry(0.16, 0.06, 0.1), mats.propDark);
    bracket.position.set(0, 1.12, -0.09);
    g.add(bracket);
    return { object: g, colliders: [] };
  };

  const toolcrate = () => {
    const g = new THREE.Group();
    const body = mesh(new THREE.BoxGeometry(0.68, 0.44, 0.44), mats.propPaint);
    g.add(body);
    const lid = mesh(new THREE.BoxGeometry(0.7, 0.04, 0.46), mats.propDark);
    lid.position.y = 0.24;
    g.add(lid);
    const handle = mesh(new THREE.BoxGeometry(0.2, 0.05, 0.05), mats.propMetal);
    handle.position.y = 0.3;
    g.add(handle);
    return { object: g, half: [0.34, 0.22, 0.22] };
  };

  /* ----------------------------------------------------------- placement -- */

  for (const prop of ship.props) {
    const [x, z] = prop.at;
    const ry = prop.ry ?? 0;

    switch (prop.kind) {
      case 'crate': {
        const c = crate(1, true);
        if (prop.dynamic) addDynamic({ ...c, x, y: 0.46, z, ry });
        else addStatic(c.object, x, z, ry, [{ w: 0.9, h: 0.9, d: 0.9, y: 0.45 }]);
        break;
      }
      case 'toolcrate': {
        const c = toolcrate();
        if (prop.dynamic) addDynamic({ ...c, x, y: 0.24, z, ry });
        else addStatic(c.object, x, z, ry, [{ w: 0.68, h: 0.44, d: 0.44, y: 0.22 }]);
        break;
      }
      case 'barrel': {
        const b = barrel();
        if (prop.dynamic) addDynamic({ ...b, x, y: 0.5, z, ry, shape: 'cylinder' });
        else addStatic(b.object, x, z, ry, [{ w: 0.62, h: 0.9, d: 0.62, y: 0.45 }]);
        break;
      }
      case 'bed': {
        const b = bed();
        addStatic(b.object, x, z, ry, b.colliders);
        break;
      }
      case 'bunk': {
        const b = bunk();
        addStatic(b.object, x, z, ry, b.colliders);
        break;
      }
      case 'locker': {
        const l = locker();
        addStatic(l.object, x, z, ry, l.colliders);
        break;
      }
      case 'chair': {
        const c = chair();
        addStatic(c.object, x, z, ry, c.colliders);
        break;
      }
      case 'core': {
        const c = core();
        addStatic(c.object, x, z, ry, c.colliders);
        // pulse the reactor bands
        dynamic.push({
          mesh: null,
          body: null,
          pulse: { mat: c.glowMat, base: 2.6, phase: rnd() * 6 },
        });
        break;
      }
      case 'pallet': {
        const p = pallet();
        addStatic(p.object, x, z, ry, p.colliders);
        break;
      }
      case 'extinguisher': {
        const e = extinguisher();
        addStatic(e.object, x, z, ry, []);
        break;
      }
      default:
        console.warn(`[props] unknown prop kind "${prop.kind}"`);
    }
  }

  return { group, dynamic };
}
