/**
 * Capability 5 · Claims (the agent link story): before building a capability, the agent claims it
 * with a one-line reason, and its session's edits count toward it. One live session holds a
 * capability at a time: a second is refused with the holder's name and picks other work, with no
 * queue (the owner's C1, ADR-0626 D3). A claim ends when its holder lands or releases it, when the
 * holder's session ends, or when another session takes it over after the holder has gone idle.
 *
 * - Claims are lines in the agent activity log (claimed, released, landed), and who holds what is
 *   worked out from them, with the holders' liveness from their sessions' latest lines. A holder
 *   whose command is still running is live however long the command takes (capability 4).
 * - Taking a claim, landing and releasing each check and write under the project's lock
 *   (ActivityLog.locked), so two sessions claiming at once cannot both win.
 * - A session may hold more than one capability. Its edits count toward the one it claimed most
 *   recently of those it still holds; an edit or command from a session holding nothing is
 *   unplanned activity.
 * - An increment's claim also ends when the increment is closed through storytree: a "closed" line.
 * - A claim also ends when a pull request from the branch it was taken on merges after it was
 *   taken (ADR-0643 D3): a "merged" line, which merges.ts writes when GitHub shows one.
 * - Claims work on trust: storytree refuses a second claim, but cannot stop an agent that never asks.
 */
import type { Hold, IncrementStatus, Library, SchemaRecord, WriteOptions } from "@storytree/library";

import type { ActivityLog, Line, LockedLog } from "../activity/index.js";
import { COMMAND_KINDS, commandRunning, labelOf, QUIET_MS } from "../sessions/index.js";

/** A capability, or an increment (ADR-0643 D1), held by a session, as the log shows it. */
export type Claim = ClaimOn & ({ capability: string; increment?: undefined } | { increment: string; capability?: undefined });

/** What every claim shows, whatever it holds. */
interface ClaimOn {
  /** The holding session. */
  session: string;
  harness?: string;
  /** The holding session's harness as people call it: "Claude Code", "Codex". */
  label: string;
  reason: string;
  /** When it was claimed. */
  since: string;
  /** The git branch it was claimed on, when its session's folder was on one: a pull request from it merging ends the claim (ADR-0643 D3). */
  branch?: string;
  /** Whether the holding session is live, or idle past the quiet time (and so can be taken over). */
  holder: "live" | "idle";
}

/** Who is claiming, releasing or landing, and where. */
export interface ClaimContext {
  readonly log: ActivityLog;
  readonly library: Library;
  /** Request attribution and cancellation, when the claim came from a tool. */
  readonly writer?: WriteOptions;
  readonly project: string;
  readonly session: string;
  readonly harness?: string;
  readonly folder?: string;
  /** The git branch the session's folder is on, recorded with a claim so that its merge ends it (ADR-0643 D3). */
  readonly branch?: string;
  /** How long a holder may be quiet before its claim can be taken over. By default, sessions' quiet time. */
  readonly quietMs?: number;
}

export type ClaimAnswer =
  | { ok: true; claim: Claim; takenOverFrom?: Claim; alreadyHeld?: true }
  | { ok: false; refused: "held"; holder: Claim }
  | { ok: false; refused: "unknown-capability"; capability: string }
  | { ok: false; refused: "closed"; increment: string }
  | { ok: false; refused: "waiting"; waits: Waiting[] }
  | { ok: false; refused: "reason-too-long"; limit: number; length: number };

/**
 * A claim's reason is its session's name in the forest's running-sessions list, so it is held to
 * what that list's label column shows at its default width (ADR-0737 D2): measured in Chromium at
 * 13px system-ui, 40 characters of ordinary words fit its 290px unclipped.
 */
export const CLAIM_REASON_LIMIT = 40;

/** Why `reason` cannot be a claim's reason, or undefined when it can. */
export function reasonRefusal(reason: string): Extract<ClaimAnswer, { refused: "reason-too-long" }> | undefined {
  const length = [...reason.trim()].length;
  return length > CLAIM_REASON_LIMIT ? { ok: false, refused: "reason-too-long", limit: CLAIM_REASON_LIMIT, length } : undefined;
}

/**
 * An increment that waits (ADR-0643 D2), and what still holds it: a blocker, as the library's
 * `waitHolds` names it, or an open question it is held on, as its `heldOnQuestion` names it, which
 * is waiting on the owner.
 */
export interface Waiting extends Hold {
  readonly increment: string;
  /** Held on the owner's open question (`on` names it), not on other work. */
  readonly onOwner?: true;
}

export type ReleaseAnswer = { ok: true } | { ok: false; refused: "not-held"; holder?: Claim };

export type LandAnswer =
  | { ok: true; line: Line }
  | { ok: false; refused: "held"; holder: Claim }
  | { ok: false; refused: "unknown-capability"; capability: string };

