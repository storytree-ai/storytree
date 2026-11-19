// Capability 17 · The library's commands
import type { Library } from "../index.js";
import { KNOWLEDGE_KINDS, type Findable, type NarrowingDecision, type NoteType, type PlanKind, type Ranked } from "../knowledge/index.js";
import { VerbRefusal } from "../verbs/verb.js";

const SEARCHABLE: readonly string[] = ["decision", "definition", ...KNOWLEDGE_KINDS, "story", "capability", "contract", "arc", "increment"];

export async function rankedSearch(library: Library, query: string, options: { readonly limit?: number; readonly history?: boolean; readonly kinds?: readonly string[] }): Promise<Ranked<Findable>> {
  const kinds = options.kinds ?? [];
  const unknown = kinds.find((kind) => !SEARCHABLE.includes(kind));
  if (unknown !== undefined) throw new VerbRefusal(`${unknown} is not a kind a search ranks; one of ${SEARCHABLE.join(", ")}`, { misuse: true });
  return library.rankAll(query, {
    ...(options.limit === undefined ? {} : { limit: options.limit }),
    ...(options.history === true ? { history: true } : {}),
    ...(kinds.length === 0 ? {} : { kinds: kinds as (NoteType | PlanKind)[] }),
  });
}

export function narrowedSaid(narrowedBy: readonly NarrowingDecision[] | undefined): string {
  if (narrowedBy === undefined || narrowedBy.length === 0) return "";
  return `  (narrowed by ${narrowedBy.map(({ id, number }) => (number === undefined ? id : `ADR-${String(number).padStart(4, "0")}`)).join(", ")})`;
}
