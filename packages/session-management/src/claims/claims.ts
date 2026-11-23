// Capability 5 · Claims
import { statSync } from "node:fs";
import { uptime } from "node:os";
import path from "node:path";

import type { Hold, Holds, IncrementStatus, Library, Line, SchemaRecord, WriteOptions } from "@storytree/library";

import { thisMachine, type ActivityLog } from "../activity/index.js";
import { worktreeRoot } from "../activity/branch.js";
import { attributeFrom, CLAIM_KINDS, claimOf, holdersOf, isMainBranch, LogFold, LONGEST_COMMAND_MS, partOf, pullHolder, pullOf, type Attributed, type Claim, type Beat, type ClaimsOptions, type Part, type Restart } from "../readings.js";
import { idleAfterMs } from "@storytree/project-and-caller";
import { endClaim } from "./endings.js";

export { attributeFrom, claimFrom, claimsFrom } from "../readings.js";
export type { Attributed, Claim, ClaimsOptions } from "../readings.js";

export interface ClaimContext {
  readonly log: ActivityLog;
  readonly library: Library;
  readonly writer?: WriteOptions;
  readonly project: string;
  readonly session: string;
  readonly harness?: string;
  readonly folder?: string;
  readonly source?: "hook" | "tool";
  readonly branch?: string;
  readonly quietMs?: number;
  readonly restarted?: Restart;
}

export function thisRestart(): Restart | undefined {
  const machine = thisMachine();
  return machine === undefined ? undefined : { machine, at: new Date(Date.now() - uptime() * 1000) };
}

export type ClaimAnswer =
  | { ok: true; claim: Claim; takenOverFrom?: Claim; alreadyHeld?: true }
  | Held
  | { ok: false; refused: "unknown-capability"; capability: string }
  | { ok: false; refused: "closed"; increment: string }
  | { ok: false; refused: "waiting"; waits: Waiting[] };

export type Held = { ok: false; refused: "held"; holder: Claim; heldFor: string[] };

export interface Waiting extends Hold {
  readonly increment: string;
  readonly onOwner?: true;
  readonly waitsFor?: "owner" | "event";
  readonly checkBack?: string;
}

export type ReleaseAnswer = { ok: true; returned?: true } | { ok: false; refused: "not-held"; holder?: Claim };

export type ReleaseForAnswer = { ok: true; returned?: true } | { ok: false; refused: "not-held" | "live"; holder?: Claim };

export type LandAnswer =
  | { ok: true; line: Line }
  | { ok: false; refused: "held"; holder: Claim }
  | { ok: false; refused: "unknown-capability"; capability: string };

type ClaimOptions = { readonly moveBranch?: true; readonly keepBranch?: true; readonly file?: string; readonly throughOwnerWait?: true };

export async function claim(context: ClaimContext, id: string, reason: string, given: ClaimOptions = {}): Promise<ClaimAnswer> {
  const options: ClaimOptions = given.moveBranch || given.keepBranch || !inLinkedWorktree(context.folder) ? given : { ...given, moveBranch: true };
  const file = options.file === undefined ? {} : { file: options.file };
  const standing = await readClaim(context.log, context.project, id, context);
  const moves = options.moveBranch && context.branch !== undefined && context.branch !== standing?.branch;
  if (standing?.session === context.session && standing.holder === "live" && !moves) return { ok: true, claim: standing, alreadyHeld: true };
  const found = await claimable(context, id, options.throughOwnerWait === true);
  if (!("part" in found)) return found;
  return context.log.locked(context.project, async (log) => {
    const standing = await heldNow(log, context);
    const current = standing.get(id);
    const mine = current?.session === context.session;
    const under = underOf(standing, context.session, found.part);
    const branch = branchFor(standing, context.branch, found.part.increment ?? under.under);
    if (mine && current.holder === "live" && !(options.moveBranch && context.branch !== undefined && branch !== current.branch)) return { ok: true, claim: current, alreadyHeld: true };
    if (!mine && current?.holder === "live" && !takesOver(current, context)) {
      await log.append({ ...who(context), kind: "claim-refused", ...found.part, holder: current.session, reason, ...file, ...underOf(standing, context.session, found.part) });
      return held(standing.values(), current);
    }
    const listing = current?.holder === "live" ? undefined : await listingOf(context, standing.values(), found.part);
    if (listing !== undefined) {
      await log.append({ ...who(context), kind: "claim-refused", ...found.part, holder: listing.session, reason, ...file, ...underOf(standing, context.session, found.part) });
      return held(standing.values(), listing, listing.increment);
    }
    context.writer?.signal?.throwIfAborted();
    if (found.status === "proposal") await context.library.advanceIncrement(id, "active", { ...context.writer, actor: `session:${context.session}` });
    const line = await log.append({
      ...who(context),
      kind: "claimed",
      ...found.part,
      reason,
      ...(current === undefined || mine ? {} : { takenOverFrom: current.session, ...(current.quiet === undefined ? {} : { quietSince: current.quiet.since, takenBecause: current.quiet.because }) }),
      ...(branch === undefined ? {} : { branch }),
      ...file,
      ...under,
    });
    const claimed: Claim = { ...claimOf(line.session, line.harness, found.part, reason, line.at, branch), holder: "live" } as Claim;
    return current === undefined || mine ? { ok: true, claim: claimed } : { ok: true, claim: claimed, takenOverFrom: current };
  });
}

