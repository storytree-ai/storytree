/**
 * Capability 5 · Claims (the Session management story): before building a capability, the agent claims it
 * with a one-line reason, and its session's edits count toward it. One live session holds a
 * capability at a time: a second is refused with the holder's name and picks other work, with no
 * queue (the owner's C1, ADR-0626 D3). A claim ends when its holder lands or releases it, when the
 * holder closes out or its session ends, or when another session takes it over after the holder has gone idle (its
 * claimed line names the holder, when it was last seen and why: idle, gone, restart or closed out; ADR-0953 D2), or
 * at once when the holder was last seen on this machine before it last started (contract 5.17).
 *
 * - Claims are lines in the agent activity log (claimed, released, landed), and who holds what is
 *   worked out from them, with the holders' liveness from their sessions' latest lines. A holder
 *   whose command is still running is live however long the command takes (capability 4), unless
 *   its standing safe close-out is verified by the same branch and process facts as the session list.
 * - Taking a claim, landing and releasing each check and write under the project's lock
 *   (ActivityLog.locked), so two sessions claiming at once cannot both win.
 * - A session may hold more than one capability. Its edits count toward the one it claimed most
 *   recently of those it still holds; an edit or command from a session holding nothing is
 *   unplanned activity.
 * - Every way a claim ends, and what that does to its increment, is claims/endings.ts's; in brief:
 * - An increment's claim also ends when the increment is closed through storytree: a "closed" line. Only its live
 *   holder closes it, or the owner's shell, or anyone once the holder reads idle or when nobody holds it (closeRefusal).
 *   Closing or releasing an increment also ends every capability claim taken while it was held, which
 *   their claimed lines name as `under`, whoever closes it and whatever the disposition (ADR-0944 D5, ADR-0949 D4).
 * - A claim also ends when a pull request from the branch it was taken on merges after it was
 *   taken (ADR-0643 D3): a "merged" line, which merges.ts writes when GitHub shows one.
 * - A holder that reads gone, crashed or abandoned with no end line, keeps its claim until the session
 *   manager releases it from its stale-claim worklist (stale-claims.ts, ADR-0953 D4); its unclosed
 *   increment, like any released one, is a proposal again (5.29).
 * - A session that hands its pull request to the watcher has its claims moved to that pull request's holder, which
 *   reads live until the watcher lets them go on its merge or closing, or gives it up; only a session on its branch,
 *   its fix session, takes them over (holdForPull, letGo, ADR-1037).
 * - A capability on the capabilities list of an increment another live session holds is refused at the claim too, naming
 *   that increment first, as the list edit and the edit gate refuse it (ADR-0949 D2): a late session backs off at the first door.
 * - Claims work on trust: storytree refuses a second claim, but cannot stop an agent that never asks.
 *   The edit tools are refused before an edit to work the session may not do (edit-gate.ts, ADR-0949 D3);
 *   nothing claims after the edit (ADR-0953 D5).
 */
import { statSync } from "node:fs";
import { uptime } from "node:os";
import path from "node:path";

import type { Hold, Holds, IncrementStatus, Library, Line, SchemaRecord, WriteOptions } from "@storytree/library";

import { thisMachine, type ActivityLog } from "../activity/index.js";
import { worktreeRoot } from "../activity/branch.js";
import { attributeFrom, CLAIM_KINDS, claimOf, holdersOf, LogFold, LONGEST_COMMAND_MS, partOf, pullHolder, pullOf, type Attributed, type Claim, type Beat, type ClaimsOptions, type Part, type Restart } from "../readings.js";
import { idleAfterMs } from "@storytree/project-and-caller";
import { endClaim } from "./endings.js";

export { attributeFrom, claimFrom, claimsFrom } from "../readings.js";
export type { Attributed, Claim, ClaimsOptions } from "../readings.js";

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
  /** Whether the line is written by a tool or a hook. By default, a tool. */
  readonly source?: "hook" | "tool";
  /** The git branch the session's folder is on, recorded with a claim so that its merge ends it (ADR-0643 D3). */
  readonly branch?: string;
  /** How long a holder may be quiet before its claim can be taken over. By default, the current idle-after setting. */
  readonly quietMs?: number;
  /** This machine, and when it last started: a holder seen on it only before then is gone. By default, read from the machine. */
  readonly restarted?: Restart;
}

