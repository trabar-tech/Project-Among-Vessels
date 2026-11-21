/**
 * world/interaction.js
 * Diegetic hover + use. One raycast from the screen centre at INTERACT_HZ,
 * a reusable wireframe highlight, and press-or-hold verbs.
 */
import * as THREE from 'three';
import { CONFIG } from '../core/config.js';

export class Interaction {
  constructor({ camera, bus, scene }) {
    this.camera = camera;
    this.bus = bus;
    this.scene = scene;

    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = CONFIG.INTERACT_DISTANCE;
    this.raycaster.near = 0.02;

    /** @type {Map<string, any>} */
    this.specs = new Map();
    this.roots = [];

    this.enabled = false;
    this.hover = null;
    this.holding = null;
    this._timer = 0;
    this._lastProgress = -1;

    this.box = new THREE.Box3();
    this.highlight = new THREE.Box3Helper(this.box, 0x7fe3d0);
    this.highlight.visible = false;
    this.highlight.material.transparent = true;
    this.highlight.material.opacity = 0.55;
    this.highlight.material.depthTest = false;
    this.highlight.renderOrder = 5;
    scene.add(this.highlight);
  }

  register(spec) {
    if (!spec?.object) return;
    this.specs.set(spec.id, spec);
    this.roots.push(spec.object);
    spec.object.traverse((o) => {
      o.userData.interactId = spec.id;
    });
  }

  setEnabled(value) {
    this.enabled = value;
    if (!value) {
      this.holding = null;
      this.#setHover(null);
    }
  }

  #resolve(value) {
    return typeof value === 'function' ? value() : value;
  }

  #findSpec(object) {
    let node = object;
    while (node) {
      const id = node.userData?.interactId;
      if (id) return this.specs.get(id) ?? null;
      node = node.parent;
    }
    return null;
  }

  #setHover(spec) {
    const changed = spec !== this.hover;
    this.hover = spec;

    if (!spec) {
      this.highlight.visible = false;
      if (changed) this.bus.emit('interact:hover', null);
      return;
    }

    if (changed) {
      this._lastProgress = -1;
      this.box.setFromObject(spec.object);
      // Slightly inflate so the wireframe is readable against surfaces.
      this.box.expandByScalar(0.02);
      this.highlight.visible = true;
    }
    this.#emitHover();
  }

  #emitHover() {
    const spec = this.hover;
    if (!spec) return;
    const hold = this.#resolve(spec.hold) ?? 0;
    const progress = this.holding?.spec === spec ? Math.min(1, this.holding.t / Math.max(0.001, hold)) : 0;
    if (progress !== this._lastProgress || progress === 0) {
      this._lastProgress = progress;
      this.bus.emit('interact:hover', {
        id: spec.id,
        label: this.#resolve(spec.label) ?? '',
        verb: this.#resolve(spec.verb) ?? 'Use',
        hold,
        progress,
        enabled: spec.enabled ? !!spec.enabled() : true,
      });
    }
  }

  update(dt, input) {
    if (!this.enabled) return;

    this._timer += dt;
    if (this._timer >= 1 / CONFIG.INTERACT_HZ) {
      this._timer = 0;
      this.raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);
      const hits = this.raycaster.intersectObjects(this.roots, true);
      let found = null;
      for (const hit of hits) {
        const spec = this.#findSpec(hit.object);
        if (spec) {
          found = spec;
          break;
        }
      }
      if (found !== this.hover) this.#setHover(found);
      else if (found) this.#emitHover();
    }

    if (!input) return;
    const pressed = input.justPressed('KeyE');
    const down = input.isDown('KeyE');

    if (pressed && this.hover && !this.holding) {
      const hold = this.#resolve(this.hover.hold) ?? 0;
      if (hold > 0) {
        this.holding = { spec: this.hover, t: 0 };
      } else {
        this.hover.onUse?.(this.hover);
        this.bus.emit('interact:used', { id: this.hover.id, action: 'use', holdSeconds: 0 });
      }
    }

    if (this.holding) {
      if (!down) {
        this.holding = null;
        this._lastProgress = -1;
        this.#emitHover();
      } else {
        this.holding.t += dt;
        this.holding.spec.onHold?.(dt, this.holding.t);
        this.#emitHover();
        const hold = this.#resolve(this.holding.spec.hold) ?? 0;
        if (this.holding.t >= hold) {
          const spec = this.holding.spec;
          spec.onUse?.(spec);
          this.bus.emit('interact:used', {
            id: spec.id,
            action: 'hold',
            holdSeconds: this.holding.t,
          });
          this.holding = null;
          this._lastProgress = -1;
          this.#emitHover();
        }
      }
    }
  }
}