/** An edit or command, and the capability and the increment it counts toward: both undefined for unplanned activity. */
export interface Attributed {
  line: Line;
  capability: string | undefined;
  increment: string | undefined;
}

export interface ClaimsOptions {
  /** The time to judge holders' liveness by. By default, now. */
  readonly now?: Date;
  /** How long a holder may be quiet before it reads as idle. By default, sessions' quiet time. */
  readonly quietMs?: number;
}

/** The kinds of line that decide who holds what. */
const CLAIM_KINDS = ["claimed", "released", "landed", "closed", "merged", "session-ended"] as const;

/**
 * Claim `id`, a capability or an increment, for the context's session, with a one-line reason.
 * Refused if the library has no live capability or increment by that id, if it is a closed
 * increment, if it is waiting work (waitingOn), or if another live session holds it; a holder idle
 * past the quiet time is taken over. Claiming a proposed or ready increment starts it, through the
 * library's own `advanceIncrement` (0.2's ADR-0386). Claiming what it already holds changes nothing.
 */
export async function claim(context: ClaimContext, id: string, reason: string): Promise<ClaimAnswer> {
  const tooLong = reasonRefusal(reason);
  if (tooLong !== undefined) return tooLong;
  const found = await claimable(context.library, id);
  if (!("part" in found)) return found;
  return context.log.locked(context.project, async (log) => {
    const current = (await heldNow(log, context)).get(id);
    if (current?.session === context.session) return { ok: true, claim: current, alreadyHeld: true };
    if (current?.holder === "live") return { ok: false, refused: "held", holder: current };
    // A claim may have waited for this lock without needing any library write at all.
    context.writer?.signal?.throwIfAborted();
    // Activation takes the library lock and checks cancellation there, before any claimed line.
    // Once admitted, complete the claim (and its workspace) even if cancellation arrives later.
    if (found.status === "proposal" || found.status === "ready") await context.library.advanceIncrement(id, "active", { ...context.writer, actor: `session:${context.session}` });
    const line = await log.append({
      ...who(context),
      kind: "claimed",
      ...found.part,
      reason,
      ...(current === undefined ? {} : { takenOverFrom: current.session }),
      ...(context.branch === undefined ? {} : { branch: context.branch }),
    });
    const claimed: Claim = { ...claimOf(line.session, line.harness, found.part, reason, line.at, context.branch), holder: "live" } as Claim;
    return current === undefined ? { ok: true, claim: claimed } : { ok: true, claim: claimed, takenOverFrom: current };
  });
}

/**
 * Why a claim on `id` would be refused right now, or undefined when it would not: the refusals
 * `claim` gives, read without taking the lock or writing a line, for a caller that must know before
 * it does something slow (makeWorkspace fetches). `claim` itself checks again under the lock.
 */
export async function claimRefusal(context: ClaimContext, id: string): Promise<Exclude<ClaimAnswer, { ok: true }> | undefined> {
  const found = await claimable(context.library, id);
  if (!("part" in found)) return found;
  const current = await readClaim(context.log, context.project, id, context.quietMs === undefined ? {} : { quietMs: context.quietMs });
  return current !== undefined && current.session !== context.session && current.holder === "live" ? { ok: false, refused: "held", holder: current } : undefined;
}

/** The live capability or increment `id`, when the library would let it be claimed; otherwise why not. */
async function claimable(library: Library, id: string): Promise<Found | Exclude<ClaimAnswer, { ok: true } | { refused: "held" }>> {
  const found = await partNamed(library, id);
  if (found === undefined) return { ok: false, refused: "unknown-capability", capability: id };
  if (found.status === "closed") return { ok: false, refused: "closed", increment: id };
  const waits = await waitingOn(library, found);
  return waits.length > 0 ? { ok: false, refused: "waiting", waits } : found;
}

/** Release `id`, a capability or an increment, if the context's session holds it. */
export async function release(context: ClaimContext, id: string): Promise<ReleaseAnswer> {
  return context.log.locked(context.project, async (log) => {
    const current = (await heldNow(log, context)).get(id);
    if (current?.session !== context.session) return current === undefined ? { ok: false, refused: "not-held" } : { ok: false, refused: "not-held", holder: current };
    await log.append({ ...who(context), kind: "released", ...partOf(current) });
    return { ok: true };
  });
}

/**
 * Report `capability` landed: write the "landed" line, which ends the context's session's claim on
 * it. Refused if the library has no such capability, or another session holds it.
 */
export async function land(context: ClaimContext, capability: string): Promise<LandAnswer> {
  if ((await partNamed(context.library, capability))?.part.capability === undefined) return { ok: false, refused: "unknown-capability", capability };
  return context.log.locked(context.project, async (log) => {
    const current = (await heldNow(log, context)).get(capability);
    if (current !== undefined && current.session !== context.session) return { ok: false, refused: "held", holder: current };
    return { ok: true, line: await log.append({ ...who(context), kind: "landed", capability }) };
  });
}

