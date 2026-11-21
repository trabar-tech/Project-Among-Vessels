/**
 * tools/preview-surfaces.mjs
 * Renders every procedural surface (albedo / normal / ORM) into a contact sheet
 * at tmp/surface-preview.png so the art can be reviewed without a browser.
 *
 *   node tools/preview-surfaces.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG } from './lib/png.mjs';
import { generateSurfaceData, SURFACE_SPECS } from '../src/render/surfacegen.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CELL = 192;
const GAP = 8;
const names = Object.keys(SURFACE_SPECS);
const cols = 3; // albedo | normal | orm
const sheetW = CELL * cols + GAP * (cols + 1);
const sheetH = CELL * names.length + GAP * (names.length + 1);
const sheet = new Uint8ClampedArray(sheetW * sheetH * 4);

// background
for (let i = 0; i < sheet.length; i += 4) {
  sheet[i] = 18;
  sheet[i + 1] = 20;
  sheet[i + 2] = 22;
  sheet[i + 3] = 255;
}

const started = Date.now();
let totalMs = 0;

names.forEach((name, row) => {
  const data = generateSurfaceData(name);
  totalMs += data.ms;
  const src = data.size;
  const maps = [data.albedo, data.normal, data.orm];
  maps.forEach((map, col) => {
    const ox = GAP + col * (CELL + GAP);
    const oy = GAP + row * (CELL + GAP);
    for (let y = 0; y < CELL; y++) {
      const sy = Math.floor((y / CELL) * src);
      for (let x = 0; x < CELL; x++) {
        const sx = Math.floor((x / CELL) * src);
        const si = (sy * src + sx) * 4;
        const di = ((oy + y) * sheetW + ox + x) * 4;
        sheet[di] = map[si];
        sheet[di + 1] = map[si + 1];
        sheet[di + 2] = map[si + 2];
        sheet[di + 3] = 255;
      }
    }
  });
  console.log(
    `${name.padEnd(9)} ${String(data.size).padStart(4)}px  ${data.ms.toFixed(0).padStart(4)} ms  (albedo | normal | orm)`
  );
});

const out = path.join(ROOT, 'tmp/surface-preview.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, encodePNG(sheetW, sheetH, sheet));
console.log(`\ntotal generation ${totalMs.toFixed(0)} ms -> ${path.relative(ROOT, out)} (${sheetW}x${sheetH})`);
console.log(`wall clock ${Date.now() - started} ms`);
