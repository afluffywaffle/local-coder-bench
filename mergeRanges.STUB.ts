// Merge and normalize a set of inclusive integer ranges.
// Pure, no dependencies.

export type Range = [number, number];

/**
 * Merge overlapping or adjacent inclusive integer ranges into a sorted,
 * minimal set. Overlapping OR integer-adjacent ranges (a gap of at most 1)
 * are combined. Input may be unsorted and may contain reversed ([hi,lo]) pairs.
 */
export function mergeRanges(ranges: Range[]): Range[] {
  throw new Error("not implemented");
}
