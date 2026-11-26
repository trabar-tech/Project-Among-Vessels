/**
 * Headless match simulation (ported from tools/sim_headless.py so the 3D client
 * and the balance probe share one rules core). Deterministic per seed.
 *
 * This intentionally models the *social* loop, not space: it is the same coarse
 * probe validated in 01_DEV_TOOLS.md §3, with the same guard band.
 */
import { RULES } from './rules.ts';
import { tallyVotes, SKIP } from './vote.ts';
import { evaluatePlay } from './state.ts';

export const NAMES = [
  'Red', 'Blue', 'Green', 'Pink', 'Yellow', 'Cyan', 'Purple', 'White', 'Black', 'Brown',
] as const;

export interface Agent {
  name: string;
  impostor: boolean;
  alive: boolean;
  tasksLeft: number;
  suspicion: Map<string, number>;
}

export interface MatchParams {
  roundSeconds: number;
  taskRate: number;
  ghostTaskRate: number;
  witnessChance: number;
  misattributeChance: number;
  reportChance: number;
  sabotageChance: number;
  sabotageUnresolved: number;
  speakThreshold: number;
  baseCredibility: number;
  frameCredibility: number;
  propagation: number;
  scapegoatBoost: number;
  voteNoise: number;
  paranoia: number;
}

export const DEFAULT_PARAMS: MatchParams = {
  roundSeconds: 30,
  taskRate: 1.45,
  ghostTaskRate: 0.7,
  witnessChance: 0.3,
  misattributeChance: 0.15,
  reportChance: 0.62,
  sabotageChance: 0.22,
  sabotageUnresolved: 0.1,
  speakThreshold: 0.18,
  baseCredibility: 0.6,
  frameCredibility: 0.55,
  propagation: 0.55,
  scapegoatBoost: 0.22,
  voteNoise: 0.18,
  paranoia: 0.02,
};

export type Winner = 'crew_tasks' | 'crew_eject' | 'impostor_parity' | 'impostor_sabotage';

export interface MatchResult {
  winner: Winner;
  rounds: number;
  kills: number;
  ejections: number;
  correctEjections: number;
  durationSeconds: number;
}