/** This machine, and when it last started, or undefined when it has no name. */
export function thisRestart(): Restart | undefined {
  const machine = thisMachine();
  return machine === undefined ? undefined : { machine, at: new Date(Date.now() - uptime() * 1000) };
}

export type ClaimAnswer =
  | { ok: true; claim: Claim; takenOverFrom?: Claim; alreadyHeld?: true }
  | Held
  | { ok: false; refused: "unknown-capability"; capability: string }
  | { ok: false; refused: "closed"; increment: string }
  | { ok: false; refused: "waiting"; waits: Waiting[] }
  | { ok: false; refused: "reason-too-long"; limit: number; length: number };

/**
 * A claim refused because another live session holds the work, and the increments that session holds it for:
 * the one it claimed the work under first, then every other increment it holds. Refused work waits on those to
 * close, which a dispatcher chains it after (ADR-0955 D2).
 */
export type Held = { ok: false; refused: "held"; holder: Claim; heldFor: string[] };

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
 * `waitHolds` names it, an open question it is held on, as its `heldOnQuestion` names it, which
 * is waiting on the owner, or a wait for the owner or an outside event that still holds, as its
 * `waitsFor` reads it (ADR-0938 D1).
 */
export interface Waiting extends Hold {
  readonly increment: string;
  /** Held on the owner's open question (`on` names it), not on other work. */
  readonly onOwner?: true;
  /** Waits for the owner's action or an outside event: `on` says which in words, `reason` is its note. */
  readonly waitsFor?: "owner" | "event";
  /** An event wait's check-back day, from which it no longer holds. */
  readonly checkBack?: string;
}

/** `returned` when the release made an unclosed increment a proposal again (5.29). */
export type ReleaseAnswer = { ok: true; returned?: true } | { ok: false; refused: "not-held"; holder?: Claim };

export type ReleaseForAnswer = { ok: true; returned?: true } | { ok: false; refused: "not-held" | "live"; holder?: Claim };

export type LandAnswer =
  | { ok: true; line: Line }
  | { ok: false; refused: "held"; holder: Claim }
  | { ok: false; refused: "unknown-capability"; capability: string };

/** `keepBranch`: a claim this session already holds stays on its branch even when claimed again from a linked worktree. */
/** `throughOwnerWait`: a wait for the owner the caller is about to clear does not refuse the claim (claimClearingOwnerWait). */
type ClaimOptions = { readonly moveBranch?: true; readonly keepBranch?: true; readonly file?: string; readonly throughOwnerWait?: true };

/**
 * Claim `id`, a capability or an increment, for the context's session, with a one-line reason.
 * Refused if the library has no live capability or increment by that id, if it is a closed
 * increment, if it is waiting work (waitingOn), or if another live session holds it, a capability also when it is on
 * the list of an increment another live session holds (listingOf); a holder idle
 * past the quiet time is taken over. Claiming a proposed increment starts it, through the
 * library's own `advanceIncrement` (0.2's ADR-0386). Claiming what it already holds changes nothing,
 * unless `moveBranch` is given with a new branch, or it is claimed from a linked worktree on another branch (5.48):
 * then it holds it on that branch from now on.
 */
