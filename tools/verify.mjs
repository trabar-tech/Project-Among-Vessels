/**
 * tools/verify.mjs
 * Static verification without a browser:
 *   1. every .js file parses (ESM)
 *   2. every relative import resolves to a real file
 *   3. every bare import is covered by the import map in index.html
 *   4. layering rules (render/ must not reach into world/, player/, ui/)
 *
 *   node tools/verify.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const checked = [];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) out.push(abs);
  }
  return out;
}

/** Parse the import map out of index.html. */
function readImportMap() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const match = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  if (!match) {
    errors.push('index.html: no <script type="importmap"> found');
    return { imports: {} };
  }
  try {
    return JSON.parse(match[1]);
  } catch (err) {
    errors.push(`index.html: import map is not valid JSON (${err.message})`);
    return { imports: {} };
  }
}

const importMap = readImportMap();

function resolveBare(specifier) {
  const imports = importMap.imports ?? {};
  if (imports[specifier]) return imports[specifier];
  for (const [key, value] of Object.entries(imports)) {
    if (key.endsWith('/') && specifier.startsWith(key)) {
      return value + specifier.slice(key.length);
    }
  }
  return null;
}

function fileExists(rel) {
  const candidates = [rel, `${rel}.js`, `${rel}.mjs`, path.join(rel, 'index.js')];
  return candidates.some((c) => {
    const abs = path.resolve(ROOT, c);
    return abs.startsWith(ROOT) && fs.existsSync(abs) && fs.statSync(abs).isFile();
  });
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:[^'"\n]*?\s+from\s+)?['"]([^'"]+)['"]/g;

const files = [
  ...walk(path.join(ROOT, 'src')),
  ...walk(path.join(ROOT, 'tools')),
  path.join(ROOT, 'tools/verify.mjs'),
];

// de-duplicate (tools dir already contains verify.mjs)
const unique = [...new Set(files)].sort();

for (const file of unique) {
  const rel = path.relative(ROOT, file);
  const source = fs.readFileSync(file, 'utf8');
  checked.push(rel);

  // 1. syntax via node --check (respects package.json "type": "module")
  const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (syntax.status !== 0) {
    errors.push(`${rel}: syntax error\n${(syntax.stderr || '').trim().split('\n').slice(0, 4).join('\n')}`);
  }

  // 2 & 3. imports
  let match;
  IMPORT_RE.lastIndex = 0;
  while ((match = IMPORT_RE.exec(source))) {
    const spec = match[1];
    if (spec.startsWith('node:')) continue;

    if (spec.startsWith('.')) {
      const base = path.dirname(file);
      const target = path.resolve(base, spec);
      const relTarget = path.relative(ROOT, target);
      if (!fileExists(relTarget)) {
        errors.push(`${rel}: unresolved relative import "${spec}"`);
      }
    } else if (rel.startsWith('tools/')) {
      // Node-only tooling may import dev dependencies directly.
      const pkgName = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
      if (!fs.existsSync(path.join(ROOT, 'node_modules', pkgName))) {
        errors.push(`${rel}: dev dependency "${pkgName}" is not installed (npm install)`);
      }
    } else {
      const mapped = resolveBare(spec);
      if (!mapped) {
        errors.push(`${rel}: bare import "${spec}" is not in the import map`);
      } else {
        const relTarget = mapped.replace(/^\.\//, '');
        if (!fileExists(relTarget)) {
          errors.push(`${rel}: import map target for "${spec}" does not exist (${mapped})`);
        }
      }
    }
  }

  // 4. layering
  if (rel.startsWith('src/render/')) {
    for (const forbidden of ['/world/', '/player/', '/ui/']) {
      if (source.includes(forbidden)) {
        errors.push(`${rel}: render/ must not import from ${forbidden}`);
      }
    }
  }
  if (rel.startsWith('src/core/')) {
    for (const forbidden of ['/world/', '/player/', '/ui/', '/render/', '/audio/']) {
      if (source.includes(forbidden)) {
        errors.push(`${rel}: core/ must not import from ${forbidden}`);
      }
    }
  }
}

// index.html must reference only files that exist
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
for (const m of html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)) {
  if (!fileExists(m[1])) errors.push(`index.html: missing ${m[1]}`);
}

// vendored runtime must exist (the page does not need node_modules)
for (const required of [
  'vendor/three/three.module.js',
  'vendor/three/three.core.js',
  'vendor/three/addons/utils/BufferGeometryUtils.js',
  'vendor/rapier/rapier.mjs',
]) {
  if (!fs.existsSync(path.join(ROOT, required))) errors.push(`missing vendored file: ${required}`);
}

/* --------------------------------------------------------------- report -- */
console.log(`verified ${checked.length} modules`);
console.log(`import map: ${Object.keys(importMap.imports ?? {}).join(', ')}`);

if (errors.length) {
  console.error(`\n${errors.length} problem(s):`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log('all checks passed');