export type ClaimAllAnswer =
  | { ok: true; claims: Extract<ClaimAnswer, { ok: true }>[] }
  | { ok: false; id: string; refusal: Exclude<ClaimAnswer, { ok: true }> };

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

export async function claimClearingOwnerWait(context: ClaimContext, increment: string, reason: string): Promise<ClaimAnswer> {
  const answer = await claim(context, increment, reason, { throughOwnerWait: true });
  if (answer.ok) await context.library.removeWaitFor(increment, "owner", { ...context.writer, reason: `cleared by ${context.session}, which finishes it: ${reason}` });
  return answer;
}

function inLinkedWorktree(folder: string | undefined): boolean {
  const root = folder === undefined ? undefined : worktreeRoot(folder);
  try {
    return root !== undefined && statSync(path.join(root, ".git")).isFile();
  } catch {
    return false;
  }
}

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
  if (reason !== undefined) {
    const named = under !== undefined && found.part.capability !== undefined ? { under } : underOf(new Map(standing.map((claim) => [claim.increment ?? claim.capability!, claim])), context.session, found.part);
    await context.log.append(context.project, { ...who(context), kind: "claim-refused", ...found.part, holder: holder.session, reason, ...named });
  }
  return held(standing, holder, listing?.increment);
}

async function listingOf(context: ClaimContext, standing: Iterable<Claim>, part: Part): Promise<Claim | undefined> {
  if (part.capability === undefined) return undefined;
  const nested = await nestedWith(context.library, part.capability);
  for (const claim of standing) {
    if (claim.session === context.session || claim.holder !== "live" || takesOver(claim, context)) continue;
    if (claim.increment === undefined) {
      if (claim.capability !== undefined && claim.capability !== part.capability && nested.has(claim.capability)) return claim;
      continue;
    }
    const listed = ((await context.library.get(claim.increment))?.fields as { capabilities?: string[] } | undefined)?.capabilities ?? [];
    if (listed.some((id) => nested.has(id))) return claim;
  }
  return undefined;
}

async function nestedWith(library: Library, capability: string): Promise<Set<string>> {
  const parents = new Map((await library.list("capability")).flatMap(({ id, fields }) => (fields.parent === undefined ? [] : [[id, fields.parent] as const])));
  const above = (id: string): string[] => {
    const chain: string[] = [];
    for (let at = parents.get(id); at !== undefined && at !== id && !chain.includes(at); at = parents.get(at)) chain.push(at);
    return chain;
  };
  return new Set([capability, ...above(capability), ...[...parents.keys()].filter((id) => above(id).includes(capability))]);
}

function takesOver(current: Claim, context: ClaimContext): boolean {
  return pullOf(current.session) !== undefined && context.branch !== undefined && context.branch === current.branch;
}

function held(standing: Iterable<Claim>, holder: Claim, listedOn?: string): Held {
  const holds = [...standing].filter((claim) => claim.session === holder.session && claim.increment !== undefined).map((claim) => claim.increment!);
  const heldFor = [...new Set([...(listedOn === undefined ? [] : [listedOn]), ...(holder.under === undefined ? [] : [holder.under]), ...holds])];
  return { ok: false, refused: "held", holder, heldFor };
}

