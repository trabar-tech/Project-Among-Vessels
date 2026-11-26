/**
 * 3D slice for Among Vessels (06_ENGINE_AND_3D.md).
 *
 * Scope is deliberately narrow: prove the *presentation contract* — small
 * viewport, tight cone of vision, opaque shadow, diegetic HUD, retro-industrial
 * geometry — without pretending to be the game. Rules live in src/sim/* and are
 * imported, not reimplemented.
 */
import * as THREE from 'three';
import { RULES, ADJACENCY } from '../sim/rules.ts';
import { tallyVotes, SKIP } from '../sim/vote.ts';
import { evaluatePlay } from '../sim/state.ts';

// --- palette (03 §2.1: cold teal/steel, one alarm colour, reserved) ---------
const PALETTE = {
  floor: 0x2a3335,
  wall: 0x39474a,
  wallDark: 0x212a2c,
  steel: 0x5d6c70,
  teal: 0x2f4b4d,
  amber: 0xc9a227,
  alarm: 0xff4a1f,
  body: 0x7a5c4a,
  crew: [0xb8442c, 0x2c6fb8, 0x3f8f4a, 0xb8547f, 0xc9a227, 0x46b0b8, 0x7a4ab8],
  skin: 0xc4b8a8,
} as const;

const ROOM_POS: Record<string, { x: number; z: number }> = {
  Cafeteria: { x: 0, z: -8 },
  Weapons: { x: -12, z: -14 },
  Navigation: { x: -22, z: -6 },
  Shields: { x: -20, z: 6 },
  Storage: { x: -6, z: 12 },
  Admin: { x: 8, z: 0 },
  Corridor: { x: 2, z: 8 },
  MedBay: { x: 14, z: 6 },
  Electrical: { x: 12, z: 16 },
  UpperEngine: { x: -8, z: 22 },
  LowerEngine: { x: 4, z: 24 },
  Reactor: { x: -2, z: 32 },
  O2: { x: 6, z: -18 },
  Security: { x: 20, z: -2 },
};

const VIEW = {
  fov: 62,
  pitchDeg: -52,
  eyeHeight: 13,
  backOffset: 11,
  crewVision: 9.5 * RULES.crewVisionMultiplier,
  visionHalfAngle: THREE.MathUtils.degToRad(60),
};

// --- scene -----------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1); // PS1-ish: no supersampling
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070a);
scene.fog = new THREE.Fog(0x05070a, 26, 54);

const camera = new THREE.PerspectiveCamera(VIEW.fov, window.innerWidth / window.innerHeight, 0.5, 220);

// Ambient is deliberately almost nothing: fixtures do the work.
scene.add(new THREE.AmbientLight(0x1b2a2e, 0.55));

const hemi = new THREE.HemisphereLight(0x24383c, 0x0a0f10, 0.35);
scene.add(hemi);

// --- geometry --------------------------------------------------------------
const ROOM_SIZE = 9;
const WALL_H = 3.2;

