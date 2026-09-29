/**
 * Capability 4 · Sessions, close-out (ADR-0758 D2, D3): a session ends its work by recording whether
 * it is safe to close, and why: the SAFE TO CLOSE statement, as a `closed-out` line. The command,
 * not the agent, counts the session's own runs still running on this machine and records that with
 * it, so the reading can check a "yes" against it (an agent never self-attests).
 */
import { listRuns } from "@storytree/processes/listing";

import type { ActivityLog, Line } from "../activity/index.js";

/** Who is closing out, and where. */
export interface CloseOutContext {
  readonly log: ActivityLog;
  readonly project: string;
  readonly session: string;
  readonly harness?: string;
  readonly folder?: string;
  readonly branch?: string;
}

export interface CloseOutOptions {
  /** The process ledger's home; by default, the one under the storytree home. */
  readonly home?: string;
}

/** Record `session`'s close-out, with how many of its own runs still run here, when the ledger could be read in full. */
export async function closeOut(context: CloseOutContext, said: { safe: boolean; why: string }, options: CloseOutOptions = {}): Promise<{ line: Line; running: number | undefined }> {
  const running = await ownRunning(context, options);
  const line = await context.log.append(context.project, {
    session: context.session,
    ...(context.harness === undefined ? {} : { harness: context.harness }),
    source: "tool",
    ...(context.folder === undefined ? {} : { folder: context.folder }),
    ...(context.branch === undefined ? {} : { branch: context.branch }),
    kind: "closed-out",
    safe: said.safe,
    why: said.why.trim(),
    ...(running === undefined ? {} : { running }),
  });
  return { line, running };
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