async function claimable(context: ClaimContext, id: string, throughOwnerWait = false): Promise<Found | Exclude<ClaimAnswer, { ok: true } | { refused: "held" }>> {
  const { library } = context;
  const found = await partNamed(library, id);
  if (found === undefined) return { ok: false, refused: "unknown-capability", capability: id };
  if (found.status === "closed") return { ok: false, refused: "closed", increment: id };
  const waits = (await waitingOn(context, found)).filter((wait) => !(throughOwnerWait && wait.waitsFor === "owner"));
  return waits.length === 0 ? found : { ok: false, refused: "waiting", waits };
}

export async function release(context: ClaimContext, id: string): Promise<ReleaseAnswer> {
  return context.log.locked(context.project, async (log) => {
    const current = (await heldNow(log, context)).get(id);
    if (current?.session !== context.session) return current === undefined ? { ok: false, refused: "not-held" } : { ok: false, refused: "not-held", holder: current };
    const { returned } = await endClaim(log, who(context), partOf(current), { by: "holder" }, context);
    return returned ? { ok: true, returned } : { ok: true };
  });
}

export async function holdForPull(context: ClaimContext, session: string, pr: number, branch: string, increment?: string): Promise<string[]> {
  return context.log.locked(context.project, async (log) => {
    const moved: string[] = [];
    const own = [...(await heldNow(log, context)).values()].filter((claim) => claim.session === session);
    const handed = new Set([...(increment === undefined ? [] : [increment]), ...own.filter((claim) => claim.branch === branch).flatMap((claim) => claim.increment ?? [])]);
    for (const claim of own) {
      const branchless = (claim.branch === undefined || isMainBranch(claim.branch)) && [claim.increment, claim.under].some((id) => id !== undefined && handed.has(id));
      if (claim.branch !== branch && !branchless) continue;
      await log.append({ session: pullHolder(pr), harness: "watcher", source: context.source ?? "tool", kind: "claimed", ...partOf(claim),
        reason: claim.reason, takenOverFrom: session, branch, ...(claim.under === undefined ? {} : { under: claim.under }) });
      moved.push(claim.increment ?? claim.capability!);
    }
    return moved;
  });
}

export async function letGo(context: ClaimContext, pr: number, reason: string, { merged = false }: { merged?: boolean } = {}): Promise<string[]> {
  const holder = pullHolder(pr);
  if (merged) {
    const held = (await readClaims(context.log, context.project)).filter((claim) => claim.session === holder).flatMap((claim) => claim.increment ?? []);
    const ended = (await context.log.lines(context.project, { kinds: ["merged"], where: { holder }, has: ["increment"] }))
      .flatMap((line) => (line.kind === "merged" && line.increment !== undefined ? [line.increment] : []));
    for (const increment of new Set([...held, ...ended])) await context.library.applyPending(increment, `#${pr}`, context.writer);
  }
  return context.log.locked(context.project, async (log) => {
    const held = [...(await heldNow(log, context)).values()].filter((claim) => claim.session === holder)
      .sort((a, b) => Number(a.capability === undefined) - Number(b.capability === undefined));
    for (const claim of held) await endClaim(log, who(context), partOf(claim), { by: "manager", holder, reason }, context);
    return held.map((claim) => claim.increment ?? claim.capability!);
  });
}

export async function recordRed(context: ClaimContext, pr: number, increment: string, conflict: boolean, checks: string[]): Promise<void> {
  await context.log.append(context.project, { session: pullHolder(pr), harness: "watcher", source: context.source ?? "tool", kind: "pr-red", pr, increment, conflict, checks });
}

export const WATCHER_SESSION = "watcher";

export async function recordRerun(context: ClaimContext, rerun: { repo: string; run: number; attempt: number; what: "main" | "release" | "pr" }): Promise<void> {
  await context.log.append(context.project, { session: WATCHER_SESSION, harness: "watcher", source: context.source ?? "tool", kind: "ci-rerun", ...rerun });
}

export interface QueueRed { pr: number; increment: string; removedAt: string; commit: string; checks: string[]; tests: string[]; outcome: "real" | "flake" | "ahead" | "unknown" }

export async function recordQueueRed(context: ClaimContext, red: QueueRed): Promise<void> {
  await context.log.append(context.project, { session: WATCHER_SESSION, harness: "watcher", source: context.source ?? "tool", kind: "queue-red", ...red });
}

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