function buildRooms(): void {
  const floorMat = new THREE.MeshStandardMaterial({ color: PALETTE.floor, roughness: 0.95, metalness: 0.15 });
  const wallMat = new THREE.MeshStandardMaterial({ color: PALETTE.wall, roughness: 0.85, metalness: 0.25 });
  const trimMat = new THREE.MeshStandardMaterial({ color: PALETTE.wallDark, roughness: 0.9 });

  for (const [name, p] of Object.entries(ROOM_POS)) {
    const floor = new THREE.Mesh(new THREE.BoxGeometry(ROOM_SIZE, 0.4, ROOM_SIZE), floorMat);
    floor.position.set(p.x, -0.2, p.z);
    floor.receiveShadow = true;
    scene.add(floor);

    // Four perimeter walls, leaving gaps toward neighbours (cheap doorways).
    const neighbours = ADJACENCY[name] ?? [];
    const sides: { dir: 'n' | 's' | 'e' | 'w'; nx: number; nz: number; rotY: number }[] = [
      { dir: 'n', nx: 0, nz: -1, rotY: 0 },
      { dir: 's', nx: 0, nz: 1, rotY: 0 },
      { dir: 'e', nx: 1, nz: 0, rotY: Math.PI / 2 },
      { dir: 'w', nx: -1, nz: 0, rotY: Math.PI / 2 },
    ];
    for (const side of sides) {
      const opens = neighbours.some((n) => {
        const q = ROOM_POS[n];
        if (q === undefined) return false;
        const dx = q.x - p.x;
        const dz = q.z - p.z;
        if (side.dir === 'n') return dz < 0 && Math.abs(dx) < ROOM_SIZE;
        if (side.dir === 's') return dz > 0 && Math.abs(dx) < ROOM_SIZE;
        if (side.dir === 'e') return dx > 0 && Math.abs(dz) < ROOM_SIZE * 1.6;
        return dx < 0 && Math.abs(dz) < ROOM_SIZE * 1.6;
      });
      if (opens) continue;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(ROOM_SIZE, WALL_H, 0.5), wallMat);
      wall.position.set(p.x + side.nx * (ROOM_SIZE / 2), WALL_H / 2, p.z + side.nz * (ROOM_SIZE / 2));
      wall.rotation.y = side.rotY;
      wall.castShadow = true;
      wall.receiveShadow = true;
      scene.add(wall);

      const trim = new THREE.Mesh(new THREE.BoxGeometry(ROOM_SIZE, 0.18, 0.62), trimMat);
      trim.position.set(p.x + side.nx * (ROOM_SIZE / 2), WALL_H - 0.1, p.z + side.nz * (ROOM_SIZE / 2));
      trim.rotation.y = side.rotY;
      scene.add(trim);
    }

    // Ceiling fixture: one warm pool per room, casting real shadows.
    const lamp = new THREE.PointLight(0xcfd9c8, 9, 22, 2);
    lamp.position.set(p.x, WALL_H - 0.4, p.z);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(256, 256);
    scene.add(lamp);

    const bulb = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.12, 1.6),
      new THREE.MeshBasicMaterial({ color: 0xdfe8d4 }),
    );
    bulb.position.set(p.x, WALL_H - 0.35, p.z);
    scene.add(bulb);

    // Machinery clutter: crates and pipes, the SIGNALIS "recently used" residue.
    const clutterCount = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < clutterCount; i++) {
      const w = 0.9 + Math.random() * 1.4;
      const h = 0.6 + Math.random() * 1.8;
      const crate = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, w * 0.8),
        new THREE.MeshStandardMaterial({ color: PALETTE.steel, roughness: 0.8, metalness: 0.4 }),
      );
      const edge = ROOM_SIZE / 2 - 1.1;
      crate.position.set(
        p.x + (Math.random() * 2 - 1) * edge,
        h / 2,
        p.z + (Math.random() * 2 - 1) * edge,
      );
      crate.rotation.y = Math.random() * Math.PI;
      crate.castShadow = true;
      crate.receiveShadow = true;
      scene.add(crate);
    }
  }
}

// --- crewmates -------------------------------------------------------------
interface Crew {
  mesh: THREE.Group;
  name: string;
  pos: THREE.Vector3;
  target: THREE.Vector3;
  yaw: number;
  alive: boolean;
  impostor: boolean;
  speed: number;
  waitUntil: number;
}

const crews: Crew[] = [];

function buildCrewmate(color: number): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.1 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.72, 4, 10), bodyMat);
  body.position.y = 1.0;
  body.castShadow = true;
  g.add(body);

  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.52, 0.26, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x9fd6dc, roughness: 0.15, metalness: 0.6 }),
  );
  visor.position.set(0, 1.28, 0.38);
  g.add(visor);

  const pack = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.55, 0.22),
    new THREE.MeshStandardMaterial({ color: PALETTE.wallDark, roughness: 0.9 }),
  );
  pack.position.set(0, 1.05, -0.42);
  pack.castShadow = true;
  g.add(pack);
  return g;
}

