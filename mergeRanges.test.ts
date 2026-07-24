import { describe, it, expect } from "vitest";
import { mergeRanges } from "./mergeRanges";

describe("mergeRanges", () => {
  it("empty and non-array inputs -> []", () => {
    expect(mergeRanges([])).toEqual([]);
    // @ts-expect-error deliberate misuse
    expect(mergeRanges(null)).toEqual([]);
  });

  it("a single range passes through", () => {
    expect(mergeRanges([[2, 5]])).toEqual([[2, 5]]);
  });

  it("merges overlapping ranges", () => {
    expect(mergeRanges([[1, 3], [2, 5]])).toEqual([[1, 5]]);
  });

  it("merges integer-adjacent ranges (gap of exactly 1)", () => {
    expect(mergeRanges([[1, 2], [3, 4]])).toEqual([[1, 4]]);
  });

  it("keeps ranges separated by a gap of 2 or more", () => {
    expect(mergeRanges([[1, 2], [4, 5]])).toEqual([[1, 2], [4, 5]]);
  });

  it("sorts unsorted input before merging", () => {
    expect(mergeRanges([[10, 12], [1, 3], [2, 4]])).toEqual([[1, 4], [10, 12]]);
  });

  it("normalizes reversed pairs", () => {
    expect(mergeRanges([[5, 2]])).toEqual([[2, 5]]);
    expect(mergeRanges([[5, 2], [3, 1]])).toEqual([[1, 5]]);
  });

  it("a fully-contained range does not shrink the outer one", () => {
    expect(mergeRanges([[1, 10], [3, 4]])).toEqual([[1, 10]]);
  });

  it("collapses duplicate identical ranges", () => {
    expect(mergeRanges([[1, 2], [1, 2], [1, 2]])).toEqual([[1, 2]]);
  });

  it("drops pairs with non-finite numbers", () => {
    expect(mergeRanges([[1, 2], [NaN, 5], [Infinity, 9]])).toEqual([[1, 2]]);
  });

  it("chains a run of overlapping/adjacent ranges into one", () => {
    expect(mergeRanges([[1, 2], [2, 3], [3, 4], [4, 5]])).toEqual([[1, 5]]);
  });

  it("handles a realistic unsorted mix", () => {
    expect(mergeRanges([[8, 10], [1, 3], [2, 2], [11, 12], [15, 16]])).toEqual([
      [1, 3],
      [8, 12],
      [15, 16],
    ]);
  });
});
