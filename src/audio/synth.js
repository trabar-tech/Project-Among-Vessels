/**
 * audio/synth.js
 * Entirely procedural Web Audio: no files, no network.
 *
 * Beds:  engine hum (detuned saw pair + lowpass) + air handling (filtered noise)
 * One-shots: footsteps (surface band), doors (servo + slide), breakers (clack +
 *            relay thump), pry creak, UI beeps, alarm.
 *
 * Browsers require a user gesture before audio starts, so nothing is created
 * until unlock() is called from the click-to-start overlay.
 */

const SURFACE_BANDS = {
  deck: [260, 900],
  tile: [900, 2600],
  grate: [420, 1500],
  hull: [200, 760],
};

export class Synth {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.master = null;
    this.humGain = null;
    this.airGain = null;
    this.powerLevel = 1;
    this.enabled = true;
  }

  async unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return this.ready;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;

    this.ctx = new AC({ latencyHint: 'interactive' });
    const c = this.ctx;

    this.master = c.createGain();
    this.master.gain.value = 0.8;

    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 24;
    comp.ratio.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;

    this.master.connect(comp);
    comp.connect(c.destination);

    this.noiseBuffer = this.#makeNoise(2.0);
    this.#startBeds();

    if (c.state === 'suspended') await c.resume();
    this.ready = true;
    return true;
  }

  #makeNoise(seconds) {
    const c = this.ctx;
    const len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    // Slightly pink noise reads warmer than white in a metal room.
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = 0.98 * last + 0.02 * white;
      data[i] = white * 0.55 + last * 3.2;
    }
    return buf;
  }

  #noiseSource(loop = false) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = loop;
    return src;
  }

  #startBeds() {
    const c = this.ctx;
    const t = c.currentTime;

    // --- engine hum: two detuned saws through a lowpass ---
    this.humGain = c.createGain();
    this.humGain.gain.value = 0.0;
    const humFilter = c.createBiquadFilter();
    humFilter.type = 'lowpass';
    humFilter.frequency.value = 210;
    humFilter.Q.value = 0.9;

    for (const [freq, gain, detune] of [
      [54, 0.5, -4],
      [54.4, 0.42, 5],
      [81, 0.22, 0],
    ]) {
      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      const g = c.createGain();
      g.gain.value = gain;
      osc.connect(g);
      g.connect(humFilter);
      osc.start(t);
    }
    humFilter.connect(this.humGain);
    this.humGain.connect(this.master);
    this.humGain.gain.setTargetAtTime(0.055, t, 1.2);

    // --- air handling: looping filtered noise ---
    this.airGain = c.createGain();
    this.airGain.gain.value = 0.0;
    const airFilter = c.createBiquadFilter();
    airFilter.type = 'bandpass';
    airFilter.frequency.value = 620;
    airFilter.Q.value = 0.6;

    const air = this.#noiseSource(true);
    air.connect(airFilter);
    airFilter.connect(this.airGain);
    this.airGain.connect(this.master);
    this.airGain.gain.setTargetAtTime(0.028, t, 1.6);
    air.start(t);
  }

  /** 0 = ship unpowered (beds duck), 1 = nominal. */
  setPower(level) {
    if (!this.ready) return;
    this.powerLevel = level;
    const t = this.ctx.currentTime;
    this.humGain.gain.setTargetAtTime(0.055 * level, t, 0.15);
    this.airGain.gain.setTargetAtTime(0.028 * (0.35 + level * 0.65), t, 0.3);
  }

  setMaster(value) {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(value, this.ctx.currentTime, 0.05);
  }

  /* ------------------------------------------------------------ one-shots -- */

  #burst({ freq = 800, q = 1.2, gain = 0.2, dur = 0.12, type = 'bandpass', sweepTo = null }) {
    const c = this.ctx;
    const t = c.currentTime;
    const src = this.#noiseSource(false);
    const filter = c.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    filter.Q.value = q;
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);

    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t, Math.random() * 1.2);
    src.stop(t + dur + 0.02);
  }

  #tone({ freq = 440, dur = 0.2, gain = 0.12, type = 'sine', sweepTo = null, delay = 0 }) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);

    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  footstep(surface = 'deck', speed = 3) {
    if (!this.ready) return;
    const band = SURFACE_BANDS[surface] || SURFACE_BANDS.deck;
    const loud = 0.055 + Math.min(speed / 5, 1) * 0.05;
    this.#burst({
      freq: band[0] + Math.random() * (band[1] - band[0]),
      q: 1.6,
      gain: loud,
      dur: 0.085,
      type: 'bandpass',
    });
    // heel thump
    this.#tone({ freq: 92 + Math.random() * 26, dur: 0.07, gain: loud * 0.7, type: 'sine' });
  }

  doorSlide(open = true) {
    if (!this.ready) return;
    this.#burst({
      freq: 520,
      sweepTo: open ? 1400 : 420,
      q: 0.9,
      gain: 0.11,
      dur: 0.55,
      type: 'bandpass',
    });
    this.#tone({
      freq: open ? 180 : 260,
      sweepTo: open ? 320 : 150,
      dur: 0.5,
      gain: 0.05,
      type: 'sawtooth',
    });
    // final clack
    this.#burst({ freq: 2400, q: 2, gain: 0.05, dur: 0.05, type: 'highpass' });
  }

  doorClunk() {
    if (!this.ready) return;
    this.#tone({ freq: 120, sweepTo: 52, dur: 0.22, gain: 0.16, type: 'sine' });
    this.#burst({ freq: 900, q: 1.5, gain: 0.06, dur: 0.06 });
  }

  breaker(on) {
    if (!this.ready) return;
    // relay clack
    this.#burst({ freq: 3000, q: 3, gain: 0.09, dur: 0.035, type: 'highpass' });
    this.#tone({ freq: 1500, dur: 0.03, gain: 0.05, type: 'square', delay: 0.03 });
    // electrical thump + whine ramp
    this.#tone({ freq: 70, sweepTo: on ? 120 : 45, dur: 0.28, gain: 0.13, type: 'sine', delay: 0.05 });
    if (on) this.#tone({ freq: 320, sweepTo: 640, dur: 0.4, gain: 0.035, type: 'triangle', delay: 0.1 });
  }

  pry() {
    if (!this.ready) return;
    this.#burst({
      freq: 220 + Math.random() * 120,
      sweepTo: 520,
      q: 4,
      gain: 0.07,
      dur: 0.3,
      type: 'bandpass',
    });
  }

  beep(ok = true) {
    if (!this.ready) return;
    this.#tone({ freq: ok ? 880 : 320, dur: 0.09, gain: 0.05, type: 'square' });
    if (ok) this.#tone({ freq: 1320, dur: 0.07, gain: 0.035, type: 'square', delay: 0.09 });
  }

  alarm(active) {
    if (!this.ready) return;
    if (!active) {
      clearInterval(this._alarmTimer);
      return;
    }
    this.#tone({ freq: 620, sweepTo: 980, dur: 0.5, gain: 0.06, type: 'triangle' });
    this._alarmTimer = setInterval(() => {
      this.#tone({ freq: 620, sweepTo: 980, dur: 0.5, gain: 0.06, type: 'triangle' });
    }, 1200);
  }

  dispose() {
    clearInterval(this._alarmTimer);
    if (this.ctx) this.ctx.close();
    this.ctx = null;
    this.ready = false;
  }
}