function spawnCrew(): void {
  const names = ['Red', 'Blue', 'Green', 'Pink', 'Yellow', 'Cyan', 'Purple', 'White', 'Black', 'Brown'];
  for (let i = 0; i < RULES.players; i++) {
    const color = PALETTE.crew[i % PALETTE.crew.length] ?? 0x999999;
    const mesh = buildCrewmate(color);
    const start = ROOM_POS.Cafeteria ?? { x: 0, z: 0 };
    const pos = new THREE.Vector3(
      start.x + (Math.random() * 2 - 1) * 3,
      0,
      start.z + (Math.random() * 2 - 1) * 3,
    );
    mesh.position.copy(pos);
    scene.add(mesh);
    crews.push({
      mesh,
      name: names[i] ?? `Bot${i}`,
      pos,
      target: pos.clone(),
      yaw: Math.random() * Math.PI * 2,
      alive: true,
      impostor: i >= RULES.players - RULES.impostors,
      speed: 3.2 * RULES.playerSpeedMultiplier,
      waitUntil: 0,
    });
  }
}

const roomNames = Object.keys(ROOM_POS);

function pickRoom(): string {
  return roomNames[Math.floor(Math.random() * roomNames.length)] ?? 'Cafeteria';
}

function tickCrew(c: Crew, now: number, dt: number): void {
  if (!c.alive) return;
  if (c.waitUntil > now) return;
  if (c.pos.distanceTo(c.target) < 0.6) {
    const room = pickRoom();
    const p = ROOM_POS[room] ?? { x: 0, z: 0 };
    c.target.set(p.x + (Math.random() * 2 - 1) * 2.6, 0, p.z + (Math.random() * 2 - 1) * 2.6);
    c.waitUntil = now + 0.4 + Math.random() * 2.2; // loiter = the behavioural tell
    return;
  }
  const dir = c.target.clone().sub(c.pos);
  dir.y = 0;
  const dist = dir.length();
  if (dist > 0.001) dir.normalize();
  const step = Math.min(dist, c.speed * dt);
  c.pos.addScaledVector(dir, step);
  const wantYaw = Math.atan2(dir.x, dir.z);
  // Turn smoothly so bodies read as walking, not sliding.
  let delta = wantYaw - c.yaw;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  c.yaw += delta * Math.min(1, dt * 6);
  c.mesh.position.copy(c.pos);
  c.mesh.rotation.y = c.yaw;
}

// --- player ----------------------------------------------------------------
const player = {
  pos: new THREE.Vector3(0, 0, -8),
  yaw: 0,
  speed: 5.0 * RULES.playerSpeedMultiplier,
  sprint: 8.0 * RULES.playerSpeedMultiplier,
  stamina: 1,
  moodle: 'FOCUSED',
};

const keys = new Set<string>();
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyE') doTask();
  if (e.code === 'KeyR') reportBody();
  if (e.code === 'Space') callMeeting();
  if (e.code === 'KeyL' && import.meta.env.DEV) toggleLights();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

const playerMesh = buildCrewmate(0xe8e2d4);
scene.add(playerMesh);

let playerLight = new THREE.PointLight(0xbfd0c4, 6, 14, 2);
playerLight.position.set(0, 2.4, 0);
scene.add(playerLight);

// --- game state ------------------------------------------------------------
const state = {
  phase: 'PLAY',
  tasksDone: 0,
  tasksTotal: RULES.tasksPerCrewmate * (RULES.players - RULES.impostors),
  lightsOut: false,
  bodies: [] as { room: string; pos: THREE.Vector3; found: boolean }[],
  meetingLeft: 1,
  log: [] as string[],
};

function log(text: string, cls = ''): void {
  state.log.push(cls ? `<div class="line ${cls}">${text}</div>` : `<div class="line">${text}</div>`);
  const el = document.getElementById('console');
  if (el !== null) {
    el.innerHTML = state.log.slice(-14).join('');
  }
}

function roomAt(pos: THREE.Vector3): string {
  let best = 'Corridor';
  let bestD = Infinity;
  for (const [name, p] of Object.entries(ROOM_POS)) {
    const d = Math.hypot(pos.x - p.x, pos.z - p.z);
    if (d < bestD) { bestD = d; best = name; }
  }
  return best;
}

function doTask(): void {
  if (state.phase !== 'PLAY') return;
  const room = roomAt(player.pos);
  state.tasksDone = Math.min(state.tasksTotal, state.tasksDone + 1);
  log(`WORK ORDER LOGGED // ${room}`);
  updateHud();
}

