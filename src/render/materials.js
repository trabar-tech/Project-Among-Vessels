/**
 * render/materials.js
 * Shared material library. Mapped materials use metalness/roughness = 1 so the
 * packed ORM texture has full authority over both channels.
 */
import * as THREE from 'three';
import { makeHazardTexture, makeScreenTexture, makeSignTexture } from './textures.js';

function mapped(surface, extra = {}) {
  const mat = new THREE.MeshStandardMaterial({
    map: surface.map,
    normalMap: surface.normalMap,
    roughnessMap: surface.roughnessMap,
    metalnessMap: surface.metalnessMap,
    roughness: 1,
    metalness: 1,
    normalScale: new THREE.Vector2(1, 1),
    ...extra,
  });
  // UV units per metre, consumed when building world-aligned UVs.
  mat.userData.uvScale = 1 / surface.meters;
  return mat;
}


/**
 * CRT-style screen: the generated telemetry texture is used as both albedo and
 * emissive map, so the panel emits its own text instead of glowing flat blue.
 */
function screenMaterial(title, accent, emissive, intensity) {
  const tex = makeScreenTexture(title, accent);
  return new THREE.MeshStandardMaterial({
    map: tex,
    emissive: new THREE.Color(emissive),
    emissiveMap: tex,
    emissiveIntensity: intensity,
    metalness: 0.1,
    roughness: 0.25,
  });
}

export function createMaterials(surfaces) {
  const mats = {
    // --- architecture ---
    hull: mapped(surfaces.hull),
    deck: mapped(surfaces.deck),
    grate: mapped(surfaces.grate),
    tile: mapped(surfaces.tile),
    ceiling: mapped(surfaces.ceiling),
    reactor: mapped(surfaces.reactor),

    // --- props (unmapped: small objects, cheap) ---
    propMetal: new THREE.MeshStandardMaterial({ color: 0x51565a, metalness: 0.8, roughness: 0.42 }),
    propDark: new THREE.MeshStandardMaterial({ color: 0x22262a, metalness: 0.55, roughness: 0.62 }),
    propPaint: new THREE.MeshStandardMaterial({ color: 0x6b5a2c, metalness: 0.35, roughness: 0.55 }),
    propPlastic: new THREE.MeshStandardMaterial({ color: 0x2b2f2c, metalness: 0.05, roughness: 0.72 }),
    propWhite: new THREE.MeshStandardMaterial({ color: 0xb9bfb8, metalness: 0.1, roughness: 0.55 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x14161a, metalness: 0.02, roughness: 0.9 }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x8fb6bd,
      metalness: 0.1,
      roughness: 0.08,
      transparent: true,
      opacity: 0.28,
    }),

    // --- emissive ---
    lampWarm: new THREE.MeshStandardMaterial({
      color: 0x3a352a,
      emissive: 0xffe6b0,
      emissiveIntensity: 2.4,
      metalness: 0.2,
      roughness: 0.4,
    }),
    lampCold: new THREE.MeshStandardMaterial({
      color: 0x2a3335,
      emissive: 0xa8e4ff,
      emissiveIntensity: 2.0,
      metalness: 0.2,
      roughness: 0.4,
    }),
    reactorGlow: new THREE.MeshStandardMaterial({
      color: 0x0a1414,
      emissive: 0x2fe0c0,
      emissiveIntensity: 1.8,
      metalness: 0.1,
      roughness: 0.5,
    }),
    alarmRed: new THREE.MeshStandardMaterial({
      color: 0x2a0a0a,
      emissive: 0xff2b2b,
      emissiveIntensity: 1.4,
      metalness: 0.2,
      roughness: 0.5,
    }),

    // --- decals / screens ---
    hazard: new THREE.MeshStandardMaterial({
      map: makeHazardTexture(),
      metalness: 0.2,
      roughness: 0.6,
    }),
    screen: screenMaterial('KESTREL // OPS', '#4fd6e6', 0x9fe8ff, 1.15),
    screenWarn: screenMaterial('PWR // BUS', '#e0a13c', 0xffc46b, 1.0),
    screenDead: screenMaterial('NO SIGNAL', '#5a6a6a', 0x223333, 0.4),
  };

  mats.signs = new Map();
  mats.sign = (roomName, sub = '') => {
    const key = `${roomName}|${sub}`;
    if (!mats.signs.has(key)) {
      mats.signs.set(
        key,
        new THREE.MeshStandardMaterial({
          map: makeSignTexture(roomName, sub),
          metalness: 0.15,
          roughness: 0.65,
          emissive: 0x2a2418,
          emissiveIntensity: 0.35,
        })
      );
    }
    return mats.signs.get(key);
  };

  return mats;
}
