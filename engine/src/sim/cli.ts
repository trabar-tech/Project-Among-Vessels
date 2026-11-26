#!/usr/bin/env tsx
/**
 * Headless CLI: `npm run sim -- --runs 300 --seed 42`
 * Same guard band as tools/sim_headless.py (02 §8): crew win in [0.30, 0.60].
 */
import { runMatch, summarise, makeRng } from './match.ts';
import { RULES } from './rules.ts';

interface Args {
  runs: number;
  seed: number;
  guard: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { runs: 100, seed: 42, guard: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--runs' && next) { args.runs = Number(next); i++; }
    else if (a === '--seed' && next) { args.seed = Number(next); i++; }
    else if (a === 'guard') { args.guard = true; }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const rng = makeRng(args.seed);
const results = Array.from({ length: args.runs }, () => runMatch(rng));
const summary = summarise(results);

console.log(JSON.stringify({ ...summary, seed: args.seed, players: RULES.players, impostors: RULES.impostors }, null, 2));

if (args.guard) {
  const lo = 0.3;
  const hi = 0.6;
  const ok = summary.crewWinRate >= lo && summary.crewWinRate <= hi;
  console.log(`guard: crew_win_rate=${summary.crewWinRate} band=[${lo},${hi}] -> ${ok ? 'OK' : 'FAIL'}`);
  process.exit(ok ? 0 : 1);
}
