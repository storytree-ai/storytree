/**
 * Capability 5 · Queues (the librarian story): lapsed open questions and friction are looked at on
 * each pass, and nothing is closed without a reason. The library owns the question review lease
 * and its lapsed-date drain (ADR-0654). The friction drain is 0.2's bounded one (ADR-0168 D4): at most the
 * three open reports, most recurrences first (ADR-0716), oldest first on ties, never one the session's own branch filed, so the librarian
 * never marks its own homework; a report with no provenance counts as another's, so the queue
 * cannot drain by going anonymous; a report reopened by a recurrence or an unbuilt remedy is open
 * again (ADR-1016 D2). What the drain hands a session is leased to it for a few minutes, so sessions
 * draining at once judge different reports, and route checks a report's earlier route inside its
 * write (question_5237b54da066). The routing judgement is the librarian's own (ADR-0644 D3, S), and every
 * route but nothing names its remedy (ADR-1016 D3).
 * Settling and retiring a question are the MCP server's tools.
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

/**
 * How long the drain holds a report for the session it handed it to. Ten minutes covers one landing's
 * pass over its three: reading each whole, parking a remedy, routing. A session that ends without
 * routing frees them soon, and a judgement that outlasts its lease is still guarded by route (5.9).
 */
export const LEASE_MINUTES = 10;

/** The open questions due for review across every arc, longest lapsed first, at `at` or now. */
export function openQuestions(library: Library, at?: Date): Promise<SchemaRecord<"question">[]> {
  return library.lapsedQuestions(at);
}

/** Who asks the drain: the branch it never hands back its own reports from, and the writer it leases them to. */
export interface DrainOptions {
  readonly branch?: string;
  /** The session asking; its actor holds the lease. Without one, nothing is leased. */
  readonly writer?: WriteOptions;
  readonly now?: Date;
}

/**
 * Three open reports from other branches, most recurrences first and oldest first on ties, leased to
 * the writer's session for LEASE_MINUTES (5.8). A report another session holds is passed over; each
 * lease is taken inside the write, so two drains at once never take one report.
 */
export async function frictionDrain(library: Library, options: DrainOptions, read: Promise<readonly Note[]> | readonly Note[] = allNotes(library)): Promise<SchemaRecord<"friction">[]> {
  return (await leaseFriction(library, await openFriction(library, options.branch === undefined ? {} : { branch: options.branch }, read), options)).taken;
}

/** Whether another session holds `report` at `now`. */
function heldByAnother(report: SchemaRecord<"friction">, holder: string | undefined, now: Date): boolean {
  const lease = report.fields.lease;
  return lease !== undefined && lease.holder !== holder && Date.parse(lease.until) > now.getTime();
}

/** A report taken since it was listed, by a route or another session's lease. */
class Taken extends Error {}

/**
 * Lease up to DRAIN of `open`, in its order, to the writer's session; `free` counts the open reports
 * no other session holds. With no writer's actor nothing is leased and the first DRAIN are given.
 */
export async function leaseFriction(library: Library, open: readonly SchemaRecord<"friction">[], { writer, now = new Date() }: DrainOptions): Promise<{ taken: SchemaRecord<"friction">[]; free: number }> {
  const holder = writer?.actor;
  if (holder === undefined) return { taken: open.slice(0, DRAIN), free: open.length };
  const until = new Date(now.getTime() + LEASE_MINUTES * 60_000).toISOString();
  const taken: SchemaRecord<"friction">[] = [];
  let free = 0;
  for (const report of open) {
    if (heldByAnother(report, holder, now)) continue;
    if (taken.length === DRAIN) { free += 1; continue; }
    const leased = await library.editNote(report.id, { lease: { holder, until } }, {
      ...writer,
      checkCurrent: (current) => {
        if (current.type !== "friction" || current.fields.state !== "open" || heldByAnother(current, holder, now)) throw new Taken();
      },
    }).catch((error: unknown) => {
      if (error instanceof Taken) return null;
      throw error;
    });
    if (leased?.type !== "friction") continue;
    taken.push(leased);
    free += 1;
  }
  return { taken, free };
}

/** Every open report from other branches, in the drain's order: what the drain takes its three from. */
export async function openFriction(library: Library, { branch }: { branch?: string }, read: Promise<readonly Note[]> | readonly Note[] = allNotes(library)): Promise<SchemaRecord<"friction">[]> {
  return (await read)
    .filter((note): note is SchemaRecord<"friction"> => note.type === "friction")
    .filter((report) => report.fields.state === "open" && (branch === undefined || report.fields.provenance?.branch !== branch))
    // allNotes is in creation order; stable sorting keeps that order when recurrence counts tie.
    .sort((a, b) => (b.fields.reinforcedBy?.length ?? 0) - (a.fields.reinforcedBy?.length ?? 0));
}

/**
 * Route with a reason and optional delivery stamp; the library moves its state (ADR-1016 D2).
 * Every route but nothing needs a live remedy or a stamp (D3), and a routed report keeps its route.
 */
export async function route(library: Library, id: string, to: Route, reason: string, options: RouteOptions = {}): Promise<SchemaRecord<"friction">> {
  if (reason.trim() === "") throw new LibrarianRefusal("a friction report is routed with its reason: nothing is closed without one");
  const { dischargedBy: supplied, ...writer } = options;
  const dischargedBy = supplied?.trim();
  if (dischargedBy === "") throw new LibrarianRefusal("dischargedBy needs a non-empty reference to the delivered remedy, such as a PR or decision; omit it when the remedy has not landed");
  const report = (await allNotes(library)).find((note) => note.id === id);
  if (report?.type !== "friction") throw new LibrarianRefusal(`${id} is not a live friction report`);
  refuseAnotherRoute(report, to);
  if (to !== "nothing" && !(dischargedBy ?? report.fields.dischargedBy?.trim())) {
    const remedy = (await library.list("increment")).some((increment) =>
      increment.fields.status !== "closed" && increment.fields.remedies?.includes(id),
    );
    if (!remedy) throw new LibrarianRefusal(`routing to ${to} needs a live increment whose remedies names ${id}; park the fix on its owning arc, or supply dischargedBy when the remedy has already landed`);
  }
  // Checked again inside the write (5.9): another pass may have routed it since this one read it.
  return (await library.editNote(id, {
    route: to, routeReason: reason, lease: undefined,
    ...(dischargedBy === undefined ? {} : { dischargedBy }),
  }, { ...writer, checkCurrent: (current) => refuseAnotherRoute(current, to) })) as SchemaRecord<"friction">;
}

/** Another pass's route is not replaced in silence: a routed report is routed again only the same way (5.5). */
function refuseAnotherRoute(report: Note, to: Route): void {
  if (report.type !== "friction") throw new LibrarianRefusal(`${report.id} is not a live friction report`);
  const earlier = report.fields.route;
  if (earlier !== undefined && earlier !== to) {
    throw new LibrarianRefusal(`${report.id} is already routed to ${earlier}: ${report.fields.routeReason ?? "no reason recorded"} Read it before judging again; routing it again takes the same route only`);
  }
}
