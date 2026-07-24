import { describe, it, expect } from "vitest";
import { normalizePath } from "./normalizePath";

describe("normalizePath", () => {
  it("empty and non-string -> '.'", () => {
    expect(normalizePath("")).toBe(".");
    // @ts-expect-error deliberate misuse
    expect(normalizePath(undefined)).toBe(".");
  });

  it("root and runs of slashes", () => {
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("///")).toBe("/");
  });

  it("collapses duplicate slashes", () => {
    expect(normalizePath("a//b")).toBe("a/b");
    expect(normalizePath("/a//b///c")).toBe("/a/b/c");
  });

  it("drops '.' segments", () => {
    expect(normalizePath("a/./b")).toBe("a/b");
    expect(normalizePath("./foo")).toBe("foo");
  });

  it("resolves '..' against the previous segment", () => {
    expect(normalizePath("a/b/../c")).toBe("a/c");
    expect(normalizePath("a/b/./../c/")).toBe("a/c");
  });

  it("'..' cannot rise above root in an absolute path", () => {
    expect(normalizePath("/a/../..")).toBe("/");
    expect(normalizePath("/../a")).toBe("/a");
  });

  it("keeps leading '..' in a relative path", () => {
    expect(normalizePath("../foo")).toBe("../foo");
    expect(normalizePath("../../x")).toBe("../../x");
  });

  it("a '..' never pops another '..'", () => {
    expect(normalizePath("a/../..")).toBe("..");
  });

  it("strips a trailing slash except at root", () => {
    expect(normalizePath("foo/bar/")).toBe("foo/bar");
    expect(normalizePath("/foo/")).toBe("/foo");
  });

  it("relative path reducing to nothing -> '.'", () => {
    expect(normalizePath("a/..")).toBe(".");
    expect(normalizePath("./.")).toBe(".");
  });

  it("absolute path reducing to nothing -> '/'", () => {
    expect(normalizePath("/a/b/../..")).toBe("/");
  });

  it("preserves normal absolute paths", () => {
    expect(normalizePath("/usr/local/bin")).toBe("/usr/local/bin");
  });
});
