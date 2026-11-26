/**
 * Suspicion model (04 §7). Six separable components per (observer, subject),
 * squashed to [0,1]. Beliefs update ONLY from observations and claims —
 * there is no API that writes suspicion from world truth.
 */

export interface Suspicion {
  presenceAnomaly: number;
  proximityToBody: number;
  behaviouralTell: number;
  testimonyPressure: number;
  credibilityDebt: number;
  trustCredit: number;
}

export const ZERO: Suspicion = {
  presenceAnomaly: 0,
  proximityToBody: 0,
  behaviouralTell: 0,
  testimonyPressure: 0,
  credibilityDebt: 0,
  trustCredit: 0,
};

const W = {
  presenceAnomaly: 1.0,
  proximityToBody: 1.3,
  behaviouralTell: 0.8,
  testimonyPressure: 0.9,
  credibilityDebt: 1.1,
  trustCredit: 1.0,
} as const;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export function score(s: Suspicion): number {
  const raw =
    W.presenceAnomaly * s.presenceAnomaly +
    W.proximityToBody * s.proximityToBody +
    W.behaviouralTell * s.behaviouralTell +
    W.testimonyPressure * s.testimonyPressure +
    W.credibilityDebt * s.credibilityDebt -
    W.trustCredit * s.trustCredit;
  return 1 / (1 + Math.exp(-2.2 * (raw - 0.55))); // logistic squash
}

export function add(s: Suspicion, field: keyof Suspicion, amount: number): Suspicion {
  return { ...s, [field]: clamp01(s[field] + amount) };
}

/**
 * Listener-side claim modulation (05 §5.1):
 *   delta × credibility(speaker) × consistency × propagation
 * A distrusted speaker's accusation is worth almost nothing — that is the
 * self-correcting property the whole lie economy rests on.
 */
export function claimEffect(
  baseDelta: number,
  listenerSuspicionOfSpeaker: Suspicion,
  opts: { consistency?: number; propagation?: number } = {},
): number {
  const credibility = Math.max(0.05, 1 - score(listenerSuspicionOfSpeaker));
  const consistency = opts.consistency ?? 1;
  const propagation = opts.propagation ?? 0.55;
  return baseDelta * credibility * consistency * propagation;
}
