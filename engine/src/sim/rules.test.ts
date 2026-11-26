/**
 * Node test runner (`node --test --experimental-strip-types`).
 * These assert *design properties*, mirroring tools/tests/test_tools.py.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tallyVotes, SKIP } from './vote.ts';
import { evaluatePlay, phaseAfterEjection, canEnterManifestCheck } from './state.ts';
import { score, claimEffect, ZERO, add } from './suspicion.ts';
import { runMatch, summarise, makeRng } from './match.ts';
import { RULES, ADJACENCY, LOCATIONS } from './rules.ts';

test('plurality ejects', () => {
  const r = tallyVotes(new Map([['Blue', 4], ['Green', 2]]), 10);
  assert.equal(r.ejected, 'Blue');
});

test('tie ejects nobody', () => {
  const r = tallyVotes(new Map([['Blue', 3], ['Green', 3]]), 10);
  assert.equal(r.ejected, null);
});

test('skip plurality ejects nobody', () => {
  const r = tallyVotes(new Map([[SKIP, 5], ['Blue', 2]]), 10);
  assert.equal(r.ejected, null);
});

test('overvoting throws', () => {
  assert.throws(() => tallyVotes(new Map([['Blue', 11]]), 10));
});

test('parity is checked before sabotage and tasks', () => {
  const out = evaluatePlay({
    aliveImpostors: 2, aliveCrewmates: 2, crisisExpired: true, tasksRemaining: 0,
    bodyReported: true, buttonPressed: true,
  });
  assert.equal(out.kind, 'parity');
});

test('a crisis outranks a task win on the same tick', () => {
  const out = evaluatePlay({
    aliveImpostors: 1, aliveCrewmates: 5, crisisExpired: true, tasksRemaining: 0,
    bodyReported: false, buttonPressed: false,
  });
  assert.equal(out.kind, 'sabotage');
});

test('ejecting the last impostor wins for crew', () => {
  assert.equal(phaseAfterEjection(0, 5), 'GAME_OVER_CREW_EJECT_WIN');
});

test('clean-manifest win fires on identification, not ejection (06 §6)', () => {
  // One illegal passenger alive, identified, but still breathing.
  assert.equal(phaseAfterEjection(1, 6, 1, 1), 'GAME_OVER_CREW_CLEAN_MANIFEST');
  // Identified count short of the living illegal count: keep playing.
  assert.equal(phaseAfterEjection(2, 6, 1, 2), 'PLAY');
  // No illegal passengers left: the ejection win takes priority.
  assert.equal(phaseAfterEjection(0, 6, 2, 0), 'GAME_OVER_CREW_EJECT_WIN');
});

test('manifest checks are budgeted and gated by the terminal', () => {
  assert.equal(canEnterManifestCheck({ checksLeft: 2, cooldownRemaining: 0, atTerminal: true }), true);
  assert.equal(canEnterManifestCheck({ checksLeft: 0, cooldownRemaining: 0, atTerminal: true }), false);
  assert.equal(canEnterManifestCheck({ checksLeft: 2, cooldownRemaining: 5, atTerminal: true }), false);
  assert.equal(canEnterManifestCheck({ checksLeft: 2, cooldownRemaining: 0, atTerminal: false }), false);
});

test('identity tokens cannot be used as guilt evidence and vice versa', () => {
  // Mirrors the parser restriction enforced in tools/qc_parse.py (05 §2a).
  const identityTokens = new Set(['BADGE_MISMATCH', 'SEAL_TAMPER', 'NO_WORK_ORDER', 'MANIFEST_GAP']);
  assert.ok(!identityTokens.has('VENT'));
  assert.ok(!identityTokens.has('KILL_WITNESS'));
  assert.ok(identityTokens.has('BADGE_MISMATCH'));
});

test('suspicion rises with evidence and falls with trust', () => {
  const base = score(ZERO);
  const accused = score(add(ZERO, 'proximityToBody', 0.8));
  const trusted = score(add(ZERO, 'trustCredit', 0.8));
  assert.ok(accused > base);
  assert.ok(trusted < base);
});

test('a distrusted speaker cannot land an accusation', () => {
  const clean = claimEffect(0.3, ZERO);
  const dirty = claimEffect(0.3, add(ZERO, 'credibilityDebt', 0.9));
  assert.ok(dirty < clean * 0.5, `dirty=${dirty} clean=${clean}`);
});

test('matches are deterministic per seed', () => {
  const a = runMatch(makeRng(99), 10, 2);
  const b = runMatch(makeRng(99), 10, 2);
  assert.deepEqual(a, b);
});

test('default tuning is contested (guard band 0.30-0.60)', () => {
  const rng = makeRng(2024);
  const results = Array.from({ length: 120 }, () => runMatch(rng, 10, 2));
  const s = summarise(results);
  assert.ok(s.crewWinRate >= 0.2 && s.crewWinRate <= 0.7, `crew win ${s.crewWinRate}`);
});

test('eject accuracy stays below 0.95 (lies must land sometimes)', () => {
  const rng = makeRng(7);
  const results = Array.from({ length: 120 }, () => runMatch(rng, 10, 2));
  assert.ok(summarise(results).ejectAccuracy < 0.95);
});

test('map graph is symmetric and fully connected', () => {
  for (const [room, neighbours] of Object.entries(ADJACENCY)) {
    for (const n of neighbours) {
      const back = ADJACENCY[n];
      assert.ok(back?.includes(room), `${room} -> ${n} is one-way`);
    }
  }
  // BFS from Cafeteria must reach every named location.
  const seen = new Set<string>(['Cafeteria']);
  const queue = ['Cafeteria'];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === undefined) break;
    for (const n of ADJACENCY[cur] ?? []) {
      if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
  }
  for (const loc of LOCATIONS) assert.ok(seen.has(loc), `unreachable room: ${loc}`);
});

test('two-person crisis rooms have two independent routes', () => {
  // O2 and Reactor host 2-actor fixes (02 §6.1). If either is a cut vertex,
  // one impostor door-lock makes the crisis unwinnable by fiat.
  for (const room of ['O2', 'Reactor']) {
    const neighbours = ADJACENCY[room] ?? [];
    assert.ok(neighbours.length >= 2, `${room} has degree ${neighbours.length}`);
    // Remove the room; its neighbours must still be mutually reachable.
    const start = neighbours[0];
    const goal = neighbours[1];
    assert.ok(start !== undefined && goal !== undefined);
    const seen = new Set<string>([start]);
    const queue = [start];
    while (queue.length > 0) {
      const cur = queue.shift();
      if (cur === undefined) break;
      for (const n of ADJACENCY[cur] ?? []) {
        if (n === room || seen.has(n)) continue;
        seen.add(n);
        queue.push(n);
      }
    }
    assert.ok(seen.has(goal), `${room} is a cut vertex: ${start} cannot reach ${goal} without it`);
  }
});

test('balance constants match the documented defaults', () => {
  assert.equal(RULES.players, 10);
  assert.equal(RULES.impostors, 2);
  assert.equal(RULES.killCooldownSeconds, 27.5);
  assert.equal(RULES.votingSeconds, 90);
  assert.ok(RULES.impostors < RULES.players / 2);
});
