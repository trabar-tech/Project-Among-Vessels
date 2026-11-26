/**
 * Canonical rules constants. Mirrors tools/data/*.json, which is the source of
 * truth; `npm run check:rules` (tools/check_rules.py) diffs this file against
 * those JSONs and fails the build on drift.
 *
 * Do not hand-edit a number here without editing the JSON first.
 */

export const RULES = {
  players: 10,
  impostors: 2,
  tasksPerCrewmate: 6,
  killCooldownSeconds: 27.5,
  killRangeUnits: 1.8,
  sabotageCooldownSeconds: 20,
  doorLockSeconds: 10,
  crisisCountdownSeconds: 45,
  discussionSeconds: 30,
  votingSeconds: 90,
  emergencyMeetingsPerPlayer: 1,
  emergencyCooldownSeconds: 20,
  crewVisionMultiplier: 0.75,
  impostorVisionMultiplier: 1.5,
  playerSpeedMultiplier: 1.25,
  voteConfidence: 0.42,
} as const;

/** The 15-type grammar is frozen; identity types arrive in Phase 3 (doc 06). */
export const UTTERANCE_TYPES = [
  'REPORT_BODY', 'ACCUSE', 'DEFEND', 'ALIBI', 'TASK_CLAIM', 'SUSPICION',
  'VENT_SIGHTING', 'SABOTAGE_WITNESS', 'KILL_WITNESS', 'CLEAR',
  'VOTE_INTENT', 'AGREE', 'DISAGREE', 'QUESTION', 'EMERGENCY_CALL',
] as const;

export type UtteranceType = (typeof UTTERANCE_TYPES)[number];

export const LOCATIONS = [
  'Cafeteria', 'Electrical', 'MedBay', 'Reactor', 'O2', 'Admin', 'Security',
  'Storage', 'UpperEngine', 'LowerEngine', 'Navigation', 'Shields', 'Weapons',
  'Corridor',
] as const;

export type Location = (typeof LOCATIONS)[number];

/**
 * Adjacency of the ring+spine map (02 §2). Must be symmetric and connected;
 * `rules.test.ts` enforces both, and also enforces that O2/Security are not
 * cut-vertex dead ends (they host two-person crisis fixes, so they need two
 * independent routes or the fix becomes a guaranteed unreachable loss).
 */
export const ADJACENCY: Record<string, readonly string[]> = {
  Cafeteria: ['Weapons', 'Corridor', 'Admin'],
  Weapons: ['Cafeteria', 'Navigation', 'O2'],
  Navigation: ['Weapons', 'Shields'],
  Shields: ['Navigation', 'Storage', 'Security'],
  Storage: ['Shields', 'Admin', 'LowerEngine', 'UpperEngine'],
  Admin: ['Cafeteria', 'Storage', 'Corridor', 'Security', 'O2'],
  Corridor: ['Cafeteria', 'Admin', 'MedBay', 'Electrical', 'O2'],
  MedBay: ['Corridor', 'UpperEngine'],
  Electrical: ['Corridor', 'LowerEngine', 'Security'],
  UpperEngine: ['MedBay', 'Storage', 'Reactor'],
  LowerEngine: ['Electrical', 'Storage', 'Reactor'],
  Reactor: ['UpperEngine', 'LowerEngine'],
  O2: ['Admin', 'Weapons', 'Corridor'],
  Security: ['Admin', 'Shields', 'Electrical'],
};
