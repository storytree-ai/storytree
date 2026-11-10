/**
 * Capability 17 · The library's commands: what `library search` and the search_notes tool share. Both rank current
 * state unless told (the owner's option B on question_6931f1a08090): resteers, friction and superseded decisions come
 * back with history, or a resteer or friction when its kind is named, and a decision narrowed in place says which
 * decisions narrow it.
 */
import type { Library } from "../index.js";
import type { Findable, NarrowingDecision, NoteType, PlanKind, Ranked } from "../knowledge/index.js";
import { VerbRefusal } from "../verbs/verb.js";

/** The kinds a search may be narrowed to. */
const SEARCHABLE: readonly string[] = [
  "decision", "definition", "principle", "guardrail", "pattern", "process", "agent", "friction", "resteer", "techstack", "check", "research", "experiment",
  "story", "capability", "contract",
];

/** rankAll, with an unknown kind refused as the caller's misuse rather than thrown. */
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

/** A hit's narrowing, as its line ends: "  (narrowed by ADR-0993)", or nothing for a hit no decision narrows. */
export function narrowedSaid(narrowedBy: readonly NarrowingDecision[] | undefined): string {
  if (narrowedBy === undefined || narrowedBy.length === 0) return "";
  return `  (narrowed by ${narrowedBy.map(({ id, number }) => (number === undefined ? id : `ADR-${String(number).padStart(4, "0")}`)).join(", ")})`;
}
