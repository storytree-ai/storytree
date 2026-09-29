/**
 * The scrub (ADR-0749 D4): before a transcript record leaves its machine, text shaped like an
 * obvious secret is replaced by a marker naming what was removed. It is best-effort for OBVIOUS
 * shapes (API keys, bearer and OAuth tokens, private keys, connection-string passwords), never a
 * guarantee: a secret in no known shape passes through, and the setup check says so.
 *
 * It works on a record's JSON text as written, and no marker holds a quote or a backslash, so a
 * scrubbed record still parses.
 */

/** Each shape, most specific first, and what it is replaced by. */
const SHAPES: readonly (readonly [RegExp, string])[] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[scrubbed: private key]"],
  [/\b(Bearer\s+)[A-Za-z0-9\-._~+/]{20,}=*/g, "$1[scrubbed: bearer token]"],
  [/\b(?:ya29\.[A-Za-z0-9_-]{20,}|gho_[A-Za-z0-9]{36,})/g, "[scrubbed: OAuth token]"],
  [/\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{20,}|gh[psur]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|xox[abprs]-[A-Za-z0-9-]{10,}|glpat-[A-Za-z0-9_-]{20,})/g, "[scrubbed: API key]"],
  // scheme://user:password@host: only the password goes.
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@"'\\]+:)[^\s@"'\\/]+(@)/gi, "$1[scrubbed: password]$2"],
];

/** `text` with every obvious secret replaced by its marker. */
export function scrub(text: string): string {
  return SHAPES.reduce((scrubbed, [shape, marker]) => scrubbed.replace(shape, marker), text);
}
