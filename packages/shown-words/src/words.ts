// Capability 1 · The table of shown words

export interface Word {
  readonly one: string;
  readonly many: string;
}

export const CONCEPTS = {
  story: { one: "story", many: "stories" },
  capability: { one: "capability", many: "capabilities" },
  arc: { one: "plan", many: "plans" },
  increment: { one: "piece of work", many: "pieces of work" },
  contract: { one: "contract", many: "contracts" },
  decision: { one: "decision", many: "decisions" },
} as const satisfies Record<string, Word>;

export const ACTIONS = {
  addProject: "Add a project…",
  checkFolder: "Check a folder…",
  copyRequest: "Copy request for your agent",
} as const satisfies Record<string, string>;

export const PLACES = {
  unclaimed: "Not in any capability",
} as const satisfies Record<string, string>;

function bare(word: string): string {
  return word.replace(/…$/, "").trim().toLowerCase();
}

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