function reportBody(): void {
  const room = roomAt(player.pos);
  const near = state.bodies.find((b) => !b.found && Math.hypot(b.pos.x - player.pos.x, b.pos.z - player.pos.z) < 4);
  if (near === undefined) {
    log(`NO REMAINS DETECTED // ${room}`, 'bad');
    return;
  }
  near.found = true;
  state.phase = 'MEETING_VOTING';
  log(`REPORT // ${near.room}`, 'bad');
  runMeeting(near.room);
}

function callMeeting(): void {
  if (state.meetingLeft <= 0 || state.phase !== 'PLAY') {
    log('EMERGENCY CHANNEL LOCKED', 'bad');
    return;
  }
  state.meetingLeft--;
  state.phase = 'MEETING_DISCUSSION';
  log('EMERGENCY MEETING CONVENED');
  runMeeting(roomAt(player.pos));
}

let lightsRestoreTimer: number | null = null;
function toggleLights(): void {
  state.lightsOut = !state.lightsOut;
  log(state.lightsOut ? 'SABOTAGE // LIGHTS' : 'POWER RESTORED', state.lightsOut ? 'bad' : '');
  if (state.lightsOut && lightsRestoreTimer === null) {
    lightsRestoreTimer = window.setTimeout(() => {
      state.lightsOut = false;
      lightsRestoreTimer = null;
      log('POWER RESTORED');
    }, 14000);
  }
  updateHud();
}

/** Meeting: NPC lines are chosen from the frozen grammar surface, weighted by
 *  who they were standing near. This is a *stub* of 04 §6.3 — the real
 *  orchestrator lives in the sim core and lands in Phase 3. */
function runMeeting(room: string): void {
  const alive = crews.filter((c) => c.alive);
  const speakers = [...alive].sort(() => Math.random() - 0.5).slice(0, 4);
  let delay = 0;
  for (const s of speakers) {
    const target = alive[Math.floor(Math.random() * alive.length)];
    if (target === undefined) continue;
    const strong = Math.random() < 0.35;
    const line =
      Math.random() < 0.5
        ? `${s.name}: ACCUSE ${target.name} // ${strong ? 'STRONG' : 'MILD'}`
        : `${s.name}: ALIBI ${room} // ${strong ? 'EARLIER' : 'JUST_NOW'}`;
    window.setTimeout(() => log(line, 'say'), delay);
    delay += 700 + Math.random() * 900;
  }
  window.setTimeout(() => {
    // Deterministic-ish plurality from the visible speaker set.
    const votes = new Map<string, number>();
    for (const s of speakers) {
      const t = alive[Math.floor(Math.random() * alive.length)];
      if (t === undefined) continue;
      const key = Math.random() < 0.25 ? SKIP : t.name;
      votes.set(key, (votes.get(key) ?? 0) + 1);
    }
    for (const c of alive) {
      const k = Math.random() < 0.3 ? SKIP : alive[Math.floor(Math.random() * alive.length)]?.name;
      if (k !== undefined) votes.set(k, (votes.get(k) ?? 0) + 1);
    }
    const result = tallyVotes(votes, alive.length);
    if (result.ejected === null) {
      log(`EJECTION // NONE (${result.reason})`);
    } else {
      const victim = crews.find((c) => c.name === result.ejected);
      if (victim !== undefined) {
        victim.alive = false;
        log(`EJECTION // ${victim.name} — ${result.reason}`, 'bad');
      }
    }
    state.phase = 'PLAY';
    updateHud();
  }, delay + 1400);
}

function syncAliveVisuals(): void {
  for (const c of crews) {
    if (!c.alive) c.mesh.visible = false;
  }
}

// --- vision ---------------------------------------------------------------
/**
 * One overlay mesh per crewmate, plus the player's own. The cone is a flat
 * sector hanging just above the floor: from a steep top-down angle it reads as
 * a light pool, which is exactly the Among Us information model made physical.
 */
interface Cone { mesh: THREE.Mesh; owner: Crew | 'player'; }
const cones: Cone[] = [];

function makeCone(color: number, opacity: number): THREE.Mesh {
  const geo = new THREE.CircleGeometry(1, 40, Math.PI / 2 - VIEW.visionHalfAngle, VIEW.visionHalfAngle * 2);
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.06;
  return mesh;
}

