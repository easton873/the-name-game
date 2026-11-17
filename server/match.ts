import { normalizeName } from '../shared/names.js';

/**
 * How many typos are forgiven when checking whether a typed name is one of the names still in
 * the pool. Set this to `() => 0` to require exact spelling (ignoring case, accents and spaces).
 */
export const typoTolerance = (len: number): number => (len <= 3 ? 0 : len <= 7 ? 1 : 2);

export type MatchResult = { kind: 'match'; name: string } | { kind: 'none' } | { kind: 'ambiguous' };

export function editDistance(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length];
}

/**
 * Which of the names still in the pool did the player mean? Only whole names can match (every
 * part of a multi-part name must be typed). The closest name wins; if two different names are
 * equally close the answer is "ambiguous". `pool` holds display names; the result is normalized.
 */
export function matchName(typed: string, pool: string[]): MatchResult {
  const t = normalizeName(typed);
  const names = [...new Set(pool.map(normalizeName))];
  let best = Infinity;
  let winners: string[] = [];
  for (const n of names) {
    const d = editDistance(t, n);
    if (d > typoTolerance(Math.max(n.length, 1))) continue;
    if (d < best) {
      best = d;
      winners = [n];
    } else if (d === best) winners.push(n);
  }
  if (!winners.length) return { kind: 'none' };
  if (winners.length > 1) return { kind: 'ambiguous' };
  return { kind: 'match', name: winners[0] };
}