/**
 * Record that `increment` closed, with what the close meant: the "closed" line, which ends any
 * claim on it, whoever holds it. The library's own close is the caller's, done first.
 */
export async function closed(context: ClaimContext, increment: string, disposition: "landed" | "failed" | "withdrawn"): Promise<Line> {
  return context.log.locked(context.project, (log) => log.append({ ...who(context), kind: "closed", increment, disposition }));
}

/** Who holds what, as `lines` show it, each holder judged live or idle at `options.now`. In the order they were claimed. */
export function claimsFrom(lines: readonly Line[], options: ClaimsOptions = {}): Claim[] {
  const ordered = [...lines].sort((a, b) => a.seq - b.seq);
  const lastSeen = new Map<string, string>();
  for (const line of ordered) lastSeen.set(line.session, line.at);
  const claimLines = ordered.filter((line) => (CLAIM_KINDS as readonly string[]).includes(line.kind));
  const now = (options.now ?? new Date()).getTime();
  return [...held(claimLines, lastSeen, runningIn(ordered, now), now, options.quietMs ?? QUIET_MS).values()];
}

/** Who holds what in `project`'s log. */
export async function readClaims(log: ActivityLog, project: string, options: ClaimsOptions = {}): Promise<Claim[]> {
  return claimsFrom((await log.since(project, 0)).lines, options);
}

/** The current holder of one capability or increment, or undefined when nobody holds it. */
export function claimFrom(lines: readonly Line[], id: string, options: ClaimsOptions = {}): Claim | undefined {
  return claimsFrom(lines, options).find((claim) => idOf(claim) === id);
}

/** Who holds one capability or increment in `project`, using the same reading as the board. */
export async function readClaim(log: ActivityLog, project: string, id: string, options: ClaimsOptions = {}): Promise<Claim | undefined> {
  return claimFrom((await log.since(project, 0)).lines, id, options);
}

/**
 * Every edit and command in `lines`, with the capability and the increment it counts toward, each
 * the one its session claimed most recently of those it still holds; both undefined for unplanned
 * activity.
 */
export function attributeFrom(lines: readonly Line[]): Attributed[] {
  const holding = new Map<string, Part[]>(); // session → what it holds, in the order claimed
  const drop = (session: string, id: string) => {
    const held = holding.get(session);
    if (held !== undefined) holding.set(session, held.filter((other) => idOf(other) !== id));
  };
  const attributed: Attributed[] = [];
  for (const line of [...lines].sort((a, b) => a.seq - b.seq)) {
    switch (line.kind) {
      case "claimed":
        for (const session of holding.keys()) drop(session, idOf(line)); // taken over, if it was held
        holding.set(line.session, [...(holding.get(line.session) ?? []), partOf(line)]);
        break;
      case "released":
      case "landed":
        drop(line.session, idOf(line));
        break;
      case "merged":
        drop(line.holder, idOf(line));
        break;
      case "closed":
        for (const session of holding.keys()) drop(session, line.increment);
        break;
      case "session-ended":
        holding.delete(line.session);
        break;
      case "file-edited":
      case "command-run": {
        const held = holding.get(line.session) ?? [];
        const capability = held.findLast((part) => part.capability !== undefined)?.capability;
        const increment = held.findLast((part) => part.increment !== undefined)?.increment;
        attributed.push({ line, capability, increment });
        break;
      }
    }
  }
  return attributed;
}

/** Every edit and command in `project`'s log, with what it counts toward. */
export async function readAttribution(log: ActivityLog, project: string): Promise<Attributed[]> {
  return attributeFrom((await log.since(project, 0)).lines);
}

/**
 * The waits that refuse a claim on `found` (ADR-0643 D2, the owner's W2), from the library's own
 * two readings (ADR-0640 D5): whether a wait holds (`waitHolds`, which counts an increment's arc's
 * waits too), and whether an increment is held on an open question (`heldOnQuestion`):
 * - an increment's blockers still holding it, and the open questions it is held on;
 * - for a capability, those of every open increment naming it (its `touches`, ADR-0640 10-a), but
 *   only when every one of them waits: one that does not leaves the capability free, and a
 *   capability no open increment names is never refused.
 * The agent link keeps no copy of the rule for whether a wait holds.
 */
