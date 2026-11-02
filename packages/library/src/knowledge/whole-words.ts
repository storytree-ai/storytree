/**
 * Capability 14 · Ranked search. One rule for finding a name in text by whole words (ADR-1044 D3),
 * meant to be shared by ranked search's title lift and the definitions hook: case ignored, `-`, `_`
 * and runs of spaces read as one space, and the name's last word may be plural (`claims` finds
 * "Claim", `policies` finds "Policy"). Letters inside a longer word never match: "on" is not in
 * "connecting".
 */

/** Lower case, with `-`, `_` and every run of spaces read as one space. */
export function normalisedWords(text: string): string {
  return text.toLowerCase().replace(/[-_\s]+/g, " ").trim();
}

/** A letter or digit ending, or starting, the text it is tested on: what makes a match part of a longer word. */
const WORD_BEFORE = /[\p{L}\p{N}]$/u;
const WORD_AFTER = /^[\p{L}\p{N}]/u;

/**
 * Whether `text` holds `name` as whole words, its last word plural or not. It compiles no pattern
 * of its own: a ranked search asks this of thousands of title words, and compiling a Unicode
 * pattern for each cost seconds (14.16).
 */
export function holdsName(text: string, name: string): boolean {
  const haystack = normalisedWords(text);
  const words = normalisedWords(name);
  const forms = words.endsWith("y") ? [words, `${words.slice(0, -1)}ies`] : [words, `${words}s`, `${words}es`];
  return forms.some((form) => {
    for (let at = haystack.indexOf(form); at !== -1; at = at === haystack.length ? -1 : haystack.indexOf(form, at + 1)) {
      const end = at + form.length;
      // Two code units either side: a whole character, even one outside the Basic Multilingual Plane.
      if (!WORD_BEFORE.test(haystack.slice(Math.max(0, at - 2), at)) && !WORD_AFTER.test(haystack.slice(end, end + 2))) return true;
    }
    return false;
  });
}
