/**
 * world/power.js
 * Four circuits, one breaker panel, and a flicker choreography that makes
 * switching a breaker feel like it does something physical.
 *
 *   A  fore lights      (Bridge, Corridor, Airlock)
 *   B  habitat lights   (MedBay, Quarters)
 *   C  industrial lights(Cargo, Reactor)
 *   D  door servos      (all doors)
 */
import * as THREE from 'three';
import { mesh } from './geom.js';

const CIRCUIT_IDS = ['A', 'B', 'C', 'D'];

export class PowerSystem {
  constructor({ scene, mats, ship, bus }) {
    this.bus = bus;
    this.scene = scene;
    this.mats = mats;
    /** @type {Map<string, {id:string, live:boolean, level:number, flicker:number, pending:boolean, phase:number}>} */
    this.circuits = new Map();
    for (const id of CIRCUIT_IDS) {
      this.circuits.set(id, { id, live: true, level: 1, flicker: 0, pending: true, phase: Math.random() * 6 });
    }
    this.breakers = [];
    this.#buildPanel(ship);
    this._ambience = 1;
  }

  level(circuit) {
    return this.circuits.get(circuit)?.level ?? 1;
  }

  isLive(circuit) {
    return !!this.circuits.get(circuit)?.live;
  }

  /** Aggregate for the audio bed (engine hum follows real power). */
  ambience() {
    const a = this.level('A');
    const b = this.level('B');
    const c = this.level('C');
    return (a + b + c) / 3;
  }

  #buildPanel(ship) {
    const spec = ship.breakerPanel;
    const panel = new THREE.Group();
    panel.name = 'breaker_panel';
    panel.position.set(spec.at[0], 0, spec.at[1]);
    panel.rotation.y = spec.facing;
    this.scene.add(panel);

    const plate = mesh(new THREE.BoxGeometry(0.98, 1.62, 0.09), this.mats.propDark);
    plate.position.set(0, 1.62, 0);
    panel.add(plate);

    const inner = mesh(new THREE.BoxGeometry(0.86, 1.46, 0.03), new THREE.MeshStandardMaterial({
      color: 0x2a2e2c,
      metalness: 0.6,
      roughness: 0.6,
    }));
    inner.position.set(0, 1.62, 0.055);
    panel.add(inner);

    // panel header lamp
    const headerLamp = mesh(
      new THREE.BoxGeometry(0.62, 0.035, 0.02),
      new THREE.MeshStandardMaterial({
        color: 0x2a2418,
        emissive: 0xffd27a,
        emissiveIntensity: 1.2,
        metalness: 0.2,
        roughness: 0.5,
      }),
      { cast: false }
    );
    headerLamp.position.set(0, 2.26, 0.075);
    panel.add(headerLamp);

    ship.breakers.forEach((brk, i) => {
      const y = 2.02 - i * 0.27;

      const label = mesh(new THREE.BoxGeometry(0.46, 0.09, 0.012), this.mats.propMetal, { cast: false });
      label.position.set(-0.14, y, 0.072);
      panel.add(label);

      const breaker = new THREE.Group();
      breaker.position.set(0.3, y, 0.07);
      panel.add(breaker);

      const lever = mesh(new THREE.BoxGeometry(0.1, 0.17, 0.08), this.mats.propMetal);
      lever.position.z = 0.04;
      lever.rotation.x = -0.5;
      breaker.add(lever);

      const indicatorMat = new THREE.MeshStandardMaterial({
        color: 0x1a1f1a,
        emissive: 0x49ff8a,
        emissiveIntensity: 1.6,
        metalness: 0.1,
        roughness: 0.4,
      });
      const indicator = mesh(new THREE.BoxGeometry(0.05, 0.03, 0.012), indicatorMat, { cast: false });
      indicator.position.set(0, -0.11, 0.045);
      breaker.add(indicator);

      this.breakers.push({
        id: brk.id,
        circuit: brk.circuit,
        label: brk.label,
        lever,
        indicator,
        indicatorMat,
        root: breaker,
      });
    });
  }

  toggle(id) {
    const brk = this.breakers.find((b) => b.id === id);
    if (!brk) return;
    const c = this.circuits.get(brk.circuit);
    c.pending = !c.live;
    c.flicker = 0.7;
    c.phase = 0;

    brk.lever.rotation.x = c.pending ? -0.5 : 0.5;
    brk.indicatorMat.emissive.setHex(c.pending ? 0x49ff8a : 0xff5533);
    brk.indicatorMat.emissiveIntensity = 1.6;

    this.bus.emit('audio:cue', { cue: 'breaker', opts: { on: c.pending } });
    this.bus.emit('power:flicker', { circuit: c.id, seconds: 0.7, live: c.pending });
    this.bus.emit('ui:prompt', {
      text: `${brk.label}: ${c.pending ? 'energising' : 'tripping'}`,
      tone: c.pending ? 'ok' : 'warn',
    });
  }

  fixedUpdate(dt) {
    for (const c of this.circuits.values()) {
      if (c.flicker > 0) {
        c.flicker -= dt;
        c.phase += dt * 43;
        // stuttering incandescent decay while the relay settles
        const on = Math.sin(c.phase) + Math.sin(c.phase * 2.7) * 0.5 > 0;
        c.level = c.pending ? (on ? 1 : 0.08) : on ? 0.05 : 0.22;

        if (c.flicker <= 0) {
          c.live = c.pending;
          c.level = c.live ? 1 : 0;
          this.bus.emit('power:circuit', { circuit: c.id, live: c.live, reason: 'breaker' });
          if (c.id === 'D') {
            this.bus.emit('ui:prompt', {
              text: c.live ? 'Door servos restored' : 'Door servos dead — doors must be pried',
              tone: c.live ? 'ok' : 'warn',
            });
          }
        }
      } else {
        const target = c.live ? 1 : 0;
        c.level += (target - c.level) * Math.min(1, dt * 5);
      }
    }
  }

  interactables() {
    return this.breakers.map((brk) => ({
      id: `breaker:${brk.id}`,
      object: brk.root,
      label: () => `${brk.label} — ${this.circuits.get(brk.circuit).live ? 'LIVE' : 'TRIPPED'}`,
      verb: 'Toggle breaker',
      hold: 0,
      enabled: () => true,
      onUse: () => this.toggle(brk.id),
    }));
  }
}