export async function claim(context: ClaimContext, id: string, reason: string, given: ClaimOptions = {}): Promise<ClaimAnswer> {
  const options: ClaimOptions = given.moveBranch || given.keepBranch || !inLinkedWorktree(context.folder) ? given : { ...given, moveBranch: true };
  const file = options.file === undefined ? {} : { file: options.file };
  const tooLong = reasonRefusal(reason);
  if (tooLong !== undefined) return tooLong;
  // What this session already holds is answered before the library is read (5.23).
  // A finished holder claiming again must write an admitted claim to reopen its session.
  const standing = await readClaim(context.log, context.project, id, context);
  const moves = options.moveBranch && context.branch !== undefined && context.branch !== standing?.branch;
  if (standing?.session === context.session && standing.holder === "live" && !moves) return { ok: true, claim: standing, alreadyHeld: true };
  const found = await claimable(context, id, options.throughOwnerWait === true);
  if (!("part" in found)) return found;
  return context.log.locked(context.project, async (log) => {
    const standing = await heldNow(log, context);
    const current = standing.get(id);
    const mine = current?.session === context.session;
    if (mine && current.holder === "live" && !(options.moveBranch && context.branch !== undefined && context.branch !== current.branch)) return { ok: true, claim: current, alreadyHeld: true };
    if (!mine && current?.holder === "live" && !takesOver(current, context)) {
      await log.append({ ...who(context), kind: "claim-refused", ...found.part, holder: current.session, reason, ...file, ...underOf(standing, context.session, found.part) });
      return held(standing.values(), current);
    }
    const listing = current?.holder === "live" ? undefined : await listingOf(context, standing.values(), found.part);
    if (listing !== undefined) {
      await log.append({ ...who(context), kind: "claim-refused", ...found.part, holder: listing.session, reason, ...file, ...underOf(standing, context.session, found.part) });
      return held(standing.values(), listing, listing.increment);
    }
    // A claim may have waited for this lock without needing any library write at all.
    context.writer?.signal?.throwIfAborted();
    // Activation takes the library lock and checks cancellation there, before any claimed line.
    // Once admitted, complete the claim (and its workspace) even if cancellation arrives later.
    if (found.status === "proposal") await context.library.advanceIncrement(id, "active", { ...context.writer, actor: `session:${context.session}` });
    const line = await log.append({
      ...who(context),
      kind: "claimed",
      ...found.part,
      reason,
      ...(current === undefined || mine ? {} : { takenOverFrom: current.session, ...(current.quiet === undefined ? {} : { quietSince: current.quiet.since, takenBecause: current.quiet.because }) }),
      ...(context.branch === undefined ? {} : { branch: context.branch }),
      ...file,
      ...underOf(standing, context.session, found.part),
    });
    const claimed: Claim = { ...claimOf(line.session, line.harness, found.part, reason, line.at, context.branch), holder: "live" } as Claim;
    return current === undefined || mine ? { ok: true, claim: claimed } : { ok: true, claim: claimed, takenOverFrom: current };
  });
}

/** Every claim taken, in the order taken; or the first refusal, `id` the work it refused, once this call's own claims are released. */
export type ClaimAllAnswer =
  | { ok: true; claims: Extract<ClaimAnswer, { ok: true }>[] }
  | { ok: false; id: string; refusal: Exclude<ClaimAnswer, { ok: true }> };

/**
 * Claim every one of `ids`, the capabilities a session knows it needs, with one reason, in ascending id order whatever
 * order they were given, so that two sessions needing the same ones never each hold one the other waits for (ADR-1079 D2).
 * All or nothing: at the first refusal it releases what this call took and answers that refusal. One this session already
 * held counts as taken, and is kept.
 */
export async function claimAll(context: ClaimContext, ids: readonly string[], reason: string): Promise<ClaimAllAnswer> {
  const claims: Extract<ClaimAnswer, { ok: true }>[] = [];
  for (const id of [...new Set(ids)].sort()) {
    const answer = await claim(context, id, reason);
    if (!answer.ok) {
      for (const taken of claims) if (taken.alreadyHeld !== true) await release(context, taken.claim.capability ?? taken.claim.increment!);
      return { ok: false, id, refusal: answer };
    }
    claims.push(answer);
  }
  return { ok: true, claims };
}

/**
 * Clear increment `increment`'s wait for the owner so the context's session can finish it: claim it first, through that
 * wait, then clear the wait, so it never reads ready and unclaimed in between, when a dispatcher would start a lane on it
 * (friction_bda883cf8394). Refused as `claim` refuses, the wait left standing, when anything else still holds it or
 * another live session does.
 */
export async function claimClearingOwnerWait(context: ClaimContext, increment: string, reason: string): Promise<ClaimAnswer> {
  const answer = await claim(context, increment, reason, { throughOwnerWait: true });
  if (answer.ok) await context.library.removeWaitFor(increment, "owner", context.writer);
  return answer;
}

