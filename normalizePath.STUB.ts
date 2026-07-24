// Normalize a POSIX-style path string. Pure, no fs, no Node 'path' import.

/**
 * Collapse a path: remove duplicate slashes, resolve "." and "..", and trim a
 * trailing slash (except for the root "/"). Absolute paths keep their leading
 * "/"; ".." cannot rise above root. A relative path may retain leading "..".
 * "" normalizes to ".".
 */
export function normalizePath(p: string): string {
  throw new Error("not implemented");
}