function buildCones(): void {
  const own = makeCone(0x9fd6dc, 0.06);
  scene.add(own);
  cones.push({ mesh: own, owner: 'player' });
  for (const c of crews) {
    const cone = makeCone(0x6f8f92, 0.045);
    scene.add(cone);
    cones.push({ mesh: cone, owner: c });
  }
}

function updateCones(): void {
  const lightsOut = state.lightsOut;
  for (const cone of cones) {
    const owner = cone.owner === 'player' ? null : cone.owner;
    if (owner !== null && !owner.alive) {
      cone.mesh.visible = false;
      continue;
    }
    cone.mesh.visible = true;
    const pos = owner === null ? player.pos : owner.pos;
    const yaw = owner === null ? player.yaw : owner.yaw;
    // The player sees at crew vision; other crew have their own lamps.
    const radius = owner === null
      ? (lightsOut ? VIEW.crewVision * 0.35 : VIEW.crewVision)
      : VIEW.crewVision * 0.55;
    const halfAngle = owner === null
      ? (lightsOut ? THREE.MathUtils.degToRad(20) : VIEW.visionHalfAngle)
      : VIEW.visionHalfAngle;
    // Rebuild the sector only when the angle actually changes (lights sabotage).
    const mat = cone.mesh.material as THREE.MeshBasicMaterial;
    if (mat.userData['halfAngle'] !== halfAngle) {
      cone.mesh.geometry.dispose();
      cone.mesh.geometry = new THREE.CircleGeometry(1, 40, Math.PI / 2 - halfAngle, halfAngle * 2);
      mat.userData['halfAngle'] = halfAngle;
    }
    mat.opacity = owner === null ? (lightsOut ? 0.045 : 0.07) : 0.04;
    cone.mesh.position.set(pos.x, 0.06, pos.z);
    // CircleGeometry's zero angle points +X; align to the owner's facing (+Z).
    cone.mesh.rotation.set(-Math.PI / 2, 0, -yaw + Math.PI / 2);
    cone.mesh.scale.set(radius, radius, 1);
  }
}

// --- shadow: everything outside a crew's cone is genuinely dark ------------
/**
 * The single most important "SIGNALIS" affordance: visibility is *derived*, not
 * decorative. Crewmates whose cone contains the player are drawn lit; everyone
 * else dissolves into the dark. Implemented cheaply by toggling opacity on the
 * body material rather than per-frame occlusion tests.
 */
function updateCrewVisibility(): void {
  for (const c of crews) {
    if (!c.alive) {
      c.mesh.visible = false;
      continue;
    }
    const to = c.pos.clone().sub(player.pos);
    const dist = to.length();
    const facing = Math.atan2(to.x, to.z);
    let delta = Math.abs(facing - player.yaw) % (Math.PI * 2);
    if (delta > Math.PI) delta = Math.PI * 2 - delta;
    const half = state.lightsOut ? THREE.MathUtils.degToRad(20) : VIEW.visionHalfAngle;
    const radius = state.lightsOut ? VIEW.crewVision * 0.35 : VIEW.crewVision;
    const withinCone = dist <= radius && delta <= half;
    const proximity = dist < 2.2; // the "eyes in the back of the head" rule
    // Unseen crewmates are not drawn at all. This is the Among Us information
    // model made physical: you do not get to see what you cannot see.
    c.mesh.visible = withinCone || proximity;
  }
}

// --- camera ---------------------------------------------------------------
function updateCamera(): void {
  const back = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw)).multiplyScalar(-VIEW.backOffset);
  const target = player.pos.clone().add(back);
  target.y = VIEW.eyeHeight;
  camera.position.lerp(target, 0.12);
  const look = player.pos.clone();
  look.y = 1.0;
  look.add(new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw)).multiplyScalar(3.2));
  camera.lookAt(look);
}

// --- HUD ------------------------------------------------------------------
function updateHud(): void {
  const set = (id: string, text: string, alarm = false): void => {
    const el = document.getElementById(id);
    if (el === null) return;
    el.textContent = text;
    el.classList.toggle('alarm', alarm);
  };
  const aliveCrew = crews.filter((c) => c.alive).length + (crews.some((c) => !c.alive) ? 0 : 0);
  set('phase', state.phase);
  set('tasks', `TASKS ${state.tasksDone}/${state.tasksTotal}`);
  set('crew', `CREW ${aliveCrew}`, aliveCrew <= 4);
  set('moodle', state.lightsOut ? 'PANICKED' : player.moodle, state.lightsOut);
  const panic = document.getElementById('panic');
  if (panic !== null) panic.style.opacity = state.lightsOut ? '1' : '0';
}

