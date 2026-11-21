/**
 * core/input.js
 * Pointer lock + keyboard state with edge-triggered presses.
 *
 * Pointer-lock quirks handled here (PROJECT_BRAIN.md W4):
 *   - lock state is mirrored from the pointerlockchange event, never assumed
 *   - requestPointerLock's unadjustedMovement promise is allowed to fail
 *   - held keys are cleared on blur so alt-tabbing cannot pin W down
 */
export class Input {
  constructor({ element = document.body, onLockChange = null } = {}) {
    this.element = element;
    this.onLockChange = onLockChange;

    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouse = { dx: 0, dy: 0, buttons: new Set(), wheel: 0 };
    this.locked = false;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onLockChange = this._onLockChange.bind(this);
    this._onBlur = this._onBlur.bind(this);

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('wheel', this._onWheel, { passive: true });
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('pointerlockchange', this._onLockChange);
    document.addEventListener('pointerlockerror', () => {
      console.warn('[input] pointer lock refused');
      this.locked = false;
      this.onLockChange?.(false);
    });
  }

  requestLock() {
    if (this.locked) return;
    try {
      const p = this.element.requestPointerLock?.({ unadjustedMovement: true });
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          try {
            this.element.requestPointerLock();
          } catch (err) {
            console.warn('[input] pointer lock unavailable', err);
          }
        });
      }
    } catch (err) {
      console.warn('[input] pointer lock unavailable', err);
    }
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  _onLockChange() {
    this.locked = document.pointerLockElement === this.element;
    if (!this.locked) this.keys.clear();
    this.onLockChange?.(this.locked);
  }

  _onKeyDown(e) {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) {
      if (this.locked) e.preventDefault();
    }
    if (e.repeat) return;
    this.keys.add(e.code);
    this.pressed.add(e.code);
  }

  _onKeyUp(e) {
    this.keys.delete(e.code);
    this.released.add(e.code);
  }

  _onMouseMove(e) {
    if (!this.locked) return;
    // Clamp spikes: some browsers emit huge deltas when the pointer is warped.
    this.mouse.dx += Math.max(-180, Math.min(180, e.movementX || 0));
    this.mouse.dy += Math.max(-180, Math.min(180, e.movementY || 0));
  }

  _onMouseDown(e) {
    if (!this.locked) return;
    this.mouse.buttons.add(e.button);
  }

  _onMouseUp(e) {
    this.mouse.buttons.delete(e.button);
  }

  _onWheel(e) {
    this.mouse.wheel += Math.sign(e.deltaY);
  }

  _onBlur() {
    this.keys.clear();
    this.mouse.buttons.clear();
  }

  isDown(code) {
    return this.keys.has(code);
  }

  justPressed(code) {
    return this.pressed.has(code);
  }

  /** Reads and clears the accumulated mouse delta. */
  consumeMouse() {
    const dx = this.mouse.dx;
    const dy = this.mouse.dy;
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    return { dx, dy };
  }

  /** Called once per fixed step, after all consumers have read the edges. */
  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mouse.wheel = 0;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('blur', this._onBlur);
    document.removeEventListener('pointerlockchange', this._onLockChange);
  }
}
