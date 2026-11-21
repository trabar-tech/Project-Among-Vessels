/**
 * core/config.js
 * Single source of tuning truth. Units are metres, seconds, radians.
 * Grid cells are CELL metres; every world coordinate is derived from cells.
 */

export const CONFIG = {
  // ---- spatial grid ----
  CELL: 2.0,
  WALL_HEIGHT: 3.2,
  WALL_THICKNESS: 0.22,
  EXTERIOR_THICKNESS: 0.3,
  DOOR_HEIGHT: 2.1,
  DOOR_THICKNESS: 0.12,
  FLOOR_THICKNESS: 0.3,
  CEILING_THICKNESS: 0.18,

  // ---- simulation ----
  FIXED_STEP: 1 / 60,
  MAX_SUBSTEPS: 4,
  GRAVITY: -20,
  MAX_FRAME_DELTA: 0.25,

  // ---- player ----
  PLAYER_RADIUS: 0.34,
  PLAYER_HALF_HEIGHT: 0.5, // capsule cylinder half-height -> total 1.68 m
  EYE_HEIGHT: 1.6,
  CROUCH_EYE_HEIGHT: 1.05,
  WALK_SPEED: 3.15,
  SPRINT_SPEED: 5.0,
  CROUCH_SPEED: 1.55,
  GROUND_ACCEL: 16,
  AIR_ACCEL: 3.5,
  JUMP_VELOCITY: 5.4,
  MAX_FALL_SPEED: 28,
  SPAWN: [10.0, 1.5, 4.0], // world metres, corridor south end
  SPAWN_YAW: Math.PI, // facing +Z? (see controller: yaw 0 looks -Z)
  MOUSE_SENSITIVITY: 0.0022,
  PITCH_LIMIT: 1.5,
  HEADBOB_AMOUNT: 0.028,
  STRIDE_METRES: 1.05,

  // ---- interaction ----
  INTERACT_DISTANCE: 3.0,
  INTERACT_HZ: 10,
  PRY_SECONDS: 1.4,
  DOOR_TRIGGER_RADIUS: 2.6,

  // ---- flashlight ----
  FLASHLIGHT_INTENSITY: 46,
  FLASHLIGHT_DISTANCE: 20,
  FLASHLIGHT_ANGLE: 0.44,
  FLASHLIGHT_BATTERY_SECONDS: 300,

  // ---- rendering ----
  FOV: 76,
  NEAR: 0.05,
  FAR: 90,
  FOG_DENSITY: 0.028,
  FOG_COLOR: 0x06090b,
  MAX_PIXEL_RATIO: 1.75,
  SHADOW_MAP_SIZE: 1024,
  EXPOSURE: 1.2,
  LIGHTS_IN_POOL: 5,

  // ---- procedural art ----
  TEXTURE_SEED: 0x5eed1,
  TEXTURE_WORLD_SIZE: 4.0, // metres covered by one UV tile
  ANISOTROPY: 4,
};

/** World-space X for a cell column. */
export const cellToWorld = (c) => c * CONFIG.CELL;
/** Cell column for a world-space X. */
export const worldToCell = (w) => w / CONFIG.CELL;