export async function releaseFor(context: ClaimContext, id: string, holder: string, reason: string): Promise<ReleaseForAnswer> {
  return context.log.locked(context.project, async (log) => {
    const current = (await heldNow(log, context)).get(id);
    if (current?.session !== holder) return current === undefined ? { ok: false, refused: "not-held" } : { ok: false, refused: "not-held", holder: current };
    if (current.holder === "live" && !(await isClosed(context.library, id))) return { ok: false, refused: "live", holder: current };
    const { returned } = await endClaim(log, who(context), partOf(current), { by: "manager", holder, reason }, context);
    return returned ? { ok: true, returned } : { ok: true };
  });
}

export async function land(context: ClaimContext, capability: string): Promise<LandAnswer> {
  if ((await partNamed(context.library, capability))?.part.capability === undefined) return { ok: false, refused: "unknown-capability", capability };
  return context.log.locked(context.project, async (log) => {
    const current = (await heldNow(log, context)).get(capability);
    if (current !== undefined && current.session !== context.session) return { ok: false, refused: "held", holder: current };
    return { ok: true, line: (await endClaim(log, who(context), { capability }, { by: "landing" })).line };
  });
}

export async function closeRefusal(context: ClaimContext, increment: string): Promise<Held | undefined> {
  if (context.session.startsWith("person:")) return undefined;
  const standing = await readClaims(context.log, context.library.name, {
    ...(context.quietMs === undefined ? {} : { quietMs: context.quietMs }),
    ...(context.restarted === undefined ? {} : { restarted: context.restarted }),
  });
  const current = standing.find((claim) => claim.increment === increment);
  if (current === undefined || current.session === context.session || current.holder !== "live") return undefined;
  return held(standing, current);
}

export async function closed(context: ClaimContext, increment: string, disposition: "landed" | "failed" | "withdrawn"): Promise<Line> {
  return context.log.locked(context.library.name, async (log) => (await endClaim(log, who(context), { increment }, { by: "close", disposition })).line);
}

export async function readClaims(log: ActivityLog, project: string, options: ClaimsOptions = {}): Promise<Claim[]> {
  const reads: ClaimReads = { standing: () => log.standing(project), foldLines: (sessions, since) => log.foldLines(project, sessions, since), beats: (sessions) => log.beats.of(project, sessions) };
  const now = (options.now ?? new Date()).getTime();
  return [...(await heldIn(reads, now, options.quietMs ?? idleAfterMs(), options.restarted ?? thisRestart())).values()];
}

export async function readClaim(log: ActivityLog, project: string, id: string, options: ClaimsOptions = {}): Promise<Claim | undefined> {
  return (await readClaims(log, project, options)).find((claim) => (claim.increment ?? claim.capability) === id);
}

export async function readAttribution(log: ActivityLog, project: string): Promise<Attributed[]> {
  return attributeFrom(await log.lines(project, { kinds: [...CLAIM_KINDS, "file-edited", "command-run"] }));
}

async function waitingOn(context: ClaimContext, found: Found): Promise<Waiting[]> {
  const { library } = context;
  const { increment } = found.part;
  if (increment === undefined) return [];
  const unread = await library.holds();
  const holds = (unread.waits[increment] ?? []).some((hold) => hold.claim === true) ? await library.holds(new Date(), { claimed: await claimedByOthers(context, increment) }) : unread;
  return [
    ...(holds.waits[increment] ?? []).map((hold): Waiting => ({ increment, ...hold })),
    ...(holds.heldOn[increment] ?? []).map((question): Waiting => ({ increment, on: question, reason: "waiting on the owner's answer", forGood: false, onOwner: true })),
    ...(holds.waitsFor?.[increment] ?? []).filter((wait) => wait.holds).map(({ releaser, note, checkBack }): Waiting => ({
      increment, on: releaser === "owner" ? "the owner" : "an outside event", reason: note, forGood: false, waitsFor: releaser, ...(checkBack === undefined ? {} : { checkBack }),
    })),
  ];
}

async function claimedByOthers(context: ClaimContext, waiter: string): Promise<Set<string>> {
  const others = (await readClaims(context.log, context.project, context)).filter((claim) =>
    claim.holder === "live" && claim.session !== context.session && claim.increment !== waiter && claim.under !== waiter);
  const listed = await Promise.all(others.flatMap((claim) => (claim.increment === undefined ? [] : [claim.increment])).map(async (increment) =>
    ((await context.library.get(increment))?.fields as { capabilities?: string[] } | undefined)?.capabilities ?? []));
  return new Set([...others.flatMap((claim) => (claim.capability === undefined ? [] : [claim.capability])), ...listed.flat()]);
}

