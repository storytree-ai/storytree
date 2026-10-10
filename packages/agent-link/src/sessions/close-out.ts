/**
 * Capability 4 · Sessions, close-out (ADR-0758 D2, D3): a session ends its work by recording whether
 * it is safe to close, and why: the SAFE TO CLOSE statement, as a `closed-out` line. The command,
 * not the agent, counts the session's own runs still running on this machine and records that with
 * it, so the reading can check a "yes" against it (an agent never self-attests). Given a look, it
 * first asks whether the project's branches have merged, so a yes whose pull request merged is
 * borne out whether or not a hook has looked since.
 */
import type { Library, WriteOptions } from "@storytree/library";
import { listRuns } from "@storytree/processes/listing";

import type { ActivityLog, Line } from "../activity/index.js";
import { returnUnclosed } from "../claims/claims.js";
import { rememberClosedOut } from "../hooks/close-out-reminder.js";
import { partOf, standingFrom } from "../readings.js";
import { resolveBranches, type BranchWatch } from "./branch-states.js";

/** Who is closing out, and where. */
export interface CloseOutContext {
  readonly log: ActivityLog;
  readonly project: string;
  readonly session: string;
  readonly harness?: string;
  readonly folder?: string;
  readonly branch?: string;
  /** The project's library: given, an unclosed increment whose claim this ends is a proposal again (5.29). */
  readonly library?: Library;
  readonly writer?: WriteOptions;
}

export interface CloseOutOptions {
  /** The process ledger's home; by default, the one under the storytree home. */
  readonly home?: string;
  /** Look at the project's branches first, now (GitHub's merges, git's state), so a merge no hook recorded counts. No look when absent. */
  readonly look?: BranchWatch;
}

/** Release all of this session's claims, returning its unclosed increments to proposal when given the library, and record its close-out; safety verification remains independent. */
export async function closeOut(context: CloseOutContext, said: { safe: boolean; why: string }, options: CloseOutOptions = {}): Promise<{ line: Line; running: number | undefined; released: string[] }> {
  if (options.look !== undefined && context.folder !== undefined) {
    const watcher = { log: context.log, project: context.project, folder: context.folder, session: context.session, ...(context.harness === undefined ? {} : { harness: context.harness }), source: "tool" } as const;
    await resolveBranches(watcher, { ...options.look, everyMs: 0 }).catch(() => []);
  }
  const running = await ownRunning(context, options);
  const who = {
    session: context.session,
    ...(context.harness === undefined ? {} : { harness: context.harness }),
    source: "tool" as const,
    ...(context.folder === undefined ? {} : { folder: context.folder }),
    ...(context.branch === undefined ? {} : { branch: context.branch }),
  };
  const { line, released } = await context.log.locked(context.project, async (log) => {
    // Read only standing claims, under the same lock as admission: a concurrent claim is either
    // included here or is fresh work after close-out. Never release another session's takeover.
    const released: string[] = [];
    for (const [id, claim] of standingFrom(await log.standing())) {
      if (claim.session !== context.session) continue;
      if (context.library !== undefined) await returnUnclosed({ library: context.library, session: context.session, ...(context.writer === undefined ? {} : { writer: context.writer }) }, claim.increment);
      await log.append({ ...who, kind: "released", ...partOf(claim) });
      released.push(id);
    }
    const line = await log.append({ ...who, kind: "closed-out", safe: said.safe, why: said.why.trim(), ...(running === undefined ? {} : { running }) });
    return { line, released };
  });
  // The turn-end reminder, on this machine, asks no more (ADR-0758 D4).
  rememberClosedOut(context.session);
  return { line, running, released };
}

/** The session's own runs (and their descendants) not yet gone on this machine; undefined when the reading is incomplete. */
async function ownRunning(context: CloseOutContext, options: CloseOutOptions): Promise<number | undefined> {
  try {
    const inventory = await listRuns({
      scope: "self",
      owner: { session: context.session, ...(context.harness === undefined ? {} : { harness: context.harness }) },
      ...(options.home === undefined ? {} : { home: options.home }),
    });
    return inventory.complete ? inventory.rows.filter((row) => row.process.state !== "gone").length : undefined;
  } catch {
    return undefined;
  }
}
