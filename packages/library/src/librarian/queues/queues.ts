/**
 * Capability 25 · Queues (The library story, its curation tooling): lapsed open questions are looked at on each
 * pass. The library owns the question review lease and its lapsed-date drain (ADR-0654). Friction, which this
 * capability once drained and routed, is its own story (ADR-1077 D1).
 * Settling and retiring a question are the MCP server's tools.
 */
import type { Library, SchemaRecord } from "../../index.js";

/** The open questions due for review across every arc, longest lapsed first, at `at` or now. */
export function openQuestions(library: Library, at?: Date): Promise<SchemaRecord<"question">[]> {
  return library.lapsedQuestions(at);
}