/** Whether `folder` is in a linked worktree, whose `.git` is a file, not the main checkout, whose `.git` is a folder. */
function inLinkedWorktree(folder: string | undefined): boolean {
  const root = folder === undefined ? undefined : worktreeRoot(folder);
  try {
    return root !== undefined && statSync(path.join(root, ".git")).isFile();
  } catch {
    return false;
  }
}

/**
 * Why a claim on `id` would be refused right now, or undefined when it would not: the refusals
 * `claim` gives, read without taking the lock or writing a line, for a caller that must know before
 * it does something slow (makeWorkspace fetches). `claim` itself checks again under the lock.
 * `under` names the increment a refused capability's line is under, for a caller that has not claimed it yet.
 */
export async function claimRefusal(context: ClaimContext, id: string, reason?: string, under?: string): Promise<Exclude<ClaimAnswer, { ok: true }> | undefined> {
  const found = await claimable(context, id);
  if (!("part" in found)) return found;
  const standing = await readClaims(context.log, context.project, {
    ...(context.quietMs === undefined ? {} : { quietMs: context.quietMs }),
    ...(context.restarted === undefined ? {} : { restarted: context.restarted }),
  });
  const current = standing.find((claim) => (claim.increment ?? claim.capability) === id);
  const direct = current !== undefined && current.session !== context.session && current.holder === "live" && !takesOver(current, context);
  const listing = direct || current?.holder === "live" ? undefined : await listingOf(context, standing, found.part);
  const holder = direct ? current : listing;
  if (holder === undefined) return undefined;
  // A caller giving the reason it would claim with is turned away now, so the refusal is recorded.
  if (reason !== undefined) {
    const named = under !== undefined && found.part.capability !== undefined ? { under } : underOf(new Map(standing.map((claim) => [claim.increment ?? claim.capability!, claim])), context.session, found.part);
    await context.log.append(context.project, { ...who(context), kind: "claim-refused", ...found.part, holder: holder.session, reason, ...named });
  }
  return held(standing, holder, listing?.increment);
}

/**
 * Another live session's claim on an increment whose capabilities list names the capability `part`, unless the context's
 * session takes it over (its pull request's fix session): one session plans a capability at a time, so its claim is
 * refused at the first door, as the list edit and the edit gate refuse it (ADR-0949 D2, ADR-0944 D3).
 */
async function listingOf(context: ClaimContext, standing: Iterable<Claim>, part: Part): Promise<Claim | undefined> {
  if (part.capability === undefined) return undefined;
  for (const claim of standing) {
    if (claim.increment === undefined || claim.session === context.session || claim.holder !== "live" || takesOver(claim, context)) continue;
    const listed = ((await context.library.get(claim.increment))?.fields as { capabilities?: string[] } | undefined)?.capabilities ?? [];
    if (listed.includes(part.capability)) return claim;
  }
  return undefined;
}

/** Whether the context's session takes over `current`, a pull request's held claim: it works on that pull request's branch, as its fix session does (ADR-1037 D2). */
function takesOver(current: Claim, context: ClaimContext): boolean {
  return pullOf(current.session) !== undefined && context.branch !== undefined && context.branch === current.branch;
}

/** The refusal of a claim `holder` holds, naming the increments it holds the work for among `standing` claims, `listedOn` first: the one whose list names it. */
function held(standing: Iterable<Claim>, holder: Claim, listedOn?: string): Held {
  const holds = [...standing].filter((claim) => claim.session === holder.session && claim.increment !== undefined).map((claim) => claim.increment!);
  const heldFor = [...new Set([...(listedOn === undefined ? [] : [listedOn]), ...(holder.under === undefined ? [] : [holder.under]), ...holds])];
  return { ok: false, refused: "held", holder, heldFor };
}

