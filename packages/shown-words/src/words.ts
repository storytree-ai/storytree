/**
 * Capability 1 · The table of shown words. The one table of the words a person is shown for storytree's things and
 * actions (ADR-1019 D3 as extended): every surface that names one reads it here, so each has one name everywhere,
 * and no word names two things. Names in code, ids and the library's kinds do not change.
 */

/** A thing's shown word, one and many. */
export interface Word {
  readonly one: string;
  readonly many: string;
}

/** ADR-1019 D1's concepts, keyed by their name in code and the library. */
export const CONCEPTS = {
  story: { one: "story", many: "stories" },
  capability: { one: "capability", many: "capabilities" },
  arc: { one: "plan", many: "plans" },
  increment: { one: "piece of work", many: "pieces of work" },
  contract: { one: "contract", many: "contracts" },
  decision: { one: "decision", many: "decisions" },
} as const satisfies Record<string, Word>;

/** The actions the app and the first-run guide name, each as its control reads. */
export const ACTIONS = {
  addProject: "Add a project…",
  checkFolder: "Check a folder…",
  copyRequest: "Copy request for your agent",
} as const satisfies Record<string, string>;

/** Where code stands on the map, keyed by its name in code: code no capability reaches (the map's `unclaimed`) is shown
 * in words that name no claim on work, which "Unclaimed" did. */
export const PLACES = {
  unclaimed: "Not in any capability",
} as const satisfies Record<string, string>;

/** A word as two rows would clash on it: lower case, without a trailing ellipsis. */
function bare(word: string): string {
  return word.replace(/…$/, "").trim().toLowerCase();
}

/** The words that name more than one row of `table` (the shown words by default), bare; empty when none does. */
export function sharedWords(table: Record<string, string | Word> = { ...CONCEPTS, ...ACTIONS, ...PLACES }): string[] {
  const named = new Map<string, Set<string>>();
  for (const [row, shown] of Object.entries(table)) {
    for (const word of typeof shown === "string" ? [shown] : [shown.one, shown.many]) {
      const rows = named.get(bare(word)) ?? new Set<string>();
      named.set(bare(word), rows.add(row));
    }
  }
  return [...named].filter(([, rows]) => rows.size > 1).map(([word]) => word);
}
