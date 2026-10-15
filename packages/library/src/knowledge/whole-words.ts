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

/** Whether `text` holds `name` as whole words, its last word plural or not. */
export function holdsName(text: string, name: string): boolean {
  const words = normalisedWords(name).split(" ").map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const last = words.pop()!;
  const plural = last.endsWith("y") ? `(?:${last}|${last.slice(0, -1)}ies)` : `${last}(?:e?s)?`;
  return new RegExp(`(?<![\\p{L}\\p{N}])${[...words, plural].join(" ")}(?![\\p{L}\\p{N}])`, "u").test(normalisedWords(text));
}
