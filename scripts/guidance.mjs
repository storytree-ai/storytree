// Stub: the generated guidance is not built yet.
export const REGION_START = "<!-- storytree:guidance START";
export const REGION_END = "<!-- storytree:guidance END -->";
export const BUDGETS = { "CLAUDE.md": 40_000, "AGENTS.md": 32_768, role: 36_000 };

export async function readRoles() {
  return { root: undefined, others: [], titles: new Map() };
}

export function expectedFiles() {
  return new Map();
}

export function driftOf() {
  return [];
}

export function overBudget() {
  return [];
}
