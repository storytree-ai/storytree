/**
 * Capability 5 · Queues (stories/librarian.md): lapsed open questions and friction are looked at on
 * each pass, and nothing is closed without a reason. The library owns the question review lease
 * and its lapsed-date drain (ADR-0654). The friction drain is 0.2's bounded one (ADR-0168 D4): at most the
 * three oldest reports not yet routed, never one the session's own branch filed, so the librarian
 * never marks its own homework; a report with no provenance counts as another's, so the queue
 * cannot drain by going anonymous. The routing judgement is the librarian's own (ADR-0644 D3, S).
 * Settling and retiring a question are the agent link's tools.
 */
import type { FieldsOf, Library, SchemaRecord, WriteOptions } from "@storytree/library";

import { allNotes, LibrarianRefusal } from "../notes.js";

/** Where a friction report is routed: a decision, a tool, a kind of note, an edit to an existing one, or nothing. */
export type Route = NonNullable<FieldsOf<"friction">["route"]>;

/** How many friction reports one pass drains, at most. */
export const DRAIN = 3;

/** The open questions due for review across every arc, longest lapsed first, at `at` or now. */
export function openQuestions(library: Library, at?: Date): Promise<SchemaRecord<"question">[]> {
  return library.lapsedQuestions(at);
}

/** The worklist's friction drain: the three oldest reports not yet routed, filed from any branch but `branch`. */
export async function frictionDrain(library: Library, { branch }: { branch?: string }): Promise<SchemaRecord<"friction">[]> {
  return (await allNotes(library))
    .filter((note): note is SchemaRecord<"friction"> => note.type === "friction")
    .filter((report) => report.fields.route === undefined && (branch === undefined || report.fields.provenance?.branch !== branch))
    .slice(0, DRAIN);
}

/** Record the routing judgement on friction report `id`, with its reason; a route with no reason is refused. */
export async function route(library: Library, id: string, to: Route, reason: string, writer?: WriteOptions): Promise<SchemaRecord<"friction">> {
  if (reason.trim() === "") throw new LibrarianRefusal("a friction report is routed with its reason: nothing is closed without one");
  const report = (await allNotes(library)).find((note) => note.id === id);
  if (report?.type !== "friction") throw new LibrarianRefusal(`${id} is not a live friction report`);
  return (await library.editNote(id, { route: to, routeReason: reason }, writer)) as SchemaRecord<"friction">;
}
