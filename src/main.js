/**
 * src/main.js
 * Composition root: builds the renderer, world, ship and systems, then wires
 * them to the bus and the fixed-step loop. Gameplay rules do not live here.
 */
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { CONFIG } from './core/config.js';
import { bus } from './core/bus.js';
import { Loop } from './core/loop.js';
import { Input } from './core/input.js';
import { createSurfaceTextures } from './render/textures.js';
import { createMaterials } from './render/materials.js';
import { createShipEnvironment } from './render/environment.js';
import { Synth } from './audio/synth.js';
import { SHIP } from './world/blueprint.js';
import { buildShip, LightPool } from './world/builder.js';
import { buildProps } from './world/props.js';
import { Doors } from './world/doors.js';
import { PowerSystem } from './world/power.js';
import { Interaction } from './world/interaction.js';
import { Player } from './player/controller.js';
import { Hud } from './ui/hud.js';

const hud = new Hud({ rooms: SHIP.rooms });

const CONSOLE_FLAVOUR = [
  'Duty roster: 8 souls aboard, 7 registered. Discrepancy flagged to corporate.',
  'Life support nominal. CO₂ scrubbers at 62%. Nobody has serviced them since Proxima.',
  'Cargo manifest: 412 crates declared, 409 scanned. Three missing since last port.',
  'Jump drive spooling. 11 minutes of fuel margin. Do not run the reactor hot.',
  'Medical log: one untreated fracture, one request for sedation, no names attached.',
  'Door logs: Airlock cycled at 03:12. No badge recorded.',
];