/** The live capability or increment `id`, when the library would let it be claimed, passing a wait for the owner when `throughOwnerWait`; otherwise why not. */
async function claimable(context: ClaimContext, id: string, throughOwnerWait = false): Promise<Found | Exclude<ClaimAnswer, { ok: true } | { refused: "held" }>> {
  const { library } = context;
  const found = await partNamed(library, id);
  if (found === undefined) return { ok: false, refused: "unknown-capability", capability: id };
  if (found.status === "closed") return { ok: false, refused: "closed", increment: id };
  const waits = (await waitingOn(library, found)).filter((wait) => !(throughOwnerWait && wait.waitsFor === "owner"));
  return waits.length === 0 ? found : { ok: false, refused: "waiting", waits };
}

/** Release `id`, a capability or an increment, if the context's session holds it. */
export async function release(context: ClaimContext, id: string): Promise<ReleaseAnswer> {
  return context.log.locked(context.project, async (log) => {
    const current = (await heldNow(log, context)).get(id);
    if (current?.session !== context.session) return current === undefined ? { ok: false, refused: "not-held" } : { ok: false, refused: "not-held", holder: current };
    const { returned } = await endClaim(log, who(context), partOf(current), { by: "holder" }, context);
    return returned ? { ok: true, returned } : { ok: true };
  });
}

/**
 * A hand-over keeps its claims (ADR-1037 D1): every claim `session` took on the pull request's `branch` moves to pull
 * request `pr`'s holder (pullHolder), so that its merge ends them, each capability still under its increment; its claims
 * on other branches stay its own (5.50). So does each claim it took on no branch, from the main checkout, that is the
 * handed `increment` or under it or under an increment it holds on the branch, and moves onto the branch (5.56).
 * Nothing is released, so no increment returns to proposal, and the session's close-out or end leaves them standing.
 * The ids moved.
 */
export async function holdForPull(context: ClaimContext, session: string, pr: number, branch: string, increment?: string): Promise<string[]> {
  return context.log.locked(context.project, async (log) => {
    const moved: string[] = [];
    const own = [...(await heldNow(log, context)).values()].filter((claim) => claim.session === session);
    const handed = new Set([...(increment === undefined ? [] : [increment]), ...own.filter((claim) => claim.branch === branch).flatMap((claim) => claim.increment ?? [])]);
    for (const claim of own) {
      const branchless = claim.branch === undefined && [claim.increment, claim.under].some((id) => id !== undefined && handed.has(id));
      if (claim.branch !== branch && !branchless) continue;
      await log.append({ session: pullHolder(pr), harness: "watcher", source: context.source ?? "tool", kind: "claimed", ...partOf(claim),
        reason: claim.reason, takenOverFrom: session, branch, ...(claim.under === undefined ? {} : { under: claim.under }) });
      moved.push(claim.increment ?? claim.capability!);
    }
    return moved;
  });
}

/**
 * Pull request `pr`'s held claims end (ADR-1037 D1, D3): on its merge or its closing, or when the watcher gives it up,
 * red past its fix limit or open past its time-out. Each is a release naming the holder and `reason`, capabilities
 * first, so an unclosed increment is a proposal again (5.29) and back on its arc as work. On its merge (`merged`), each
 * held increment's pending plan changes are applied first, marked with the pull request, as a merge a hook sees applies
 * them (merges.ts, ADR-0966 D4), and outside the log's lock, so no hook waits on a long apply; an apply that fails ends
 * nothing, so the claims stand for the next let-go or a hook's look (5.61). The ids released.
 */
export async function letGo(context: ClaimContext, pr: number, reason: string, { merged = false }: { merged?: boolean } = {}): Promise<string[]> {
  const holder = pullHolder(pr);
  if (merged) {
    const increments = (await readClaims(context.log, context.project)).filter((claim) => claim.session === holder && claim.increment !== undefined);
    for (const { increment } of increments) await context.library.applyPending(increment!, `#${pr}`, context.writer);
  }
  return context.log.locked(context.project, async (log) => {
    const held = [...(await heldNow(log, context)).values()].filter((claim) => claim.session === holder)
      .sort((a, b) => Number(a.capability === undefined) - Number(b.capability === undefined));
    for (const claim of held) await endClaim(log, who(context), partOf(claim), { by: "manager", holder, reason }, context);
    return held.map((claim) => claim.increment ?? claim.capability!);
  });
}

