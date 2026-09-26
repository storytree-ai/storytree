/**
 * Capability 5 · Queues (stories/librarian.md): open questions and friction are looked at on each
 * pass, and nothing is closed without a reason. There is no question lease (ADR-0644 D3): every open
 * question is on every worklist. The friction drain is 0.2's bounded one (ADR-0168 D4): at most the
 * three oldest reports not yet routed, never one the session's own branch filed, so the librarian
 * never marks its own homework; a report with no provenance counts as another's, so the queue
 * cannot drain by going anonymous. The routing judgement is the librarian's own (ADR-0644 D3, S).
 * Settling and retiring a question are the agent link's tools.
 */
import type { FieldsOf, Library, SchemaRecord } from "@storytree/library";

import { allNotes, LibrarianRefusal } from "../notes.js";

/** Where a friction report is routed: a decision, a tool, a kind of note, an edit to an existing one, or nothing. */
export type Route = NonNullable<FieldsOf<"friction">["route"]>;

/** How many friction reports one pass drains, at most. */
export const DRAIN = 3;

/** The worklist's questions: every open question on every arc, oldest first. */
export async function openQuestions(library: Library): Promise<SchemaRecord<"question">[]> {
  const questions: SchemaRecord<"question">[] = [];
  for (const arc of (await library.projectTree()).arcs) questions.push(...(await library.questions(arc.id)));
  return questions.filter((question) => question.fields.lifecycle === "open").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** The worklist's friction drain: the three oldest reports not yet routed, filed from any branch but `branch`. */
export async function frictionDrain(library: Library, { branch }: { branch?: string }): Promise<SchemaRecord<"friction">[]> {
  return (await allNotes(library))
    .filter((note): note is SchemaRecord<"friction"> => note.type === "friction")
    .filter((report) => report.fields.route === undefined && (branch === undefined || report.fields.provenance?.branch !== branch))
    .slice(0, DRAIN);
}

/** Record the routing judgement on friction report `id`, with its reason; a route with no reason is refused. */
export async function route(library: Library, id: string, to: Route, reason: string): Promise<SchemaRecord<"friction">> {
  if (reason.trim() === "") throw new LibrarianRefusal("a friction report is routed with its reason: nothing is closed without one");
  const report = (await allNotes(library)).find((note) => note.id === id);
  if (report?.type !== "friction") throw new LibrarianRefusal(`${id} is not a live friction report`);
  return (await library.editNote(id, { route: to, routeReason: reason })) as SchemaRecord<"friction">;
}
