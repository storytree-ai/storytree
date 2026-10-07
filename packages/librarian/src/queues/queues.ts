/**
 * Capability 5 · Queues (the librarian story): lapsed open questions and friction are looked at on
 * each pass, and nothing is closed without a reason. The library owns the question review lease
 * and its lapsed-date drain (ADR-0654). The friction drain is 0.2's bounded one (ADR-0168 D4): at most the
 * three reports not yet routed, most recurrences first (ADR-0716), oldest first on ties, never one the session's own branch filed, so the librarian
 * never marks its own homework; a report with no provenance counts as another's, so the queue
 * cannot drain by going anonymous. The routing judgement is the librarian's own (ADR-0644 D3, S).
 * Settling and retiring a question are the agent link's tools.
 */
import type { FieldsOf, Library, Note, SchemaRecord, WriteOptions } from "@storytree/library";

import { allNotes, LibrarianRefusal } from "../notes.js";

/** Where a friction report is routed: a decision, a tool, a kind of note, an edit to an existing one, or nothing. */
export type Route = NonNullable<FieldsOf<"friction">["route"]>;

/** A delivery reference can be added when routing, or later when the remedy has landed. */
export interface RouteOptions extends WriteOptions {
  readonly dischargedBy?: string;
}

/** How many friction reports one pass drains, at most. */
export const DRAIN = 3;

/** The open questions due for review across every arc, longest lapsed first, at `at` or now. */
export function openQuestions(library: Library, at?: Date): Promise<SchemaRecord<"question">[]> {
  return library.lapsedQuestions(at);
}

/** Three unrouted reports from other branches, most recurrences first and oldest first on ties. */
export async function frictionDrain(library: Library, { branch }: { branch?: string }, read: Promise<readonly Note[]> | readonly Note[] = allNotes(library)): Promise<SchemaRecord<"friction">[]> {
  return (await read)
    .filter((note): note is SchemaRecord<"friction"> => note.type === "friction")
    .filter((report) => report.fields.route === undefined && (branch === undefined || report.fields.provenance?.branch !== branch))
    // allNotes is in creation order; stable sorting keeps that order when recurrence counts tie.
    .sort((a, b) => (b.fields.reinforcedBy?.length ?? 0) - (a.fields.reinforcedBy?.length ?? 0))
    .slice(0, DRAIN);
}

/** Route with a reason and optional delivery stamp; deferred tool work needs a live remedy, and a routed report keeps its route. */
export async function route(library: Library, id: string, to: Route, reason: string, options: RouteOptions = {}): Promise<SchemaRecord<"friction">> {
  if (reason.trim() === "") throw new LibrarianRefusal("a friction report is routed with its reason: nothing is closed without one");
  const { dischargedBy: supplied, ...writer } = options;
  const dischargedBy = supplied?.trim();
  if (dischargedBy === "") throw new LibrarianRefusal("dischargedBy needs a non-empty reference to the delivered remedy, such as a PR or decision; omit it when the remedy has not landed");
  const report = (await allNotes(library)).find((note) => note.id === id);
  if (report?.type !== "friction") throw new LibrarianRefusal(`${id} is not a live friction report`);
  // Another pass may have routed it since this one listed it: its judgement is not replaced in silence.
  const earlier = report.fields.route;
  if (earlier !== undefined && earlier !== to) {
    throw new LibrarianRefusal(`${id} is already routed to ${earlier}: ${report.fields.routeReason ?? "no reason recorded"} Read it before judging again; routing it again takes the same route only`);
  }
  if (to === "tool" && !(dischargedBy ?? report.fields.dischargedBy?.trim())) {
    const remedy = (await library.list("increment")).some((increment) =>
      increment.fields.status !== "closed" && increment.fields.remedies?.includes(id),
    );
    if (!remedy) throw new LibrarianRefusal(`a tool route needs a live increment whose remedies names ${id}; park the fix on its owning arc, or supply dischargedBy when the remedy has already landed`);
  }
  return (await library.editNote(id, {
    route: to, routeReason: reason,
    ...(dischargedBy === undefined ? {} : { dischargedBy }),
  }, writer)) as SchemaRecord<"friction">;
}