/**
 * The watcher found pull request `pr`, handed over for `increment`, red and starts its fix session (ADR-1064 D4): a pr-red
 * line on the pull request's holder, as holdForPull writes, so it makes no session read live; `checks` names its failed checks.
 */
export async function recordRed(context: ClaimContext, pr: number, increment: string, conflict: boolean, checks: string[]): Promise<void> {
  await context.log.append(context.project, { session: pullHolder(pr), harness: "watcher", source: context.source ?? "tool", kind: "pr-red", pr, increment, conflict, checks });
}

/** The session a ci-rerun line is written on: the watcher's own, which reads as no session (ABOUT_OTHERS). */
export const WATCHER_SESSION = "watcher";

/**
 * The watcher reran CI run `run` of the GitHub repository `repo`, starting its `attempt` (Agent runner 4.27): a ci-rerun
 * line on the watcher, so its reruns are told from the owner's, whom GitHub names as the actor of both.
 */
export async function recordRerun(context: ClaimContext, rerun: { repo: string; run: number; attempt: number; what: "main" | "release" | "pr" }): Promise<void> {
  await context.log.append(context.project, { session: WATCHER_SESSION, harness: "watcher", source: context.source ?? "tool", kind: "ci-rerun", ...rerun });
}

/**
 * Asking the owner about `increment` releases the work it holds (ADR-0944 D4): when the context's session holds it,
 * its claim ends, and so do the session's capability claims taken under it; an active increment is a proposal again,
 * as any release returns it (5.29), and reads held on the owner. Claims on other work stand, and an increment the
 * session does not hold releases nothing. The ids released, the increment first.
 */
export async function releaseAsked(context: ClaimContext, increment: string): Promise<string[]> {
  return context.log.locked(context.project, async (log) => {
    const standing = await heldNow(log, context);
    if (standing.get(increment)?.session !== context.session) return [];
    const taken = [...standing.values()].filter((claim) => claim.session === context.session && claim.under === increment);
    const released: string[] = [];
    for (const claim of [standing.get(increment)!, ...taken]) {
      await endClaim(log, who(context), partOf(claim), { by: "holder" }, context);
      released.push(claim.increment ?? claim.capability!);
    }
    return released;
  });
}

/**
 * The session manager's release (ADR-0944 D7): end `holder`'s claim on `id` for it, after messaging a quiet
 * holder, writing a "released" line that names the holder and `reason`. Only the session manager does this;
 * every other session still never releases another's claims (ADR-0931 D2). Refused, writing nothing, when
 * `holder` does not hold `id`, or holds it and still reads live.
 */
export async function releaseFor(context: ClaimContext, id: string, holder: string, reason: string): Promise<ReleaseForAnswer> {
  return context.log.locked(context.project, async (log) => {
    const current = (await heldNow(log, context)).get(id);
    if (current?.session !== holder) return current === undefined ? { ok: false, refused: "not-held" } : { ok: false, refused: "not-held", holder: current };
    if (current.holder === "live") return { ok: false, refused: "live", holder: current };
    const { returned } = await endClaim(log, who(context), partOf(current), { by: "manager", holder, reason }, context);
    return returned ? { ok: true, returned } : { ok: true };
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
    return { ok: true, line: (await endClaim(log, who(context), { capability }, { by: "landing" })).line };
  });
}

/**
 * Why the context's session may not close `increment`, or undefined when it may: another session holds it and reads
 * live, a pull request's holder included, so a lane whose claim was taken over or handed to its pull request cannot
 * close the work. The holder closes it, and so does the owner's shell (`person:`, where the watcher closes too), anyone
 * once the holder reads idle (the session manager), and anyone when nobody holds it.
 */
export async function closeRefusal(context: ClaimContext, increment: string): Promise<Held | undefined> {
  if (context.session.startsWith("person:")) return undefined;
  const standing = await readClaims(context.log, context.project, {
    ...(context.quietMs === undefined ? {} : { quietMs: context.quietMs }),
    ...(context.restarted === undefined ? {} : { restarted: context.restarted }),
  });
  const current = standing.find((claim) => claim.increment === increment);
  if (current === undefined || current.session === context.session || current.holder !== "live") return undefined;
  return held(standing, current);
}

