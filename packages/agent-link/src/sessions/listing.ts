/**
 * Capability 4 · Sessions, the listing (contract 4.13): the running-sessions list as the command
 * line shows it, one block per session, or as JSON. By default the sessions the list shows (listed
 * and done); with `all`, the hidden ones too. Given a `look`, it first asks whether each branch has
 * merged, as the board does for claims, so the list never waits on a hook to have recorded a merge.
 */
import type { ActivityLog } from "../activity/index.js";
import type { MergeContext } from "../claims/merges.js";
import type { Session, SessionOptions } from "../readings.js";
import { resolveBranches, type BranchWatch } from "./branch-states.js";
import { readSessions } from "./sessions.js";

export interface ListingOptions extends SessionOptions {
  /** Include the sessions the list hides. */
  readonly all?: boolean;
  /** The sessions as JSON, instead of text. */
  readonly json?: boolean;
  /** Who reads, and where: the project's branches are looked at first, now, whenever a hook last looked. */
  readonly look?: { readonly context: MergeContext; readonly watch?: BranchWatch };
}

/** `project`'s sessions, as text or JSON, in the order they started. */
export async function sessionsListing(log: ActivityLog, project: string, options: ListingOptions = {}): Promise<string> {
  if (options.look !== undefined) await resolveBranches(options.look.context, { ...options.look.watch, everyMs: 0 }).catch(() => []);
  const sessions = await readSessions(log, project, options);
  const shown = options.all === true ? sessions : sessions.filter((session) => session.listing !== "hidden");
  if (options.json === true) return JSON.stringify(shown, undefined, 2);
  const hidden = sessions.length - shown.length;
  const count = `${shown.length} session${shown.length === 1 ? "" : "s"}${options.all === true ? "" : " in the list"}`;
  const header = hidden === 0 ? `${count}.` : `${count}; ${hidden} hidden (--all shows them).`;
  return [header, ...shown.map(block)].join("\n\n");
}

/** One session as a few plain lines. */
function block(session: Session): string {
  const lines = [`${session.label} ${session.session}: ${session.state}, ${session.listing}`];
  if (session.name !== undefined) lines.push(`  named: ${session.name}`);
  if (session.folder !== undefined) lines.push(`  folder: ${session.folder}`);
  // A session's branches, split into those still holding open work and those resolved.
  const resolved = session.branches.filter((branch) => !session.openWork.includes(branch));
  if (session.openWork.length > 0) lines.push(`  open work: ${session.openWork.join(", ")}`);
  if (resolved.length > 0) lines.push(`  resolved: ${resolved.join(", ")}`);
  const closeOut = session.closeOut;
  if (closeOut !== undefined) {
    lines.push(`  closed out ${closeOut.at}: ${closeOut.safe ? "safe" : "not safe"} (${closeOut.why}), ${closeOut.verified ? "verified" : "not verified"}`);
    if (closeOut.needsYou !== undefined) lines.push(`  needs you: ${closeOut.needsYou}`);
  }
  if (!session.hooksRunning) lines.push("  hooks not running");
  lines.push(`  last seen ${session.lastSeenAt}`);
  return lines.join("\n");
}
