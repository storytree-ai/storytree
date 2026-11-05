/**
 * Capability 11 · Waits (the library story): whether a wait still holds. An arc waits on an arc or an
 * increment, and an increment on an increment or a capability's claim, each with a reason; waitHolds
 * is the one answer to whether such a wait still holds. An open increment can also wait for the owner
 * or an outside event, with a note: whether that still holds is read here (11.6).
 *
 * Every wait an arc or increment stores, on other work or for the owner or an event, is capability
 * 10's to write (wait-writes.ts, ADR-1242 D2), as the arc and increment records are. WorkInFlight (capability 10) serializes each write and reads the
 * project's open work once; the rules for when a wait holds are here.
 */
import { liveRecord } from "../references.js";
import type { SchemaRecords } from "../schema/index.js";
import type { FieldsOf } from "../schema/types.js";

/** A blocker still holding a wait (capability 11). */
export interface Hold {
  /** The arc or increment waited on. */
  readonly on: string;
  readonly reason: string;
  /**
   * True when it can never release: the blocking increment closed without landing (failed or
   * withdrawn), or the blocker is missing or retired (11-a).
   */
  readonly forGood: boolean;
  /**
   * A wait on a capability's claim (11.12, ADR-1228 D1): it holds only while a live session holds
   * that capability, so its holder releasing it, however it does, clears it.
   */
  readonly claim?: true;
  /** A claim wait's capability, by its title, when the library has that capability (ADR-1228 D1). */
  readonly title?: string;
}

/** The capabilities live sessions hold now, as session management reads its claims: what a claim wait is read against (11.12). */
export interface ClaimReading {
  readonly claimed?: ReadonlySet<string>;
}

/** What an increment waits for outside the library, as stored (11.6, ADR-0938 D1). */
export type WaitFor = NonNullable<FieldsOf<"increment">["waitsFor"]>[number];

/**
 * A wait for the owner or an outside event as read at one moment (11.6): an owner wait holds until
 * it is cleared; an event wait holds until UTC midnight of its check-back day, and from then no
 * longer holds, its check-back passed.
 */
export interface NoteWait {
  readonly releaser: WaitFor["releaser"];
  readonly note: string;
  readonly checkBack?: string;
  /** An owner wait's: what it protects or unblocks, its rank (1 first) and the day it was last read again (11.10). */
  readonly why?: string;
  readonly rank?: number;
  readonly reviewed?: string;
  /** An owner wait's: the pull request, handed over with its increment, that merged since it was last read again (11.11). */
  readonly merged?: number;
  readonly holds: boolean;
}

/**
 * Every hold on a project's open work at once (11.5): each live arc's and open increment's wait holds,
 * each open increment's owner holds, and each open increment's waits for the owner or an event,
 * keyed by id, each as waitHolds, heldOnQuestion and waitsFor give it.
 */
export interface Holds {
  /** Closed increments have no holds and are omitted. */
  readonly waits: Readonly<Record<string, Hold[]>>;
  readonly heldOn: Readonly<Record<string, string[]>>;
  /**
   * An event wait whose check-back has passed is kept, reading as no longer holding. The library
   * always gives it; it is optional so a reader built before it (or a stand-in) still fits.
   */
  readonly waitsFor?: Readonly<Record<string, NoteWait[]>>;
}

/** One wait, as an arc or increment stores it. */
export type Wait = { readonly on: string; readonly reason: string };

/**
 * What an open increment waits for outside the library, read at `at` (11.6), in the order written:
 * each with whether it still holds. Empty for a closed increment and for an id that is not a live one.
 */
export async function waitsFor(records: SchemaRecords, id: string, at: Date): Promise<NoteWait[]> {
  const increment = await liveRecord(records, id, ["increment"]);
  return increment === null || increment.fields.status === "closed" ? [] : noteWaits(increment.fields.waitsFor, at);
}

/** Each wait for the owner or an event, read at `at`: an event's no longer holds from UTC midnight of its check-back day (11.6). */
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

/** The holds among `waits`, in order: each wait that `hold` says still holds. */
export function holdsOf(waits: readonly Wait[] | undefined, hold: (wait: Wait) => Hold | undefined): Hold[] {
  return (waits ?? []).flatMap((wait) => {
    const held = hold(wait);
    return held === undefined ? [] : [{ on: held.on, reason: held.reason, forGood: held.forGood, ...(held.claim === true ? { claim: true as const } : {}), ...(held.title === undefined ? {} : { title: held.title }) }];
  });
}

/**
 * Whether an arc wait holds (11.2, 11-a): until the arc closes, and for good if the arc is missing
 * (`closed` undefined).
 */
export function arcHold(wait: Wait, closed: boolean | undefined): Hold | undefined {
  if (closed === undefined) return { ...wait, forGood: true };
  return closed ? undefined : { ...wait, forGood: false };
}

/**
 * Whether an increment wait holds (11.1, 11-a): until the blocker closes as landed, and for good if
 * it closed any other way or is missing (it is not among the open increments).
 */
export function incrementHold(wait: Wait, landed: boolean, open: boolean): Hold | undefined {
  return landed ? undefined : { ...wait, forGood: !open };
}

/** Whether a wait names a capability, so is a claim wait (11.12): an id is its record type's prefix and a hex tail. */
export function onClaim(wait: Wait): boolean {
  return wait.on.startsWith("capability_");
}

/**
 * Whether a claim wait holds (11.12, ADR-1228 D1): while `claimed`, the capabilities live sessions
 * hold now, has it; never for good, since a claim always ends. A reader not given `claimed` cannot
 * see claims, and reads it as holding. It names the capability by `title`, when given.
 */
export function claimHold(wait: Wait, claimed: ReadonlySet<string> | undefined, title?: string): Hold | undefined {
  return claimed === undefined || claimed.has(wait.on) ? { ...wait, forGood: false, claim: true, ...(title === undefined ? {} : { title }) } : undefined;
}
