/**
 * tools/sync-vendor.mjs
 * Copies the exact dependency files the game loads at runtime out of
 * node_modules/ and into vendor/, so the running page never depends on a CDN
 * and never needs a bundler. Run after bumping a dependency:
 *
 *   npm install && npm run vendor
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @type {Array<[string,string]>} [source relative to node_modules, destination relative to repo] */
const FILES = [
  ['three/build/three.module.js', 'vendor/three/three.module.js'],
  ['three/build/three.core.js', 'vendor/three/three.core.js'],
  ['three/examples/jsm/utils/BufferGeometryUtils.js', 'vendor/three/addons/utils/BufferGeometryUtils.js'],
  ['three/LICENSE', 'vendor/three/LICENSE'],
  ['@dimforge/rapier3d-compat/dist/rapier.mjs', 'vendor/rapier/rapier.mjs'],
  ['@dimforge/rapier3d-compat/LICENSE', 'vendor/rapier/LICENSE'],
];

const VERSION_NOTES = {
  'vendor/three/LICENSE': 'Three.js r187 - MIT',
  'vendor/rapier/LICENSE': '@dimforge/rapier3d-compat 0.21.0 - Apache-2.0',
};

let copied = 0;
for (const [from, to] of FILES) {
  const src = path.join(ROOT, 'node_modules', from);
  const dst = path.join(ROOT, to);
  if (!fs.existsSync(src)) {
    console.error(`[vendor] MISSING ${from} - run "npm install" first.`);
    process.exitCode = 1;
    continue;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  const kb = (fs.statSync(dst).size / 1024).toFixed(0);
  console.log(`[vendor] ${to.padEnd(48)} ${kb.padStart(6)} KB`);
  copied++;
}

// Provenance file so a human can see what "vendor/" actually is.
const provenance = [
  '# Vendored runtime dependencies',
  '',
  'These files are copied verbatim from npm by `tools/sync-vendor.mjs`.',
  'The game loads them through the import map in `index.html`; no bundler',
  'and no CDN is involved at runtime.',
  '',
  ...Object.entries(VERSION_NOTES).map(([file, note]) => `- \`${file}\` - ${note}`),
  '',
  `Synced: ${new Date().toISOString()}`,
  '',
].join('\n');
fs.writeFileSync(path.join(ROOT, 'vendor/README.md'), provenance);

console.log(`[vendor] done - ${copied}/${FILES.length} files.`);