// --- loop -----------------------------------------------------------------
const clock = new THREE.Clock();
let lastTaskFlash = 0;

function movePlayer(dt: number): void {
  if (state.phase !== 'PLAY') return;
  const wantSprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const sprinting = wantSprint && player.stamina > 0.05;
  const speed = sprinting ? player.sprint : player.speed;
  player.stamina = THREE.MathUtils.clamp(player.stamina + (sprinting ? -0.35 : 0.22) * dt, 0, 1);
  player.moodle = player.stamina < 0.25 ? 'WINDED' : player.stamina < 0.6 ? 'TIRED' : 'FOCUSED';

  let fx = 0;
  let fz = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) fz -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) fz += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) fx -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) fx += 1;
  if (fx === 0 && fz === 0) return;
  const len = Math.hypot(fx, fz);
  fx /= len; fz /= len;
  player.pos.x += fx * speed * dt;
  player.pos.z += fz * speed * dt;
  const wantYaw = Math.atan2(fx, fz);
  let delta = wantYaw - player.yaw;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  player.yaw += delta * Math.min(1, dt * 10);
  playerMesh.position.copy(player.pos);
  playerMesh.rotation.y = player.yaw;
}

let killTimer = 0;

function tickKills(dt: number): void {
  if (state.phase !== 'PLAY') return;
  killTimer += dt;
  if (killTimer < RULES.killCooldownSeconds) return;
  killTimer = 0;
  const victims = crews.filter((c) => c.alive && !c.impostor);
  const victim = victims[Math.floor(Math.random() * victims.length)];
  if (victim === undefined) return;
  // The player is not a member of `crews` in this slice, so it cannot be the
  // victim; this viewer demonstrates the loop around a living player.
  victim.alive = false;
  state.bodies.push({ room: roomAt(victim.pos), pos: victim.pos.clone(), found: false });
  log(`NO SIGNAL // ${roomAt(victim.pos)}`, 'bad');
  syncAliveVisuals();
  updateHud();
}

function animate(): void {
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = clock.elapsedTime;
  movePlayer(dt);
  for (const c of crews) tickCrew(c, now, dt);
  tickKills(dt);
  updateCones();
  updateCrewVisibility();
  updateCamera();
  syncAliveVisuals();

  // Fixture flicker: cheap, but it is the atmosphere.
  for (const obj of scene.children) {
    if (obj instanceof THREE.PointLight && obj !== playerLight) {
      obj.intensity = 9 * (0.94 + Math.sin(now * 7.3 + obj.position.x) * 0.04 + Math.random() * 0.02);
    }
  }
  if (state.lightsOut) {
    hemi.intensity = 0.08;
    scene.fog = new THREE.Fog(0x05070a, 10, 24);
  } else {
    hemi.intensity = 0.35;
    scene.fog = new THREE.Fog(0x05070a, 26, 54);
  }
  playerLight.position.set(player.pos.x, 2.4, player.pos.z);

  if (now - lastTaskFlash > 9) {
    lastTaskFlash = now;
    // Ambient machinery noise, printed as diegetic telemetry (audio lands later).
    const rooms = ['Electrical', 'Storage', 'Reactor', 'Corridor'];
    const r = rooms[Math.floor(Math.random() * rooms.length)] ?? 'Corridor';
    log(`TELEMETRY // ${r} — impact rattle`);
  }

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- boot -----------------------------------------------------------------
buildRooms();
spawnCrew();
buildCones();
updateHud();
log('BOOT // KESTREL-9 CREW MANIFEST LOADED');
log('MANIFEST // 10 PERSONNEL · 2 SEALS UNVERIFIED');
log('TELEMETRY // hull temperature below spec', 'bad');
animate();

// Expose a tiny diagnostics surface for manual poking in devtools.
declare global {
  interface Window {
    __vessels?: { state: typeof state; crews: Crew[]; evaluatePlay: typeof evaluatePlay };
  }
}
window.__vessels = { state, crews, evaluatePlay };
