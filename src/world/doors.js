/**
 * world/doors.js
 * Sliding doors with a physical presence.
 *
 * Behaviour:
 *   powered   -> opens automatically when a player is close and roughly in front
 *   unpowered -> stays shut and must be PRIED (hold E) for PRY_SECONDS
 *   heavy/airlock -> thicker panels, hazard trim, louder servo
 *
 * Each panel is a kinematic Rapier body, so an open door is a real gap and a
 * closed door is a real wall for the character controller.
 */
import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { addCubeCollider, mesh } from './geom.js';

const C = CONFIG.CELL;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

export class Doors {
  constructor({ scene, world, RAPIER, mats, ship, bus }) {
    this.scene = scene;
    this.world = world;
    this.RAPIER = RAPIER;
    this.mats = mats;
    this.bus = bus;
    this.records = [];
    this.byId = new Map();

    for (const spec of ship.doors) {
      const record = this.#create(spec, ship);
      this.records.push(record);
      this.byId.set(record.id, record);
    }
  }

  #create(spec, ship) {
    const width = (spec.end - spec.start) * C;
    const spanMid = ((spec.start + spec.end) / 2) * C;
    const isX = spec.axis === 'x'; // opening spans world Z
    const center = new THREE.Vector3(
      isX ? spec.line * C : spanMid,
      0,
      isX ? spanMid : spec.line * C
    );
    const rotY = isX ? Math.PI / 2 : 0;
    const dir = new THREE.Vector3(1, 0, 0).applyAxisAngle(Y_AXIS, rotY);
    const normal = new THREE.Vector3(0, 0, 1).applyAxisAngle(Y_AXIS, rotY);

    const heavy = spec.kind === 'heavy' || spec.kind === 'airlock';
    const panelW = width / 2;
    const thickness = heavy ? CONFIG.DOOR_THICKNESS * 1.6 : CONFIG.DOOR_THICKNESS;
    const panelMat = heavy ? this.mats.reactor : this.mats.propMetal;

    const record = {
      id: spec.id,
      kind: spec.kind ?? 'standard',
      a: spec.a,
      b: spec.b,
      width,
      center,
      dir,
      normal,
      rotY,
      openness: 0,
      opennessTarget: 0,
      holdOpen: false,
      powered: true,
      state: 'closed',
      panels: [],
      pryProgress: 0,
      lastSound: 0,
    };

    /* -------- frame (static, decorative; the grid provides the real wall) -- */
    const frame = new THREE.Group();
    frame.position.copy(center);
    frame.rotation.y = rotY;

    const postMat = this.mats.propDark;
    for (const sign of [-1, 1]) {
      const post = mesh(new THREE.BoxGeometry(0.14, CONFIG.DOOR_HEIGHT, thickness + 0.1), postMat);
      post.position.set(sign * (width / 2 - 0.02), CONFIG.DOOR_HEIGHT / 2, 0);
      frame.add(post);
    }
    const header = mesh(
      new THREE.BoxGeometry(width, 0.16, thickness + 0.1),
      postMat
    );
    header.position.set(0, CONFIG.DOOR_HEIGHT + 0.06, 0);
    frame.add(header);

    if (heavy) {
      const trim = mesh(new THREE.BoxGeometry(width * 0.92, 0.22, 0.02), this.mats.hazard, { cast: false });
      trim.position.set(0, 0.22, thickness / 2 + 0.01);
      frame.add(trim);
    }
    this.scene.add(frame);

    /* ------------------------------- panels ------------------------------ */
    const panelRoot = new THREE.Group();
    panelRoot.name = spec.id;
    this.scene.add(panelRoot);