function underOf(standing: ReadonlyMap<string, Claim>, session: string, part: Part): { under?: string } {
  if (part.capability === undefined) return {};
  const under = [...standing.values()].filter((claim) => claim.session === session && claim.increment !== undefined).sort((a, b) => a.since.localeCompare(b.since)).at(-1)?.increment;
  return under === undefined ? {} : { under };
}

function branchFor(standing: ReadonlyMap<string, Claim>, branch: string | undefined, increment: string | undefined): string | undefined {
  if (branch === undefined || increment === undefined) return branch;
  return [...standing.values()].some((claim) => claim.increment !== undefined && claim.increment !== increment && claim.branch === branch) ? undefined : branch;
}

async function heldNow(log: ClaimReads & { now(): Promise<Date> }, context: ClaimContext): Promise<Map<string, Claim>> {
  return heldIn(log, (await log.now()).getTime(), context.quietMs ?? idleAfterMs(), context.restarted ?? thisRestart());
}

interface ClaimReads {
  standing(): Promise<Line[]>;
  foldLines(sessions: readonly string[], commandsSince: string): Promise<Line[]>;
  beats(sessions: readonly string[]): Promise<Map<string, Beat>>;
}

export const COMMANDS_MS = LONGEST_COMMAND_MS + 60_000;

async function heldIn(reads: ClaimReads, now: number, quietMs: number, restarted: Restart | undefined): Promise<Map<string, Claim>> {
  const claimLines = await reads.standing();
  const holders = holdersOf(claimLines);
  if (holders.length === 0) return new Map();
  const [lines, beats] = await Promise.all([reads.foldLines(holders, new Date(now - COMMANDS_MS).toISOString()), reads.beats(holders)]);
  const fold = LogFold.fromBounded(lines, claimLines);
  return new Map(fold.claims({ now: new Date(now), quietMs, beats, ...(restarted === undefined ? {} : { restarted }) })
    .map((claim) => [claim.increment ?? claim.capability, claim]));
}

type Who = Pick<ClaimContext, "session" | "harness" | "source" | "folder">;

function who(context: Who) {
  return {
    session: context.session,
    ...(context.harness === undefined ? {} : { harness: context.harness }),
    source: context.source ?? ("tool" as const),
    ...(context.folder === undefined ? {} : { folder: context.folder }),
  };
}

interface Found {
  readonly part: Part;
  readonly status?: IncrementStatus;
}

export async function isClosed(library: Library, id: string): Promise<boolean> {
  return (await partNamed(library, id))?.status === "closed";
}

async function partNamed(library: Library, id: string): Promise<Found | undefined> {
  const record = await library.get(id);
  if (record?.type === "capability") return { part: { capability: id } };
  if (record?.type === "increment") return { part: { increment: id }, status: (record as SchemaRecord<"increment">).fields.status };
  return undefined;
}

export async function increments(library: Library): Promise<SchemaRecord<"increment">[]> {
  return (await library.arcViews()).flatMap((view) => view.increments);
}

export const claimsGuidance: readonly string[] = [
  [
  "Claim, and open the knowledge you need.",
  "- `claim` the increment you drive: that starts it. `claim` a capability before you touch it; `file_owners` names each file's capability and holder. If another session holds it, or it waits on other work, nobody queues: push unfinished work to a branch named on the increment, `release` all your claims, the increment's too, and pick other work. A session manager reads `stale_claims` for claimed increments whose holder went quiet.",
  "- `name_session` names your sessions-list row, in 40 characters or fewer, once you know your work; again when it shifts. `point_at` the one capability needing the user's eye, saying why. `message_lane` steers lanes.",
  "- Only when the user asks for a separate workspace, call `make_workspace` before claiming: Claude Code gets a claimed worktree to enter. For Codex, call the desktop app’s create_worktree with the ref and name it returns, then `attach_workspace` with the folder, ref, name and your reason; attach a folder returned with a registration error rather than create another.",
  "- `open` the capability to see its shelf: the decisions that are its way into the project's knowledge, as spines. Start at the shelf, open what matches your task, and stop when you can act. `search_notes` finds the artifacts closest in meaning to a question.",
  ].join("\n"),
];
