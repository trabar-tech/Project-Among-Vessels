/**
 * Among Us voting math (02 §7.2). Ported 1:1 from tools/validate_state.py so
 * the headless tool and the game cannot disagree.
 *
 *   - strict plurality ejects
 *   - ANY tie ejects nobody
 *   - a SKIP plurality ejects nobody
 *   - votes cast may not exceed living players
 */

export const SKIP = 'SKIP';

export interface VoteResult {
  ejected: string | null;
  reason: string;
}

export function tallyVotes(votes: Map<string, number>, alive: number): VoteResult {
  let total = 0;
  for (const n of votes.values()) {
    if (!Number.isInteger(n) || n < 0) throw new Error(`bad vote count ${n}`);
    total += n;
  }
  if (total > alive) throw new Error(`votes cast (${total}) exceed alive players (${alive})`);
  if (total === 0) return { ejected: null, reason: 'no votes' };

  const entries = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  const top = entries[0];
  if (top === undefined) return { ejected: null, reason: 'no votes' };

  const leaders = entries.filter(([, c]) => c === top[1]).map(([n]) => n);
  if (leaders.length > 1) return { ejected: null, reason: `tie among ${leaders.join(', ')} at ${top[1]}` };
  if (top[0] === SKIP) return { ejected: null, reason: 'skip won plurality' };
  return { ejected: top[0], reason: `plurality ${top[1]}/${total}` };
}
