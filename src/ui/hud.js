/**
 * ui/hud.js
 * DOM overlay. The HUD reads the bus and owns no gameplay state.
 */
import { bus } from '../core/bus.js';

const CIRCUITS = [
  { id: 'A', label: 'FORE' },
  { id: 'B', label: 'HAB' },
  { id: 'C', label: 'IND' },
  { id: 'D', label: 'DOORS' },
];

export class Hud {
  constructor({ rooms = [] } = {}) {
    this.roomNames = new Map(rooms.map((r) => [r.id, r.name]));

    this.el = {
      hud: document.getElementById('hud'),
      roomName: document.getElementById('roomname'),
      roomSub: document.getElementById('roomsub'),
      circuits: document.getElementById('circuits'),
      prompt: document.getElementById('prompt'),
      promptKey: document.getElementById('prompt-key'),
      promptVerb: document.getElementById('prompt-verb'),
      promptLabel: document.getElementById('prompt-label'),
      promptBar: document.getElementById('prompt-bar'),
      promptBarFill: document.querySelector('#prompt-bar > i'),
      toast: document.getElementById('toast'),
      stats: document.getElementById('stats'),
      overlay: document.getElementById('overlay'),
      overlayTitle: document.getElementById('overlay-title'),
      loading: document.getElementById('loading'),
      loadingFill: document.getElementById('loading-fill'),
      loadingText: document.getElementById('loading-text'),
      enter: document.getElementById('enter'),
      battery: document.getElementById('battery'),
      batteryFill: document.querySelector('#battery .bar > i'),
      batteryPct: document.getElementById('battery-pct'),
      reticle: document.getElementById('reticle'),
      error: document.getElementById('error'),
      errorText: document.getElementById('error-text'),
    };

    this.circuitEls = new Map();
    for (const c of CIRCUITS) {
      const row = document.createElement('div');
      row.className = 'circuit live';
      row.innerHTML = `<span class="dot"></span><span class="cid">${c.id}</span><span class="clabel">${c.label}</span>`;
      this.el.circuits.appendChild(row);
      this.circuitEls.set(c.id, row);
    }

    this._toastTimer = 0;
    this._bind();
  }

  _bind() {
    bus.on('interact:hover', (payload) => this.prompt(payload));
    bus.on('ui:prompt', ({ text, tone }) => this.toast(text, tone));
    bus.on('power:circuit', ({ circuit, live }) => this.setCircuit(circuit, live));
    bus.on('player:flashlight', ({ on, battery }) => this.setBattery(on, battery));
    bus.on('player:room', ({ roomId }) => this.setRoom(roomId));
    bus.on('game:error', ({ message }) => this.error(message, ''));
  }

  setLoading(text, fraction) {
    if (this.el.loadingText) this.el.loadingText.textContent = text;
    if (this.el.loadingFill) this.el.loadingFill.style.width = `${Math.round(fraction * 100)}%`;
  }

  ready() {
    if (this.el.enter) {
      this.el.enter.disabled = false;
      this.el.enter.textContent = 'CLICK TO BOARD — CAPTURE MOUSE';
    }
    if (this.el.loading) this.el.loading.classList.add('hidden');
  }

  showOverlay(mode = 'start') {
    this.el.overlay.classList.remove('hidden');
    if (this.el.overlayTitle) {
      this.el.overlayTitle.textContent = mode === 'paused' ? 'STANDBY' : 'PROJECT AMONG VESSELS';
    }
    this.el.enter.textContent =
      mode === 'paused' ? 'RESUME — CLICK TO RECAPTURE MOUSE' : 'CLICK TO BOARD — CAPTURE MOUSE';
  }

  hideOverlay() {
    this.el.overlay.classList.add('hidden');
  }

  setHudVisible(visible) {
    this.el.hud.classList.toggle('hidden', !visible);
  }

  setRoom(roomId) {
    const name = roomId ? this.roomNames.get(roomId) ?? roomId : 'HULL BREACH';
    this.el.roomName.textContent = name.toUpperCase();
    this.el.roomSub.textContent = roomId
      ? 'ISV KESTREL-90 · DECK 1'
      : 'OUTSIDE PRESSURISED VOLUME';
  }

  setCircuit(id, live) {
    const row = this.circuitEls.get(id);
    if (!row) return;
    row.classList.toggle('live', live);
    row.classList.toggle('dead', !live);
  }

  setBattery(on, percent) {
    const pct = Math.max(0, Math.min(100, percent));
    this.el.batteryFill.style.width = `${pct}%`;
    this.el.batteryPct.textContent = `${pct.toFixed(0)}%`;
    this.el.battery.classList.toggle('on', on);
    this.el.battery.classList.toggle('low', pct < 20);
  }

  prompt(payload) {
    if (!payload) {
      this.el.prompt.classList.add('hidden');
      this.el.reticle.classList.remove('active');
      return;
    }
    this.el.prompt.classList.remove('hidden');
    this.el.reticle.classList.add('active');
    this.el.promptKey.textContent = 'E';
    this.el.promptVerb.textContent = payload.verb ?? 'Use';
    this.el.promptLabel.textContent = payload.label ?? '';
    const showBar = payload.hold > 0;
    this.el.promptBar.classList.toggle('hidden', !showBar);
    if (showBar) {
      this.el.promptBarFill.style.width = `${Math.round(payload.progress * 100)}%`;
    }
  }

  toast(text, tone = 'info') {
    const el = this.el.toast;
    el.textContent = text;
    el.className = `tone-${tone}`;
    el.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.add('hidden'), 3400);
  }

  setStats({ fps, calls, tris, bodies, steps }) {
    this.el.stats.textContent = `${fps.toFixed(0)} fps · ${steps} steps · ${calls} draws · ${(
      tris / 1000
    ).toFixed(0)}k tris · ${bodies} bodies`;
  }

  toggleStats() {
    this.el.stats.classList.toggle('hidden');
  }

  error(message, detail = '') {
    window.__fatal?.(message, detail);
  }
}