/**
 * Record that `increment` closed, with what the close meant: the "closed" line, which ends any
 * claim on it, whoever holds it. Whether the session may close it is `closeRefusal`'s, and the library's own close
 * is the caller's, both done first.
 */
export async function closed(context: ClaimContext, increment: string, disposition: "landed" | "failed" | "withdrawn"): Promise<Line> {
  return context.log.locked(context.project, async (log) => (await endClaim(log, who(context), { increment }, { by: "close", disposition })).line);
}

/** Who holds what in `project`'s log, read from the standing claims and their holders' latest lines alone (contract 2.7). */
export async function readClaims(log: ActivityLog, project: string, options: ClaimsOptions = {}): Promise<Claim[]> {
  const reads: ClaimReads = { standing: () => log.standing(project), foldLines: (sessions, since) => log.foldLines(project, sessions, since), beats: (sessions) => log.beats.of(project, sessions) };
  const now = (options.now ?? new Date()).getTime();
  return [...(await heldIn(reads, now, options.quietMs ?? idleAfterMs(), options.restarted ?? thisRestart())).values()];
}

/** Who holds one capability or increment in `project`, using the same reading as the board. */
export async function readClaim(log: ActivityLog, project: string, id: string, options: ClaimsOptions = {}): Promise<Claim | undefined> {
  return (await readClaims(log, project, options)).find((claim) => (claim.increment ?? claim.capability) === id);
}

/** Every edit and command in `project`'s log, with what it counts toward: the lines of the kinds that reading takes. */
export async function readAttribution(log: ActivityLog, project: string): Promise<Attributed[]> {
  return attributeFrom(await log.lines(project, { kinds: [...CLAIM_KINDS, "file-edited", "command-run"] }));
}

/**
 * The waits that refuse a claim on `found` (ADR-0643 D2, the owner's W2), from the library's own
 * two readings (ADR-0640 D5): whether a wait holds (`waitHolds`, which counts an increment's arc's
 * waits too), and whether an increment is held on an open question (`heldOnQuestion`). Only an
 * increment waits: its blockers still holding it, and the open questions it is held on. A
 * capability never does, whatever the increments listing it among their capabilities wait on, since
 * that list does not refuse a capability claim (ADR-0944 D2). Session management keeps no copy of the rule for whether a wait holds.
 */
async function waitingOn(library: Library, found: Found): Promise<Waiting[]> {
  const { increment } = found.part;
  if (increment === undefined) return [];
  const holds = await library.holds();
  return [
    ...(holds.waits[increment] ?? []).map((hold): Waiting => ({ increment, ...hold })),
    ...(holds.heldOn[increment] ?? []).map((question): Waiting => ({ increment, on: question, reason: "waiting on the owner's answer", forGood: false, onOwner: true })),
    ...(holds.waitsFor?.[increment] ?? []).filter((wait) => wait.holds).map(({ releaser, note, checkBack }): Waiting => ({
      increment, on: releaser === "owner" ? "the owner" : "an outside event", reason: note, forGood: false, waitsFor: releaser, ...(checkBack === undefined ? {} : { checkBack }),
    })),
  ];
}

/** For a capability claim, the increment `session` holds that it was claimed most recently of, which closing or releasing ends it with (ADR-0949 D4). */
function underOf(standing: ReadonlyMap<string, Claim>, session: string, part: Part): { under?: string } {
  if (part.capability === undefined) return {};
  const under = [...standing.values()].filter((claim) => claim.session === session && claim.increment !== undefined).sort((a, b) => a.since.localeCompare(b.since)).at(-1)?.increment;
  return under === undefined ? {} : { under };
}

/** Who holds what right now, read under the project's lock, by the database's clock. */
async function heldNow(log: ClaimReads & { now(): Promise<Date> }, context: ClaimContext): Promise<Map<string, Claim>> {
  return heldIn(log, (await log.now()).getTime(), context.quietMs ?? idleAfterMs(), context.restarted ?? thisRestart());
}

