// Capability 17 · Friction
import type { FieldsOf, Library, Note, SchemaRecord, WriteOptions } from "@storytree/library";
import { VerbRefusal } from "@storytree/library/verbs";

import { closestFriction, type EarlierFriction } from "../filing/capture.js";

export class RouteRefusal extends VerbRefusal {
  constructor(message: string) {
    super(message);
    this.name = "RouteRefusal";
  }
}

export type Route = NonNullable<FieldsOf<"friction">["route"]>;

export interface RouteOptions extends WriteOptions {
  readonly dischargedBy?: string;
  readonly theme?: readonly string[];
}

export const DRAIN = 3;

export const LEASE_MINUTES = 10;

export const LOOKALIKE_DAYS = 28;

export function lookalikes(library: Library, report: SchemaRecord<"friction">, now = new Date()): Promise<EarlierFriction[]> {
  const since = new Date(now.getTime() - LOOKALIKE_DAYS * 86_400_000).toISOString().slice(0, 10);
  return closestFriction(library, report.fields, { except: report.id, since });
}

export interface DrainOptions {
  readonly branch?: string;
  readonly writer?: WriteOptions;
  readonly now?: Date;
}

export async function frictionDrain(library: Library, options: DrainOptions): Promise<SchemaRecord<"friction">[]> {
  return (await leaseFriction(library, await openFriction(library, options.branch === undefined ? {} : { branch: options.branch }), options)).taken;
}

function heldByAnother(report: SchemaRecord<"friction">, holder: string | undefined, now: Date): boolean {
  const lease = report.fields.lease;
  return lease !== undefined && lease.holder !== holder && Date.parse(lease.until) > now.getTime();
}

class Taken extends Error {}

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

export async function openFriction(library: Library, { branch }: { branch?: string }): Promise<SchemaRecord<"friction">[]> {
  return (await liveNotes(library))
    .filter((note): note is SchemaRecord<"friction"> => note.type === "friction")
    .filter((report) => report.fields.state === "open" && (branch === undefined || report.fields.provenance?.branch !== branch))
    .sort((a, b) => (b.fields.reinforcedBy?.length ?? 0) - (a.fields.reinforcedBy?.length ?? 0));
}

export async function route(library: Library, id: string, to: Route, reason: string, options: RouteOptions = {}): Promise<SchemaRecord<"friction">> {
  if (reason.trim() === "") throw new RouteRefusal("a friction report is routed with its reason: nothing is closed without one");
  const { dischargedBy: supplied, theme = [], ...writer } = options;
  const dischargedBy = supplied?.trim();
  if (dischargedBy === "") throw new RouteRefusal("dischargedBy needs a non-empty reference to the delivered remedy, such as a PR or decision; omit it when the remedy has not landed");
  const live = await liveNotes(library);
  const members = [...new Set(theme)].filter((member) => member !== id);
  const reports = [id, ...members].map((one) => live.find((note) => note.id === one));
  for (const [index, report] of reports.entries()) {
    if (report?.type !== "friction") throw new RouteRefusal(`${[id, ...members][index]} is not a live friction report`);
    if (index > 0 && report.fields.state === "dismissed") continue;
    refuseAnotherRoute(report, to);
  }
  if (to !== "nothing") {
    const remedied = new Set((await library.list("increment"))
      .filter((increment) => increment.fields.status !== "closed")
      .flatMap((increment) => increment.fields.remedies ?? []));
    const owed = (reports as SchemaRecord<"friction">[])
      .filter((report) => !(dischargedBy ?? report.fields.dischargedBy?.trim()) && !remedied.has(report.id))
      .map((report) => report.id);
    if (owed.length > 0) throw new RouteRefusal(`routing to ${to} needs a live increment whose remedies names ${owed.join(", ")}; park the fix on its owning arc, or supply dischargedBy when the remedy has already landed`);
  }
  const judgement = { route: to, routeReason: reason, lease: undefined, ...(dischargedBy === undefined ? {} : { dischargedBy }) };
  for (const report of reports.slice(1) as SchemaRecord<"friction">[]) {
    await library.editNote(report.id, { ...judgement, links: [...new Set([...(report.fields.links ?? []), id])] }, {
      ...writer,
      checkCurrent: (current) => {
        if (current.type !== "friction" || current.fields.state !== "dismissed") refuseAnotherRoute(current, to);
      },
    });
  }
  return (await library.editNote(id, judgement, { ...writer, checkCurrent: (current) => refuseAnotherRoute(current, to) })) as SchemaRecord<"friction">;
}

function refuseAnotherRoute(report: Note, to: Route): void {
  if (report.type !== "friction") throw new RouteRefusal(`${report.id} is not a live friction report`);
  const earlier = report.fields.route;
  if (earlier !== undefined && earlier !== to) {
    throw new RouteRefusal(`${report.id} is already routed to ${earlier}: ${report.fields.routeReason ?? "no reason recorded"} Read it before judging again; routing it again takes the same route only`);
  }
}

function liveNotes(library: Library): Promise<Note[]> {
  return library.search("");
}