async function waitingOn(library: Library, found: Found): Promise<Waiting[]> {
  const holding = async (increment: string): Promise<Waiting[]> => [
    ...(await library.waitHolds(increment)).map((hold): Waiting => ({ increment, ...hold })),
    ...(await library.heldOnQuestion(increment)).map((question): Waiting => ({ increment, on: question, reason: "waiting on the owner's answer", forGood: false, onOwner: true })),
  ];
  const { capability, increment } = found.part;
  if (increment !== undefined) return holding(increment);
  const naming = (await increments(library)).filter((one) => one.fields.status !== "closed" && one.fields.touches?.includes(capability) === true);
  const waits: Waiting[] = [];
  for (const one of naming) {
    const holds = await holding(one.id);
    if (holds.length === 0) return [];
    waits.push(...holds);
  }
  return waits;
}

/** Who holds what right now, read under the project's lock, by the database's clock. */
async function heldNow(log: LockedLog, context: ClaimContext): Promise<Map<string, Claim>> {
  const [lines, commands, lastSeen, now] = [await log.lines(CLAIM_KINDS), await log.lines(COMMAND_KINDS), await log.lastSeen(), (await log.now()).getTime()];
  return held(lines, lastSeen, runningIn(commands, now), now, context.quietMs ?? QUIET_MS);
}

/** The sessions with a command still running at `now`, as `lines` (oldest first) show them. */
function runningIn(lines: readonly Line[], now: number): Set<string> {
  const bySession = new Map<string, Line[]>();
  for (const line of lines) bySession.set(line.session, [...(bySession.get(line.session) ?? []), line]);
  return new Set([...bySession].filter(([, own]) => commandRunning(own, now)).map(([session]) => session));
}

/** The claims standing after `claimLines`, by what they are on, each holder judged by when its session last wrote and whether a command of its is running. */
function held(claimLines: readonly Line[], lastSeen: ReadonlyMap<string, string>, running: ReadonlySet<string>, now: number, quietMs: number): Map<string, Claim> {
  const holders = new Map<string, Omit<Claim, "holder">>();
  for (const line of claimLines) {
    switch (line.kind) {
      case "claimed":
        holders.set(idOf(line), claimOf(line.session, line.harness, partOf(line), line.reason, line.at, line.branch));
        break;
      case "released":
      case "landed":
        if (holders.get(idOf(line))?.session === line.session) holders.delete(idOf(line));
        break;
      case "merged":
        if (holders.get(idOf(line))?.session === line.holder) holders.delete(idOf(line));
        break;
      case "closed":
        holders.delete(line.increment);
        break;
      case "session-ended":
        for (const [id, holder] of holders) if (holder.session === line.session) holders.delete(id);
        break;
    }
  }
  const claims = new Map<string, Claim>();
  for (const [id, holder] of holders) {
    const quiet = now - Date.parse(lastSeen.get(holder.session) ?? holder.since);
    claims.set(id, { ...holder, holder: quiet > quietMs && !running.has(holder.session) ? "idle" : "live" } as Claim);
  }
  return claims;
}

function claimOf(session: string, harness: string | undefined, part: Part, reason: string, since: string, branch: string | undefined): Omit<Claim, "holder"> {
  return { ...part, session, ...(harness === undefined ? {} : { harness }), label: labelOf(harness), reason, since, ...(branch === undefined ? {} : { branch }) } as Omit<Claim, "holder">;
}

/** What a claim is on: a capability or an increment. */
type Part = { capability: string; increment?: undefined } | { increment: string; capability?: undefined };

/** What a claim line or a claim is on. */
function partOf(of: { capability?: string | undefined; increment?: string | undefined }): Part {
  return of.increment !== undefined ? { increment: of.increment } : { capability: of.capability ?? "" };
}

/** The id of what a claim line or a claim is on. */
function idOf(of: { capability?: string | undefined; increment?: string | undefined }): string {
  return of.increment ?? of.capability ?? "";
}

/** The fields every line a claim writes carries: whose it is. */
function who(context: ClaimContext) {
  return {
    session: context.session,
    ...(context.harness === undefined ? {} : { harness: context.harness }),
    source: "tool" as const,
    ...(context.folder === undefined ? {} : { folder: context.folder }),
  };
}

/** A live capability or increment in the project's library, and where an increment is in its lifecycle. */
interface Found {
  readonly part: Part;
  readonly status?: IncrementStatus;
}

/** The live capability or increment `id` in `library`, or undefined when there is none. */
async function partNamed(library: Library, id: string): Promise<Found | undefined> {
  const { stories } = await library.projectTree();
  if (stories.some((story) => story.capabilities.some((capability) => capability.id === id))) return { part: { capability: id } };
  const increment = (await increments(library)).find((one) => one.id === id);
  return increment === undefined ? undefined : { part: { increment: id }, status: increment.fields.status };
}

/** Every live increment in `library`, arc by arc. */
export async function increments(library: Library): Promise<SchemaRecord<"increment">[]> {
  const { arcs } = await library.projectTree();
  const views = await Promise.all(arcs.map((arc) => library.arcView(arc.id)));
  return views.flatMap((view) => view?.increments ?? []);
}
