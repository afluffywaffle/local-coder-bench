// Normalize a POSIX-style path string. Pure, no fs, no Node 'path' import.

/**
 * Collapse a path: remove duplicate slashes, resolve "." and "..", trim a
 * trailing slash (except root). See normalizePath_spec for exact rules.
 */
export function normalizePath(p: string): string {
  if (typeof p !== "string" || p === "") return ".";

  const isAbs = p.startsWith("/");
  const stack: string[] = [];

  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (stack.length && stack[stack.length - 1] !== "..") {
        stack.pop();
      } else if (!isAbs) {
        stack.push("..");
      }
      // absolute + nothing to pop: ".." above root is discarded
    } else {
      stack.push(seg);
    }
  }

  let result = stack.join("/");
  if (isAbs) result = "/" + result;
  if (result === "") result = isAbs ? "/" : ".";
  return result;
}