/** What the claims reading asks of a log, locked or not. */
interface ClaimReads {
  standing(): Promise<Line[]>;
  foldLines(sessions: readonly string[], commandsSince: string): Promise<Line[]>;
  beats(sessions: readonly string[]): Promise<Map<string, Beat>>;
}

/** How far back a holder's commands are read: a command started earlier is past any limit on it, with a minute for a finish written before its start. */
export const COMMANDS_MS = LONGEST_COMMAND_MS + 60_000;

/**
 * Who holds what at `now`: the standing claims and the bounded session reading that verifies each
 * holder's close-out, including commands within LONGEST_COMMAND_MS. Ended claims and irrelevant
 * history are never sent (contract 2.7), including while claim admission holds the lock.
 */
async function heldIn(reads: ClaimReads, now: number, quietMs: number, restarted: Restart | undefined): Promise<Map<string, Claim>> {
  const claimLines = await reads.standing();
  const holders = holdersOf(claimLines);
  if (holders.length === 0) return new Map();
  const [lines, beats] = await Promise.all([reads.foldLines(holders, new Date(now - COMMANDS_MS).toISOString()), reads.beats(holders)]);
  const fold = LogFold.fromBounded(lines, claimLines);
  return new Map(fold.claims({ now: new Date(now), quietMs, beats, ...(restarted === undefined ? {} : { restarted }) })
    .map((claim) => [claim.increment ?? claim.capability, claim]));
}

/** Who writes a claim's lines. */
type Who = Pick<ClaimContext, "session" | "harness" | "source" | "folder">;

/** The fields every line a claim writes carries: whose it is. */
function who(context: Who) {
  return {
    session: context.session,
    ...(context.harness === undefined ? {} : { harness: context.harness }),
    source: context.source ?? ("tool" as const),
    ...(context.folder === undefined ? {} : { folder: context.folder }),
  };
}

/** A live capability or increment in the project's library, and where an increment is in its lifecycle. */
interface Found {
  readonly part: Part;
  readonly status?: IncrementStatus;
}

/** The live capability or increment `id` in `library`, or undefined when there is none: that one record, not the plan (5.23). */
async function partNamed(library: Library, id: string): Promise<Found | undefined> {
  const record = await library.get(id);
  if (record?.type === "capability") return { part: { capability: id } };
  if (record?.type === "increment") return { part: { increment: id }, status: (record as SchemaRecord<"increment">).fields.status };
  return undefined;
}

/** Every live increment in `library`, arc by arc, read in one ask however many arcs there are. */
export async function increments(library: Library): Promise<SchemaRecord<"increment">[]> {
  return (await library.arcViews()).flatMap((view) => view.increments);
}

/** Its section of the habits card (ADR-1021, the guidance kind): claims, the session's name, workspaces and opening the knowledge a claim needs. */
export const claimsGuidance: readonly string[] = [
  [
  "Claim, and open the knowledge you need.",
  "- `claim` the increment you drive: that starts it. `claim` a capability before you touch it; `file_owners` names each file's capability and holder. Your reason, 40 characters or fewer, names your session's row. If another session holds it, or it waits on other work, pick other work: nobody queues. A capability you need already held means you are late: push unfinished work to a branch named on the increment, `release` all your claims, the increment's too, and pick other work. A session manager reads `stale_claims`: claimed increments whose holder went quiet, with routes.",
  "- Once you know what you are doing, `name_session` names your row in the sessions list, in 40 characters or fewer; name it again when your work shifts. Until you do, the row reads your claim's reason, or your harness and folder.",
  "- Only when the user asks for a separate workspace, call `make_workspace` before claiming: Claude Code gets a claimed worktree to enter. For Codex, call the desktop app’s create_worktree with the ref and name it returns, then `attach_workspace` with the folder, ref, name and your reason; attach a folder returned with a registration error rather than create another.",
  "- `open` the capability to see its shelf: the decisions that are its way into the project's knowledge, as spines. Start at the shelf, open what matches your task, and stop when you can act. `search_notes` finds the artifacts closest in meaning to a question.",
  ].join("\n"),
];
