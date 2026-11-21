/**
 * core/loop.js
 * Fixed-timestep simulation with a spiral-of-death guard.
 * Rendering happens once per animation frame; gameplay only ever sees 1/60 s.
 */
import { CONFIG } from './config.js';

export class Loop {
  /**
   * @param {{update:(dt:number)=>void, render:(dt:number, steps:number)=>void}} cbs
   */
  constructor({ update, render, fixed = CONFIG.FIXED_STEP, maxSubsteps = CONFIG.MAX_SUBSTEPS }) {
    this.update = update;
    this.render = render;
    this.fixed = fixed;
    this.maxSubsteps = maxSubsteps;

    this.running = false;
    this.accumulator = 0;
    this.last = 0;
    this.steps = 0;
    this.fps = 0;
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this._raf = 0;

    this._tick = this._tick.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this._raf = requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
  }

  _tick(now) {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._tick);

    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, CONFIG.MAX_FRAME_DELTA);

    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= this.fixed && steps < this.maxSubsteps) {
      this.update(this.fixed);
      this.accumulator -= this.fixed;
      steps++;
    }
    // If we hit the substep ceiling, drop the backlog rather than fall further behind.
    if (steps === this.maxSubsteps && this.accumulator > this.fixed) {
      this.accumulator = 0;
    }

    this.steps = steps;
    this._fpsAccum += dt;
    this._fpsFrames++;
    if (this._fpsAccum >= 0.5) {
      this.fps = this._fpsFrames / this._fpsAccum;
      this._fpsAccum = 0;
      this._fpsFrames = 0;
    }

    this.render(dt, steps);
  }
}
