/**
 * Phase machine (02 §3). Mirrors tools/data/state_machine.json; the guard names
 * and evaluation order are part of the contract and are asserted by tests.
 */

export type Phase =
  | 'LOBBY'
  | 'BRIEFING'
  | 'PLAY'
  | 'MANIFEST_CHECK'
  | 'MEETING_DISCUSSION'
  | 'MEETING_VOTING'
  | 'EJECTION'
  | 'GAME_OVER_CREW_TASK_WIN'
  | 'GAME_OVER_CREW_EJECT_WIN'
  | 'GAME_OVER_IMPOSTOR_PARITY'
  | 'GAME_OVER_IMPOSTOR_SABOTAGE'
  | 'GAME_OVER_CREW_CLEAN_MANIFEST';

export const TERMINAL: ReadonlySet<Phase> = new Set<Phase>([
  'GAME_OVER_CREW_TASK_WIN',
  'GAME_OVER_CREW_EJECT_WIN',
  'GAME_OVER_IMPOSTOR_PARITY',
  'GAME_OVER_IMPOSTOR_SABOTAGE',
  'GAME_OVER_CREW_CLEAN_MANIFEST',
]);

/**
 * Evaluation order inside PLAY, per 02 §3:
 *   parity -> sabotage countdown -> task completion -> body/button detection.
 * A kill that reaches parity ends the game even if tasks are one tick away.
 */
export type PlayOutcome =
  | { kind: 'continue' }
  | { kind: 'parity' }
  | { kind: 'sabotage' }
  | { kind: 'tasks' }
  | { kind: 'meeting'; cause: 'body' | 'button' };

export function evaluatePlay(input: {
  aliveImpostors: number;
  aliveCrewmates: number;
  crisisExpired: boolean;
  tasksRemaining: number;
  bodyReported: boolean;
  buttonPressed: boolean;
}): PlayOutcome {
  if (input.aliveImpostors >= input.aliveCrewmates) return { kind: 'parity' };
  if (input.crisisExpired) return { kind: 'sabotage' };
  if (input.tasksRemaining <= 0) return { kind: 'tasks' };
  if (input.bodyReported) return { kind: 'meeting', cause: 'body' };
  if (input.buttonPressed) return { kind: 'meeting', cause: 'button' };
  return { kind: 'continue' };
}

export function phaseAfterEjection(
  aliveImpostors: number,
  aliveCrewmates: number,
  illegalIdentified = 0,
  illegalAlive = aliveImpostors,
): Phase {
  if (aliveImpostors <= 0) return 'GAME_OVER_CREW_EJECT_WIN';
  // Clean-manifest win (06 §6): identification, not ejection, is the condition.
  if (illegalAlive > 0 && illegalIdentified >= illegalAlive) return 'GAME_OVER_CREW_CLEAN_MANIFEST';
  if (aliveImpostors >= aliveCrewmates) return 'GAME_OVER_IMPOSTOR_PARITY';
  return 'PLAY';
}

/** Manifest check is a sub-phase of PLAY: it pauses nothing, it changes knowledge. */
export function canEnterManifestCheck(input: {
  checksLeft: number;
  cooldownRemaining: number;
  atTerminal: boolean;
}): boolean {
  return input.atTerminal && input.checksLeft > 0 && input.cooldownRemaining <= 0;
}