async function boot() {
  /* ------------------------------------------------------------- physics -- */
  hud.setLoading('initialising physics', 0.02);
  await RAPIER.init();

  /* ------------------------------------------------------------- assets --- */
  hud.setLoading('baking surfaces', 0.06);
  const surfaces = await createSurfaceTextures({
    onProgress: (name, fraction) => {
      hud.setLoading(`baking ${name}…`, 0.06 + fraction * 0.44);
    },
  });
  const mats = createMaterials(surfaces);

  /* ------------------------------------------------------------ renderer -- */
  hud.setLoading('assembling hull', 0.56);
  const canvas = document.getElementById('view');
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.MAX_PIXEL_RATIO));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = CONFIG.EXPOSURE;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(CONFIG.FOG_COLOR);
  scene.fog = new THREE.FogExp2(CONFIG.FOG_COLOR, CONFIG.FOG_DENSITY);

  const camera = new THREE.PerspectiveCamera(
    CONFIG.FOV,
    window.innerWidth / window.innerHeight,
    CONFIG.NEAR,
    CONFIG.FAR
  );
  scene.add(camera);

  // Image-based lighting first: without an environment, the metallic surfaces
  // have nothing to reflect and read as black no matter how bright the lamps are.
  scene.environment = createShipEnvironment(renderer);
  scene.environmentIntensity = 0.75;

  // Then a shallow fill so corners and shadowed bulkheads stay readable.
  const ambient = new THREE.AmbientLight(0x36464f, 0.42);
  const hemisphere = new THREE.HemisphereLight(0x46606c, 0x14110f, 0.5);
  scene.add(ambient, hemisphere);

  /* --------------------------------------------------------------- world -- */
  const world = new RAPIER.World({ x: 0, y: CONFIG.GRAVITY, z: 0 });
  world.timestep = CONFIG.FIXED_STEP;

  const ship = buildShip({ scene, world, RAPIER, mats, ship: SHIP });
  hud.setLoading('bolting props', 0.7);
  const props = buildProps({ scene, world, RAPIER, mats, ship: SHIP, shipBody: ship.staticBody });
  const power = new PowerSystem({ scene, mats, ship: SHIP, bus });
  const doors = new Doors({ scene, world, RAPIER, mats, ship: SHIP, bus });

  hud.setLoading('waking crew', 0.86);
  const player = new Player({
    world,
    RAPIER,
    camera,
    scene,
    spawn: SHIP.spawn,
    spawnYaw: SHIP.spawnYaw,
    roomAt: ship.roomAt,
    bus,
  });

  const roomById = new Map(SHIP.rooms.map((r) => [r.id, r]));
  player.surfaceOf = (roomId) => roomById.get(roomId)?.floor ?? 'deck';

  const interaction = new Interaction({ camera, bus, scene });
  const lightPool = new LightPool({ scene, fixtures: ship.fixtures });
  const synth = new Synth();

  /* ---------------------------------------------------------- interaction -- */
  for (const consoleSpec of ship.consoles) {
    interaction.register({
      id: `console:${consoleSpec.id}`,
      object: consoleSpec.object,
      label: () => consoleSpec.label,
      verb: 'Access',
      hold: 0,
      onUse: () => {
        bus.emit('audio:cue', { cue: 'beep', opts: { ok: true } });
        bus.emit('ui:prompt', {
          text: CONSOLE_FLAVOUR[Math.floor(Math.random() * CONSOLE_FLAVOUR.length)],
          tone: 'info',
        });
      },
    });
  }
  for (const spec of power.interactables()) interaction.register(spec);
  for (const spec of doors.interactables()) interaction.register(spec);

  /* -------------------------------------------------------------- audio --- */
  bus.on('audio:cue', ({ cue, opts }) => {
    switch (cue) {
      case 'door':
        synth.doorSlide(opts?.open ?? true);
        break;
      case 'doorClunk':
        synth.doorClunk();
        break;
      case 'breaker':
        synth.breaker(opts?.on ?? true);
        break;
      case 'beep':
        synth.beep(opts?.ok ?? true);
        break;
      case 'pry':
        synth.pry();
        break;
      case 'alarm':
        synth.alarm(opts?.on ?? true);
        break;
      default:
        break;
    }
  });
  bus.on('player:footstep', ({ surface, speed }) => synth.footstep(surface, speed));

  /* -------------------------------------------------------------- input --- */
  let active = false;
  const input = new Input({
    element: canvas,
    onLockChange: (locked) => {
      active = locked;
      interaction.setEnabled(locked);
      hud.setHudVisible(locked);
      if (locked) hud.hideOverlay();
      else hud.showOverlay('paused');
    },
  });

  document.getElementById('enter').addEventListener('click', async () => {
    await synth.unlock();
    input.requestLock();
    setTimeout(() => {
      if (!input.locked) hud.toast('Pointer lock was blocked — click the view to retry', 'warn');
    }, 700);
  });

  canvas.addEventListener('click', () => {
    if (!input.locked) input.requestLock();
  });

  /* --------------------------------------------------------------- loop --- */
  let elapsed = 0;
  let statsTimer = 0;
  let powerTimer = 0;
  const tmpPos = new THREE.Vector3();

  const syncProps = () => {
    for (const entry of props.dynamic) {
      if (entry.body && entry.mesh) {
        const t = entry.body.translation();
        const r = entry.body.rotation();
        entry.mesh.position.set(t.x, t.y, t.z);
        entry.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      } else if (entry.pulse) {
        entry.pulse.mat.emissiveIntensity =
          entry.pulse.base * (0.8 + 0.2 * Math.sin(elapsed * 1.7 + entry.pulse.phase));
      }
    }
  };

  const simulate = (dt) => {
    if (!active) {
      input.endFrame();
      return;
    }
    elapsed += dt;

    power.fixedUpdate(dt);
    doors.fixedUpdate(dt, player.position, power);
    player.fixedUpdate(dt, input);
    interaction.update(dt, input);

    world.step();
    syncProps();

    if (input.justPressed('KeyR')) player.respawn('manual');
    if (player.feetY < -6) player.respawn('void');

    if (input.justPressed('F3')) hud.toggleStats();
    if (input.justPressed('Minus')) {
      renderer.toneMappingExposure = Math.max(0.4, renderer.toneMappingExposure - 0.1);
      hud.toast(`exposure ${renderer.toneMappingExposure.toFixed(2)}`, 'info');
    }
    if (input.justPressed('Equal')) {
      renderer.toneMappingExposure = Math.min(2.6, renderer.toneMappingExposure + 0.1);
      hud.toast(`exposure ${renderer.toneMappingExposure.toFixed(2)}`, 'info');
    }

    input.endFrame();
  };

  const render = (dt) => {
    // fixture emissives follow their circuit, with a little filament wobble
    for (const fixture of ship.fixtures) {
      const level = power.level(fixture.circuit);
      const wobble = 0.94 + 0.06 * Math.sin(elapsed * 2.3 + fixture.phase);
      fixture.material.emissiveIntensity = fixture.baseIntensity * level * wobble;
    }

    player.syncCamera();
    tmpPos.copy(player.position);
    lightPool.update(dt, tmpPos, power);

    powerTimer += dt;
    if (powerTimer > 0.4) {
      powerTimer = 0;
      synth.setPower(power.ambience());
    }

    statsTimer += dt;
    if (statsTimer > 0.5) {
      statsTimer = 0;
      const info = renderer.info.render;
      hud.setStats({
        fps: loop.fps,
        calls: info.calls,
        tris: info.triangles,
        bodies: world.bodies?.len?.() ?? 0,
        steps: loop.steps,
      });
    }

    renderer.render(scene, camera);
  };

  const loop = new Loop({ update: simulate, render });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.MAX_PIXEL_RATIO));
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    hud.error('WebGL context lost', 'The GPU dropped the context. Reload to re-board.');
  });

  /* --------------------------------------------------------------- ready -- */
  hud.setLoading('ready', 1);
  hud.ready();
  hud.setBattery(false, 100);
  hud.setRoom('CORRIDOR');
  hud.setStats({ fps: 0, calls: 0, tris: 0, bodies: 0, steps: 0 });

  // Expose for debugging and for the verification notes in PROJECT_BRAIN.md.
  window.__GAME = {
    THREE, RAPIER, scene, renderer, world, camera, player, power, doors, ship, props, bus, synth, hud, loop,
    /** Console helper: __GAME.lighting(0.8) dims the whole ship, (1.6) lifts it. */
    lighting(scale = 1) {
      scene.environmentIntensity = 0.75 * scale;
      ambient.intensity = 0.42 * scale;
      hemisphere.intensity = 0.5 * scale;
      player.flashlight.intensity = CONFIG.FLASHLIGHT_INTENSITY * scale;
      for (const f of ship.fixtures) f.baseIntensity = f.originalBaseIntensity * scale;
      return scale;
    },
  };
  window.__BOOTED = true;
  bus.emit('game:ready', { ms: performance.now() });

  console.info(
    `[among-vessels] ${SHIP.name} online · ${ship.stats.cells} cells · ${ship.stats.wallRuns} wall runs · ${ship.stats.colliders} colliders`
  );

  loop.start();
}

boot().catch((err) => {
  console.error(err);
  hud.error(err?.message ?? String(err), err?.stack ?? '');
});
