// Capability 10 · Arcs and increments
import { type FieldsOf, liveRecord, type SchemaRecords } from "../../records/index.js";

export interface Hold {
  readonly on: string;
  readonly reason: string;
  readonly forGood: boolean;
  readonly claim?: true;
  readonly title?: string;
}

export interface ClaimReading {
  readonly claimed?: ReadonlySet<string>;
}

export type WaitFor = NonNullable<FieldsOf<"increment">["waitsFor"]>[number];

export interface NoteWait {
  readonly releaser: WaitFor["releaser"];
  readonly note: string;
  readonly checkBack?: string;
  readonly why?: string;
  readonly rank?: number;
  readonly reviewed?: string;
  readonly merged?: number;
  readonly holds: boolean;
}

export interface Holds {
  readonly waits: Readonly<Record<string, Hold[]>>;
  readonly heldOn: Readonly<Record<string, string[]>>;
  readonly waitsFor?: Readonly<Record<string, NoteWait[]>>;
}

export type Wait = { readonly on: string; readonly reason: string };

export async function waitsFor(records: SchemaRecords, id: string, at: Date): Promise<NoteWait[]> {
  const increment = await liveRecord(records, id, ["increment"]);
  return increment === null || increment.fields.status === "closed" ? [] : noteWaits(increment.fields.waitsFor, at);
}

export function noteWaits(waitsFor: readonly WaitFor[] | undefined, at: Date): NoteWait[] {
  return (waitsFor ?? []).map(({ releaser, note, checkBack, why, rank, reviewed, merged }) => ({
    releaser,
    note,
    ...(checkBack === undefined ? {} : { checkBack }),
    ...(why === undefined ? {} : { why }),
    ...(rank === undefined ? {} : { rank }),
    ...(reviewed === undefined ? {} : { reviewed }),
    ...(merged === undefined ? {} : { merged }),
    holds: checkBack === undefined || at.getTime() < Date.parse(`${checkBack}T00:00:00Z`),
  }));
}

export function holdsOf(waits: readonly Wait[] | undefined, hold: (wait: Wait) => Hold | undefined): Hold[] {
  return (waits ?? []).flatMap((wait) => {
    const held = hold(wait);
    return held === undefined ? [] : [{ on: held.on, reason: held.reason, forGood: held.forGood, ...(held.claim === true ? { claim: true as const } : {}), ...(held.title === undefined ? {} : { title: held.title }) }];
  });
}

export function arcHold(wait: Wait, closed: boolean | undefined): Hold | undefined {
  if (closed === undefined) return { ...wait, forGood: true };
  return closed ? undefined : { ...wait, forGood: false };
}

export function incrementHold(wait: Wait, landed: boolean, open: boolean): Hold | undefined {
  return landed ? undefined : { ...wait, forGood: !open };
}

export function onClaim(wait: Wait): boolean {
  return wait.on.startsWith("capability_");
}

export function claimHold(wait: Wait, claimed: ReadonlySet<string> | undefined, title?: string): Hold | undefined {
  return claimed === undefined || claimed.has(wait.on) ? { ...wait, forGood: false, claim: true, ...(title === undefined ? {} : { title }) } : undefined;
}
