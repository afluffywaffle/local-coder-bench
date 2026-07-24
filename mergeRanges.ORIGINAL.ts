// Merge and normalize a set of inclusive integer ranges.
// Pure, no dependencies.

export type Range = [number, number];

/**
 * Merge overlapping or adjacent inclusive integer ranges.
 * See mergeRanges_spec for exact rules.
 */
export function mergeRanges(ranges: Range[]): Range[] {
  if (!Array.isArray(ranges) || ranges.length === 0) return [];

  // Normalize each range so start <= end, dropping any non-finite ones.
  const norm: Range[] = [];
  for (const r of ranges) {
    if (!Array.isArray(r) || r.length !== 2) continue;
    let [a, b] = r;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (a > b) [a, b] = [b, a];
    norm.push([a, b]);
  }
  if (norm.length === 0) return [];

  norm.sort((x, y) => x[0] - y[0] || x[1] - y[1]);

  const out: Range[] = [norm[0].slice() as Range];
  for (let i = 1; i < norm.length; i++) {
    const cur = norm[i];
    const last = out[out.length - 1];
    // Merge when the next range overlaps or is integer-adjacent (touching
    // or a gap of exactly 1): cur.start <= last.end + 1.
    if (cur[0] <= last[1] + 1) {
      if (cur[1] > last[1]) last[1] = cur[1];
    } else {
      out.push(cur.slice() as Range);
    }
  }
  return out;
}
