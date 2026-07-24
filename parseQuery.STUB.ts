// Parse a URL query string into a structured object.
// Pure, no DOM. Mirrors common query-string semantics with a few strict rules.

export type QueryValue = string | string[];

/**
 * Parse a query string into a map of decoded keys -> decoded value(s).
 * A key that appears more than once collapses to an array of its values,
 * in order of appearance. Keys and values are URL-decoded ('+' -> space,
 * then percent-decoding). Malformed percent escapes must NOT throw.
 */
export function parseQuery(input: string): Record<string, QueryValue> {
  throw new Error("not implemented");
}
