/**
 * Capability 5 · Claims (stories/agent-link.md): before building a capability, the agent claims it
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
 * - A claim also ends when a pull request from the branch it was taken on merges after it was
 *   taken (ADR-0643 D3): a "merged" line, which merges.ts writes when GitHub shows one.
 * - Claims work on trust: storytree refuses a second claim, but cannot stop an agent that never asks.
 */
import type { Library } from "@storytree/library";

import type { ActivityLog, Line, LockedLog } from "../activity/index.js";
import { COMMAND_KINDS, commandRunning, labelOf, QUIET_MS } from "../sessions/index.js";

/** A capability held by a session, as the log shows it. */
export interface Claim {
  capability: string;
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
  | { ok: true; claim: Claim; takenOverFrom?: Claim }
  | { ok: false; refused: "held"; holder: Claim }
  | { ok: false; refused: "unknown-capability"; capability: string };

export type ReleaseAnswer = { ok: true } | { ok: false; refused: "not-held"; holder?: Claim };

export type LandAnswer =
  | { ok: true; line: Line }
  | { ok: false; refused: "held"; holder: Claim }
  | { ok: false; refused: "unknown-capability"; capability: string };

/** An edit or command, and the capability it counts toward: undefined for unplanned activity. */
export interface Attributed {
  line: Line;
  capability: string | undefined;
}

export interface ClaimsOptions {
  /** The time to judge holders' liveness by. By default, now. */
  readonly now?: Date;
  /** How long a holder may be quiet before it reads as idle. By default, sessions' quiet time. */
  readonly quietMs?: number;
}

/** The kinds of line that decide who holds what. */
const CLAIM_KINDS = ["claimed", "released", "landed", "merged", "session-ended"] as const;

/**
 * Claim `capability` for the context's session, with a one-line reason. Refused if the library has
 * no such capability, or another live session holds it; a holder idle past the quiet time is taken
 * over. Claiming one it already holds changes nothing.
 */
export async function claim(context: ClaimContext, capability: string, reason: string): Promise<ClaimAnswer> {
  if (!(await capabilityExists(context.library, capability))) return { ok: false, refused: "unknown-capability", capability };
  return context.log.locked(context.project, async (log) => {
    const current = (await heldNow(log, context)).get(capability);
    if (current?.session === context.session) return { ok: true, claim: current };
    if (current?.holder === "live") return { ok: false, refused: "held", holder: current };
    const line = await log.append({
      ...who(context),
      kind: "claimed",
      capability,
      reason,
      ...(current === undefined ? {} : { takenOverFrom: current.session }),
      ...(context.branch === undefined ? {} : { branch: context.branch }),
    });
    const claimed: Claim = { ...claimOf(line.session, line.harness, capability, reason, line.at, context.branch), holder: "live" };
    return current === undefined ? { ok: true, claim: claimed } : { ok: true, claim: claimed, takenOverFrom: current };
  });
}

/** Release `capability`, if the context's session holds it. */
export async function release(context: ClaimContext, capability: string): Promise<ReleaseAnswer> {
  return context.log.locked(context.project, async (log) => {
    const current = (await heldNow(log, context)).get(capability);
    if (current?.session !== context.session) return current === undefined ? { ok: false, refused: "not-held" } : { ok: false, refused: "not-held", holder: current };
    await log.append({ ...who(context), kind: "released", capability });
    return { ok: true };
  });
}

/**
 * Report `capability` landed: write the "landed" line, which ends the context's session's claim on
 * it. Refused if the library has no such capability, or another session holds it.
 */
export async function land(context: ClaimContext, capability: string): Promise<LandAnswer> {
  if (!(await capabilityExists(context.library, capability))) return { ok: false, refused: "unknown-capability", capability };
  return context.log.locked(context.project, async (log) => {
    const current = (await heldNow(log, context)).get(capability);
    if (current !== undefined && current.session !== context.session) return { ok: false, refused: "held", holder: current };
    return { ok: true, line: await log.append({ ...who(context), kind: "landed", capability }) };
  });
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

/** Every edit and command in `lines`, with the capability it counts toward, or undefined for unplanned activity. */
export function attributeFrom(lines: readonly Line[]): Attributed[] {
  const holding = new Map<string, string[]>(); // session → the capabilities it holds, in the order claimed
  const drop = (session: string, capability: string) => {
    const held = holding.get(session);
    if (held !== undefined) holding.set(session, held.filter((other) => other !== capability));
  };
  const attributed: Attributed[] = [];
  for (const line of [...lines].sort((a, b) => a.seq - b.seq)) {
    switch (line.kind) {
      case "claimed":
        for (const session of holding.keys()) drop(session, line.capability); // taken over, if it was held
        holding.set(line.session, [...(holding.get(line.session) ?? []), line.capability]);
        break;
      case "released":
      case "landed":
        drop(line.session, line.capability);
        break;
      case "merged":
        drop(line.holder, line.capability);
        break;
      case "session-ended":
        holding.delete(line.session);
        break;
      case "file-edited":
      case "command-run":
        attributed.push({ line, capability: holding.get(line.session)?.at(-1) });
        break;
    }
  }
  return attributed;
}

/** Every edit and command in `project`'s log, with the capability it counts toward. */
export async function readAttribution(log: ActivityLog, project: string): Promise<Attributed[]> {
  return attributeFrom((await log.since(project, 0)).lines);
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

/** The claims standing after `claimLines`, by capability, each holder judged by when its session last wrote and whether a command of its is running. */
function held(claimLines: readonly Line[], lastSeen: ReadonlyMap<string, string>, running: ReadonlySet<string>, now: number, quietMs: number): Map<string, Claim> {
  const holders = new Map<string, Omit<Claim, "holder">>();
  for (const line of claimLines) {
    switch (line.kind) {
      case "claimed":
        holders.set(line.capability, claimOf(line.session, line.harness, line.capability, line.reason, line.at, line.branch));
        break;
      case "released":
      case "landed":
        if (holders.get(line.capability)?.session === line.session) holders.delete(line.capability);
        break;
      case "merged":
        if (holders.get(line.capability)?.session === line.holder) holders.delete(line.capability);
        break;
      case "session-ended":
        for (const [capability, holder] of holders) if (holder.session === line.session) holders.delete(capability);
        break;
    }
  }
  const claims = new Map<string, Claim>();
  for (const [capability, holder] of holders) {
    const quiet = now - Date.parse(lastSeen.get(holder.session) ?? holder.since);
    claims.set(capability, { ...holder, holder: quiet > quietMs && !running.has(holder.session) ? "idle" : "live" });
  }
  return claims;
}

function claimOf(session: string, harness: string | undefined, capability: string, reason: string, since: string, branch: string | undefined): Omit<Claim, "holder"> {
  return { capability, session, ...(harness === undefined ? {} : { harness }), label: labelOf(harness), reason, since, ...(branch === undefined ? {} : { branch }) };
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

/** Whether the project's library has a live capability `id`. */
async function capabilityExists(library: Library, id: string): Promise<boolean> {
  const { stories } = await library.projectTree();
  return stories.some((story) => story.capabilities.some((capability) => capability.id === id));
}