    for (let i = 0; i < 2; i++) {
      const sign = i === 0 ? -1 : 1;
      const panel = mesh(new THREE.BoxGeometry(panelW, CONFIG.DOOR_HEIGHT, thickness), panelMat);
      panel.name = `${spec.id}_panel${i}`;
      panel.rotation.y = rotY;

      const closedX = sign * panelW * 0.5;
      const worldPos = center.clone().add(dir.clone().multiplyScalar(closedX));
      panel.position.set(worldPos.x, CONFIG.DOOR_HEIGHT / 2, worldPos.z);
      panelRoot.add(panel);

      if (heavy) {
        const stripe = mesh(new THREE.BoxGeometry(panelW * 0.9, 0.18, 0.02), this.mats.hazard, {
          cast: false,
        });
        stripe.position.set(0, CONFIG.DOOR_HEIGHT / 2 - 0.34, thickness / 2 + 0.012);
        panel.add(stripe);
      }

      const body = this.world.createRigidBody(
        this.RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
          worldPos.x,
          CONFIG.DOOR_HEIGHT / 2,
          worldPos.z
        )
      );
      const q = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, rotY);
      body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
      this.world.createCollider(
        this.RAPIER.ColliderDesc.cuboid(panelW / 2, CONFIG.DOOR_HEIGHT / 2, thickness / 2).setFriction(
          0.6
        ),
        body
      );

      record.panels.push({ mesh: panel, body, sign, closedX });
    }

    record.interactable = {
      id: `door:${spec.id}`,
      object: panelRoot,
      hold: () => (record.powered || record.openness > 0.05 ? 0 : CONFIG.PRY_SECONDS),
      label: () =>
        record.openness > 0.95
          ? `${this.#nameOf(spec)} — open`
          : record.powered
          ? `${this.#nameOf(spec)} — automatic`
          : `${this.#nameOf(spec)} — NO POWER, pry it`,
      verb: () => (record.powered ? 'Hold open' : 'Pry'),
      enabled: () => true,
      onUse: () => {
        if (!record.powered) {
          this.#forceOpen(record);
        } else {
          record.holdOpen = !record.holdOpen;
          this.bus.emit('audio:cue', { cue: 'beep', opts: { ok: true } });
        }
      },
      onHold: (dt, t) => {
        if (record.powered) return;
        record.pryProgress = Math.min(1, t / CONFIG.PRY_SECONDS);
        if (Math.random() < dt * 9) this.bus.emit('audio:cue', { cue: 'pry' });
        if (record.pryProgress >= 1) this.#forceOpen(record);
      },
    };

    return record;
  }

  #nameOf(spec) {
    const pretty = (id) => (id === 'VOID' ? 'Hull' : id.charAt(0) + id.slice(1).toLowerCase());
    return `${pretty(spec.a)} ⇄ ${pretty(spec.b)} door`;
  }

  #forceOpen(record) {
    if (record.forced) return;
    record.holdOpen = true;
    record.opennessTarget = 1;
    record.pryProgress = 0;
    record.forced = true;
    this.bus.emit('audio:cue', { cue: 'doorClunk' });
    this.bus.emit('ui:prompt', { text: 'Door forced — it will not reseal', tone: 'warn' });
  }

  #setState(record, state) {
    if (record.state === state) return;
    record.state = state;
    this.bus.emit('door:state', { doorId: record.id, state, powered: record.powered });
  }

  fixedUpdate(dt, playerPos, power) {
    for (const record of this.records) {
      // Discrete flag, not the flicker level: otherwise a tripping breaker would
      // toggle every door's powered state dozens of times per second.
      const pwr = power.isLive('D');
      if (pwr !== record.powered) {
        record.powered = pwr;
        if (!pwr) {
          record.holdOpen = false;
          this.bus.emit('ui:prompt', { text: 'Door servos offline', tone: 'warn' });
        }
      }

      // proximity trigger, gated to one side of the doorway plane
      const rel = new THREE.Vector3(
        playerPos.x - record.center.x,
        0,
        playerPos.z - record.center.z
      );
      const along = rel.dot(record.dir);
      const normal = rel.dot(record.normal);
      const nearEnough =
        Math.abs(along) < record.width / 2 + 0.9 && Math.abs(normal) < CONFIG.DOOR_TRIGGER_RADIUS;

      if (record.powered && nearEnough && !record.holdOpen) record.opennessTarget = 1;
      else if (record.powered && record.holdOpen) record.opennessTarget = 1;
      else if (!record.powered && record.forced) record.opennessTarget = 1;
      else record.opennessTarget = 0;

      if (record.forced && record.powered) record.forced = false; // power restores normal logic

      const speed = record.opennessTarget > record.openness ? 2.4 : 1.8; // units per second
      const before = record.openness;
      if (Math.abs(record.opennessTarget - record.openness) > 0.001) {
        const step = Math.sign(record.opennessTarget - record.openness) * speed * dt;
        record.openness = THREE.MathUtils.clamp(record.openness + step, 0, 1);
      }

      if (before < 0.02 && record.openness >= 0.02) {
        this.#setState(record, 'opening');
        this.bus.emit('audio:cue', { cue: 'door', opts: { open: true } });
      } else if (before > 0.98 && record.openness <= 0.98) {
        this.#setState(record, 'closing');
        this.bus.emit('audio:cue', { cue: 'door', opts: { open: false } });
      } else if (record.openness >= 0.999 && record.state !== 'open') {
        this.#setState(record, 'open');
      } else if (record.openness <= 0.001 && record.state !== 'closed') {
        this.#setState(record, 'closed');
      }

      // push panels along the doorway axis
      for (const panel of record.panels) {
        const offset = panel.closedX + panel.sign * (record.width / 2) * record.openness;
        const wx = record.center.x + record.dir.x * offset;
        const wz = record.center.z + record.dir.z * offset;
        panel.body.setNextKinematicTranslation({ x: wx, y: CONFIG.DOOR_HEIGHT / 2, z: wz });
        panel.mesh.position.set(wx, CONFIG.DOOR_HEIGHT / 2, wz);
      }
    }
  }

  /** Doors whose props the interaction system can raycast. */
  interactables() {
    return this.records.map((r) => r.interactable);
  }
}
