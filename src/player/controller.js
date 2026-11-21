/**
 * player/controller.js
 * First-person embodiment on a Rapier kinematic capsule.
 *
 * Why the character controller and not a dynamic body:
 *   - autostep over door sills and cable runs without a jump
 *   - snap-to-ground on stairs/vents, no micro-bouncing on the deck plating
 *   - impulses transfer to dynamic crates, so walking into a crate feels real
 */
import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { clamp, damp } from '../core/rng.js';

const CAPSULE_OFFSET = CONFIG.PLAYER_HALF_HEIGHT + CONFIG.PLAYER_RADIUS;

export class Player {
  constructor({ world, RAPIER, camera, scene, spawn, spawnYaw, roomAt, bus }) {
    this.world = world;
    this.RAPIER = RAPIER;
    this.camera = camera;
    this.scene = scene;
    this.roomAt = roomAt;
    this.bus = bus;

    this.spawn = new THREE.Vector3(spawn[0], spawn[1], spawn[2]);
    this.spawnYaw = spawnYaw ?? 0;

    this.yaw = this.spawnYaw;
    this.pitch = 0;
    this.velocity = new THREE.Vector3();
    this.grounded = false;
    this.crouching = false;
    this.sprinting = false;

    this.eyeOffset = CONFIG.EYE_HEIGHT - CAPSULE_OFFSET;
    this.targetEyeOffset = this.eyeOffset;
    this.bobPhase = 0;
    this.bobX = 0;
    this.bobY = 0;
    this.roll = 0;
    this.landDip = 0;
    this.wasGrounded = true;
    this.strideAccum = 0;
    this.roomId = null;

    this.flashlightOn = false;
    this.battery = 100;
    this._lastBatteryReport = 0;

    /* ------------------------------------------------------------- body -- */
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        this.spawn.x,
        this.spawn.y,
        this.spawn.z
      )
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(CONFIG.PLAYER_HALF_HEIGHT, CONFIG.PLAYER_RADIUS).setFriction(0.2),
      this.body
    );

    this.controller = world.createCharacterController(0.02);
    this.controller.enableAutostep(0.42, 0.22, true);
    this.controller.enableSnapToGround(0.4);
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((35 * Math.PI) / 180);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setCharacterMass(82);

    /* -------------------------------------------------------- flashlight -- */
    this.flashlight = new THREE.SpotLight(
      0xffeccc,
      CONFIG.FLASHLIGHT_INTENSITY,
      CONFIG.FLASHLIGHT_DISTANCE,
      CONFIG.FLASHLIGHT_ANGLE,
      0.55,
      1.6
    );
    this.flashlight.position.set(0.2, -0.14, 0);
    this.flashlight.castShadow = true;
    this.flashlight.shadow.mapSize.set(CONFIG.SHADOW_MAP_SIZE, CONFIG.SHADOW_MAP_SIZE);
    this.flashlight.shadow.camera.near = 0.25;
    this.flashlight.shadow.camera.far = CONFIG.FLASHLIGHT_DISTANCE;
    this.flashlight.shadow.bias = -0.0015;
    this.flashlight.shadow.normalBias = 0.03;
    this.flashlight.visible = false;
    this.flashlightTarget = new THREE.Object3D();
    this.flashlightTarget.position.set(0.2, -0.2, -1);
    this.flashlight.target = this.flashlightTarget;
    camera.add(this.flashlight);
    camera.add(this.flashlightTarget);

    if (scene && !scene.children.includes(camera)) scene.add(camera);

    this.#emitRoom(true);
  }

  get position() {
    const t = this.body.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  get feetY() {
    return this.body.translation().y - CAPSULE_OFFSET;
  }

  fixedUpdate(dt, input) {
    /* ------------------------------------------------------------- look -- */
    const mouse = input.consumeMouse();
    if (mouse.dx || mouse.dy) {
      this.yaw -= mouse.dx * CONFIG.MOUSE_SENSITIVITY;
      this.pitch = clamp(
        this.pitch - mouse.dy * CONFIG.MOUSE_SENSITIVITY,
        -CONFIG.PITCH_LIMIT,
        CONFIG.PITCH_LIMIT
      );
    }

    /* ----------------------------------------------------------- intent -- */
    this.crouching = input.isDown('ControlLeft') || input.isDown('ControlRight') || input.isDown('KeyC');
    this.sprinting = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    if (this.crouching) this.sprinting = false;

    let ix = 0;
    let iz = 0;
    if (input.isDown('KeyW')) iz -= 1;
    if (input.isDown('KeyS')) iz += 1;
    if (input.isDown('KeyA')) ix -= 1;
    if (input.isDown('KeyD')) ix += 1;

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // camera forward is -Z rotated by yaw; right is +X rotated by yaw
    let wishX = -sin * -iz + cos * ix;
    let wishZ = -cos * -iz + -sin * ix;

    const wishLen = Math.hypot(wishX, wishZ);
    if (wishLen > 1e-4) {
      wishX /= wishLen;
      wishZ /= wishLen;
    }

    const speed = this.crouching
      ? CONFIG.CROUCH_SPEED
      : this.sprinting
      ? CONFIG.SPRINT_SPEED
      : CONFIG.WALK_SPEED;

    const accel = this.grounded ? CONFIG.GROUND_ACCEL : CONFIG.AIR_ACCEL;
    this.velocity.x = damp(this.velocity.x, wishX * speed * (wishLen > 0 ? 1 : 0), accel, dt);
    this.velocity.z = damp(this.velocity.z, wishZ * speed * (wishLen > 0 ? 1 : 0), accel, dt);

    /* ---------------------------------------------------------- vertical -- */
    if (this.grounded && input.justPressed('Space')) {
      this.velocity.y = CONFIG.JUMP_VELOCITY;
      this.grounded = false;
    }
    this.velocity.y = Math.max(
      this.velocity.y + CONFIG.GRAVITY * dt,
      -CONFIG.MAX_FALL_SPEED
    );

    /* ------------------------------------------------------------ solve -- */
    const desired = {
      x: this.velocity.x * dt,
      y: this.velocity.y * dt,
      z: this.velocity.z * dt,
    };

    this.controller.computeColliderMovement(this.collider, desired);
    const corrected = this.controller.computedMovement();
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({
      x: t.x + corrected.x,
      y: t.y + corrected.y,
      z: t.z + corrected.z,
    });

    const nowGrounded = this.controller.computedGrounded();
    if (nowGrounded && this.velocity.y < 0) this.velocity.y = 0;
    if (!nowGrounded && desired.y > 0 && corrected.y < desired.y * 0.5) this.velocity.y = 0;

    if (nowGrounded && !this.wasGrounded) {
      this.landDip = Math.min(0.055, Math.abs(this.velocity.y) * 0.004);
    }
    this.wasGrounded = nowGrounded;
    this.grounded = nowGrounded;

    /* -------------------------------------------------------- headbob ---- */
    const horizontal = Math.hypot(corrected.x, corrected.z);
    const horizSpeed = dt > 0 ? horizontal / dt : 0;
    if (this.grounded && horizSpeed > 0.25) {
      this.bobPhase += dt * (6.2 + horizSpeed * 1.15);
    } else {
      this.bobPhase = damp(this.bobPhase, Math.round(this.bobPhase / Math.PI) * Math.PI, 7, dt);
    }

    const bobAmp = CONFIG.HEADBOB_AMOUNT * Math.min(1, horizSpeed / CONFIG.WALK_SPEED);
    this.bobY = Math.sin(this.bobPhase * 2) * bobAmp;
    this.bobX = Math.cos(this.bobPhase) * bobAmp * 0.7;
    this.roll = Math.sin(this.bobPhase) * bobAmp * 0.16;

    this.landDip = damp(this.landDip, 0, 8, dt);

    /* ----------------------------------------------------------- crouch --- */
    this.targetEyeOffset = this.crouching
      ? CONFIG.CROUCH_EYE_HEIGHT - CAPSULE_OFFSET
      : CONFIG.EYE_HEIGHT - CAPSULE_OFFSET;
    this.eyeOffset = damp(this.eyeOffset, this.targetEyeOffset, 12, dt);

    /* --------------------------------------------------------- footsteps -- */
    this.strideAccum += horizontal;
    const stride = CONFIG.STRIDE_METRES * (this.sprinting ? 1.35 : this.crouching ? 0.8 : 1);
    if (this.strideAccum > stride && nowGrounded) {
      this.strideAccum = 0;
      const pos = this.position;
      const roomId = this.roomAt(pos.x, pos.z);
      this.bus.emit('player:footstep', {
        roomId,
        surface: this.#roomSurface(roomId),
        speed: horizSpeed,
        sprinting: this.sprinting,
        crouching: this.crouching,
      });
    }

    /* ---------------------------------------------------------- systems --- */
    this.#emitRoom(false);
    this.#updateFlashlight(dt, input);
  }

  #roomSurface(roomId) {
    // surface is looked up from the blueprint by main and cached on the player
    return this.surfaceOf?.(roomId) ?? 'deck';
  }

  #emitRoom(force) {
    const pos = this.body.translation();
    const roomId = this.roomAt(pos.x, pos.z);
    if (roomId !== this.roomId || force) {
      this.bus.emit('player:room', { roomId, prevRoomId: this.roomId });
      this.roomId = roomId;
    }
  }

  #updateFlashlight(dt, input) {
    if (input.justPressed('KeyF') && this.battery > 0) {
      this.flashlightOn = !this.flashlightOn;
      this.flashlight.visible = this.flashlightOn && this.battery > 0;
      this.bus.emit('player:flashlight', { on: this.flashlightOn, battery: this.battery });
      this.bus.emit('audio:cue', { cue: 'beep', opts: { ok: this.flashlightOn } });
    }

    if (this.flashlightOn && this.battery > 0) {
      this.battery = Math.max(0, this.battery - (dt / CONFIG.FLASHLIGHT_BATTERY_SECONDS) * 100);
      if (this.battery === 0) {
        this.flashlightOn = false;
        this.flashlight.visible = false;
        this.bus.emit('ui:prompt', { text: 'Flashlight battery depleted', tone: 'warn' });
      }
    }

    // Battery brownout: dim as it dies, and die with a stutter.
    const health = this.battery / 100;
    const stutter = health < 0.15 ? 0.55 + Math.random() * 0.45 : 1;
    this.flashlight.intensity = CONFIG.FLASHLIGHT_INTENSITY * (0.35 + 0.65 * health) * stutter;
    this.flashlight.visible = this.flashlightOn && this.battery > 0;

    this._lastBatteryReport += dt;
    if (this._lastBatteryReport > 1 && this.flashlightOn) {
      this._lastBatteryReport = 0;
      this.bus.emit('player:flashlight', { on: this.flashlightOn, battery: this.battery });
    }
  }

  /** Applied once per rendered frame, after physics has stepped. */
  syncCamera() {
    const t = this.body.translation();
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);

    this.camera.position.set(
      t.x + rightX * this.bobX,
      t.y + this.eyeOffset + this.bobY - this.landDip,
      t.z + rightZ * this.bobX
    );
    this.camera.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
  }

  respawn(reason = 'manual') {
    this.body.setNextKinematicTranslation({
      x: this.spawn.x,
      y: this.spawn.y,
      z: this.spawn.z,
    });
    this.body.setTranslation({ x: this.spawn.x, y: this.spawn.y, z: this.spawn.z }, true);
    this.velocity.set(0, 0, 0);
    this.yaw = this.spawnYaw;
    this.pitch = 0;
    this.bus.emit('player:respawn', { reason });
  }
}