/** Mulberry32: small, fast, deterministic. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const pick = <T,>(rng: () => number, arr: readonly T[]): T => {
  const v = arr[Math.floor(rng() * arr.length)];
  if (v === undefined) throw new Error('pick from empty array');
  return v;
};

export function runMatch(
  rng: () => number,
  players = RULES.players,
  impostors = RULES.impostors,
  p: MatchParams = DEFAULT_PARAMS,
): MatchResult {
  const agents: Agent[] = [];
  for (let i = 0; i < players; i++) {
    agents.push({
      name: NAMES[i] ?? `Bot${i}`,
      impostor: false,
      alive: true,
      tasksLeft: RULES.tasksPerCrewmate,
      suspicion: new Map(),
    });
  }
  // Assign impostors without replacement.
  let assigned = 0;
  while (assigned < impostors) {
    const a = pick(rng, agents);
    if (a.impostor) continue;
    a.impostor = true;
    assigned++;
  }
  const byName = new Map(agents.map((a) => [a.name, a]));
  for (const a of agents) {
    for (const o of agents) {
      if (o !== a) a.suspicion.set(o.name, rng() * 0.08);
    }
  }

  let killCdLeft = 0;
  let kills = 0;
  let ejections = 0;
  let correct = 0;
  let t = 0;
  let round = 0;
  let meetingGap = 0;
  let dread = 0;

  while (round < 300) {
    round++;
    t += p.roundSeconds;
    const alive = agents.filter((a) => a.alive);
    const aliveImps = alive.filter((a) => a.impostor);
    const aliveCrew = alive.filter((a) => !a.impostor);
    const tasksRemaining = agents.reduce((n, a) => n + (a.impostor ? 0 : a.tasksLeft), 0);

    // --- kills (one per round, gated by cooldown + director dread)
    let killedNow = 0;
    dread = Math.max(0, dread - 0.02 * p.roundSeconds);
    killCdLeft -= p.roundSeconds;
    if (killCdLeft <= 0 && aliveCrew.length > 0 && dread < 1.0) {
      const imp = pick(rng, aliveImps);
      const victim = pick(rng, aliveCrew);
      victim.alive = false;
      killedNow = 1;
      kills++;
      dread += 0.35;
      killCdLeft = RULES.killCooldownSeconds;
      for (const w of alive) {
        if (w === imp || w === victim || w.impostor) continue;
        if (rng() < p.witnessChance) {
          let blamed = imp.name;
          if (rng() < p.misattributeChance) {
            const others = alive.filter((x) => x !== imp && x !== w);
            if (others.length > 0) blamed = pick(rng, others).name;
          }
          w.suspicion.set(blamed, clamp01((w.suspicion.get(blamed) ?? 0) + 0.2 + rng() * 0.25));
        }
      }
    }

    // --- sabotage can end the round
    let sabotageHit = false;
    if (aliveImps.length > 0 && rng() < p.sabotageChance && rng() < p.sabotageUnresolved) {
      sabotageHit = true;
    }

    // --- termination, in the documented order (02 §3)
    const outcome = evaluatePlay({
      aliveImpostors: aliveImps.length - (killedNow > 0 ? 0 : 0),
      aliveCrewmates: agents.filter((a) => a.alive && !a.impostor).length,
      crisisExpired: sabotageHit,
      tasksRemaining,
      bodyReported: false,
      buttonPressed: false,
    });
    if (outcome.kind === 'parity') return done('impostor_parity');
    if (outcome.kind === 'sabotage') return done('impostor_sabotage');

    // --- crew task work (ghosts keep working)
    for (const a of agents) {
      if (a.impostor || a.tasksLeft <= 0) continue;
      const rate = a.alive ? p.taskRate : p.ghostTaskRate;
      if (rng() < rate) a.tasksLeft--;
    }
    if (agents.every((a) => a.impostor || a.tasksLeft <= 0)) return done('crew_tasks');

    // --- ambient paranoia
    for (const a of alive) {
      for (const o of alive) {
        if (o === a) continue;
        a.suspicion.set(o.name, clamp01((a.suspicion.get(o.name) ?? 0) + rng() * p.paranoia));
      }
    }

    // --- meeting?
    meetingGap += p.roundSeconds;
    const meeting = (killedNow > 0 && rng() < p.reportChance) || (meetingGap > 210 && rng() < 0.25);
    if (!meeting) continue;
    meetingGap = 0;

    // Impostors pick a scapegoat: the crewmate the room is primed to doubt.
    for (const imp of alive.filter((a) => a.impostor)) {
      const innocents = alive.filter((a) => !a.impostor);
      if (innocents.length === 0) continue;
      const heat = innocents.map((a) => ({
        name: a.name,
        total: alive.reduce((s, x) => s + (x.suspicion.get(a.name) ?? 0), 0),
      }));
      heat.sort((a, b) => b.total - a.total);
      const goat = heat[0]?.name;
      if (goat !== undefined && rng() < 0.8) {
        imp.suspicion.set(goat, clamp01((imp.suspicion.get(goat) ?? 0) + p.scapegoatBoost));
      }
    }

    // Quick-Chat claims: strongest suspicion above threshold.
    const claims: { speaker: string; target: string; strength: number }[] = [];
    for (const spk of alive) {
      for (let u = 0; u < 2; u++) {
        const cands = [...spk.suspicion.entries()]
          .filter(([n]) => n !== spk.name && byName.get(n)?.alive)
          .sort((a, b) => b[1] - a[1]);
        const best = cands[0];
        if (best === undefined || best[1] < p.speakThreshold) break;
        claims.push({ speaker: spk.name, target: best[0], strength: best[1] });
      }
    }
    for (const c of claims) {
      const speaker = byName.get(c.speaker);
      if (speaker === undefined) continue;
      const cred = speaker.impostor ? p.frameCredibility : p.baseCredibility;
      for (const listener of alive) {
        if (listener.name === c.speaker || listener.name === c.target) continue;
        const trust = clamp01(1 - (listener.suspicion.get(c.speaker) ?? 0));
        const delta = cred * trust * p.propagation * Math.min(0.35, c.strength) * 0.35;
        listener.suspicion.set(c.target, clamp01((listener.suspicion.get(c.target) ?? 0) + delta));
      }
    }

    // Vote.
    const votes = new Map<string, number>();
    for (const v of alive) {
      const cands = [...v.suspicion.entries()]
        .filter(([n]) => n !== v.name && byName.get(n)?.alive)
        .sort((a, b) => b[1] - a[1]);
      const first = cands[0];
      if (first === undefined) continue;
      const useSecond = cands.length > 1 && rng() < p.voteNoise;
      const chosen = useSecond ? cands[1] : first;
      if (chosen === undefined) continue;
      if (chosen[1] < 0.42) {
        votes.set(SKIP, (votes.get(SKIP) ?? 0) + 1);
      } else {
        votes.set(chosen[0], (votes.get(chosen[0]) ?? 0) + 1);
      }
    }
    if (votes.size === 0) continue;
    const result = tallyVotes(votes, alive.length);
    if (result.ejected !== null) {
      const ejected = byName.get(result.ejected);
      if (ejected !== undefined) {
        ejected.alive = false;
        ejections++;
        if (ejected.impostor) {
          correct++;
          for (const a of agents) {
            if (!a.alive || a.impostor) continue;
            for (const imp of alive.filter((x) => x.impostor)) {
              a.suspicion.set(imp.name, clamp01((a.suspicion.get(imp.name) ?? 0) + 0.05));
            }
          }
        } else {
          for (const a of agents) {
            if (!a.alive) continue;
            for (const c of claims) {
              if (c.target === result.ejected) {
                a.suspicion.set(c.speaker, clamp01((a.suspicion.get(c.speaker) ?? 0) + 0.1));
              }
            }
          }
        }
      }
    }
    // Post-meeting win checks.
    const impsLeft = agents.filter((a) => a.alive && a.impostor).length;
    const crewLeft = agents.filter((a) => a.alive && !a.impostor).length;
    if (impsLeft === 0) return done('crew_eject');
    if (impsLeft >= crewLeft) return done('impostor_parity');
  }
  return done('impostor_sabotage');

  function done(winner: Winner): MatchResult {
    return {
      winner,
      rounds: round,
      kills,
      ejections,
      correctEjections: correct,
      durationSeconds: Math.round(t),
    };
  }
}

export interface Summary {
  runs: number;
  winRates: Record<string, number>;
  crewWinRate: number;
  avgRounds: number;
  avgKills: number;
  avgEjections: number;
  ejectAccuracy: number;
  avgDurationSeconds: number;
}

export function summarise(results: readonly MatchResult[]): Summary {
  const n = results.length;
  const winRates: Record<string, number> = {};
  for (const r of results) winRates[r.winner] = (winRates[r.winner] ?? 0) + 1;
  for (const k of Object.keys(winRates)) {
    winRates[k] = Math.round(((winRates[k] ?? 0) / n) * 1000) / 1000;
  }
  const ejections = results.reduce((s, r) => s + r.ejections, 0);
  const correct = results.reduce((s, r) => s + r.correctEjections, 0);
  const crewWins = results.filter((r) => r.winner.startsWith('crew')).length;
  return {
    runs: n,
    winRates,
    crewWinRate: Math.round((crewWins / n) * 1000) / 1000,
    avgRounds: Math.round((results.reduce((s, r) => s + r.rounds, 0) / n) * 100) / 100,
    avgKills: Math.round((results.reduce((s, r) => s + r.kills, 0) / n) * 100) / 100,
    avgEjections: Math.round((ejections / n) * 100) / 100,
    ejectAccuracy: Math.round((correct / Math.max(1, ejections)) * 1000) / 1000,
    avgDurationSeconds: Math.round(results.reduce((s, r) => s + r.durationSeconds, 0) / n),
  };
}
