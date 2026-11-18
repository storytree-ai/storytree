// Capability 4 · Sessions
import type { Library, Line, WriteOptions } from "@storytree/library";
import { listRuns } from "../processes/listing/index.js";

import type { ActivityLog } from "../activity/index.js";
import { endClaim } from "../claims/endings.js";
import { rememberClosedOut } from "../hooks/close-out-reminder.js";
import { partOf, standingFrom } from "../readings.js";
import { resolveBranches, type BranchWatch } from "./branch-states.js";

export interface CloseOutContext {
  readonly log: ActivityLog;
  readonly project: string;
  readonly session: string;
  readonly harness?: string;
  readonly folder?: string;
  readonly branch?: string;
  readonly library?: Library;
  readonly writer?: WriteOptions;
}

export interface CloseOutOptions {
  readonly home?: string;
  readonly look?: BranchWatch;
}

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
    const released: string[] = [];
    for (const [id, claim] of standingFrom(await log.standing())) {
      if (claim.session !== context.session) continue;
      const returning = context.library === undefined ? undefined : { library: context.library, session: context.session, ...(context.writer === undefined ? {} : { writer: context.writer }) };
      await endClaim(log, who, partOf(claim), { by: "holder" }, returning);
      released.push(id);
    }
    const line = await log.append({ ...who, kind: "closed-out", safe: said.safe, why: said.why.trim(), ...(running === undefined ? {} : { running }) });
    return { line, released };
  });
  rememberClosedOut(context.session);
  return { line, running, released };
}

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
