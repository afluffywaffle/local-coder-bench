import { describe, it, expect } from "vitest";
import { parseQuery } from "./parseQuery";

describe("parseQuery", () => {
  it("empty inputs -> {}", () => {
    expect(parseQuery("")).toEqual({});
    expect(parseQuery("?")).toEqual({});
  });

  it("strips a leading ? and parses simple pairs", () => {
    expect(parseQuery("?a=1&b=2")).toEqual({ a: "1", b: "2" });
    expect(parseQuery("a=1&b=2")).toEqual({ a: "1", b: "2" });
  });

  it("skips empty segments (&&, leading &, trailing &)", () => {
    expect(parseQuery("a=1&&b=2")).toEqual({ a: "1", b: "2" });
    expect(parseQuery("&a=1&")).toEqual({ a: "1" });
  });

  it("bare key and key= both yield empty-string values", () => {
    expect(parseQuery("flag")).toEqual({ flag: "" });
    expect(parseQuery("flag=")).toEqual({ flag: "" });
  });

  it("splits only on the first = so values may contain =", () => {
    expect(parseQuery("a=b=c")).toEqual({ a: "b=c" });
  });

  it("percent-decodes keys and values", () => {
    expect(parseQuery("a%20b=c%2Bd")).toEqual({ "a b": "c+d" });
  });

  it("treats + as space in keys and values", () => {
    expect(parseQuery("x+y=1+2")).toEqual({ "x y": "1 2" });
  });

  it("collapses duplicate keys into an array in order", () => {
    expect(parseQuery("t=a&t=b&t=c")).toEqual({ t: ["a", "b", "c"] });
  });

  it("a single occurrence stays a string, not a 1-element array", () => {
    const r = parseQuery("t=a");
    expect(r.t).toBe("a");
    expect(Array.isArray(r.t)).toBe(false);
  });

  it("does not throw on malformed percent escapes; falls back to raw token", () => {
    expect(() => parseQuery("a=%zz")).not.toThrow();
    expect(parseQuery("a=%zz")).toEqual({ a: "%zz" });
    expect(parseQuery("bad%=x")).toEqual({ "bad%": "x" });
  });

  it("ignores segments whose key is empty", () => {
    expect(parseQuery("=v&a=1")).toEqual({ a: "1" });
  });

  it("returns {} for non-string input", () => {
    // @ts-expect-error deliberate misuse
    expect(parseQuery(undefined)).toEqual({});
    // @ts-expect-error deliberate misuse
    expect(parseQuery(null)).toEqual({});
  });
});
