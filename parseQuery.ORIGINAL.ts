// Parse a URL query string into a structured object.
// Pure, no DOM. Mirrors common query-string semantics with a few strict rules.

export type QueryValue = string | string[];

/**
 * Parse a query string into a map of decoded keys -> decoded value(s).
 * See parseQuery_spec for exact rules.
 */
export function parseQuery(input: string): Record<string, QueryValue> {
  const out: Record<string, QueryValue> = {};
  if (typeof input !== "string") return out;

  let s = input;
  if (s.startsWith("?")) s = s.slice(1);
  if (s === "") return out;

  const decode = (token: string): string => {
    // '+' means space; then percent-decode. Malformed percent escapes fall
    // back to the raw token (never throw).
    const plusReplaced = token.replace(/\+/g, " ");
    try {
      return decodeURIComponent(plusReplaced);
    } catch {
      return plusReplaced;
    }
  };

  for (const seg of s.split("&")) {
    if (seg === "") continue; // skip empty segments (&&, trailing &)
    const eq = seg.indexOf("=");
    let rawKey: string;
    let rawVal: string;
    if (eq === -1) {
      rawKey = seg;
      rawVal = "";
    } else {
      rawKey = seg.slice(0, eq);
      rawVal = seg.slice(eq + 1);
    }
    const key = decode(rawKey);
    const val = decode(rawVal);
    if (key === "") continue; // a segment with an empty key is ignored

    if (Object.prototype.hasOwnProperty.call(out, key)) {
      const existing = out[key];
      if (Array.isArray(existing)) existing.push(val);
      else out[key] = [existing, val];
    } else {
      out[key] = val;
    }
  }
  return out;
}
