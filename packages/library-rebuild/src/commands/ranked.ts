// Capability 17 · The library's commands
import type { NarrowingDecision } from "../knowledge/search/index.js";

function adr(narrowing: NarrowingDecision): string {
  return narrowing.number === undefined ? narrowing.id : `ADR-${String(narrowing.number).padStart(4, "0")}`;
}

export function narrowedSaid(narrowedBy: readonly NarrowingDecision[]): string {
  if (narrowedBy.length === 0) return "";
  const said = narrowedBy.map((one) => (one.clauses === undefined || one.clauses.length === 0 ? `partly superseded by ${adr(one)}` : `${one.clauses.join(", ")} superseded by ${adr(one)}`));
  return `  (${said.join("; ")})`;
}
