// Capability 4 · Sessions
import type { ActivityLog } from "../activity/index.js";
import type { MergeContext } from "../claims/merges.js";
import type { Session, SessionOptions } from "../readings.js";
import { resolveBranches, type BranchWatch } from "./branch-states.js";
import { readSessions } from "./sessions.js";

export interface ListingOptions extends SessionOptions {
  readonly all?: boolean;
  readonly json?: boolean;
  readonly look?: { readonly context: MergeContext; readonly watch?: BranchWatch };
  readonly names?: ReadonlyMap<string, string>;
}

export async function sessionsListing(log: ActivityLog, project: string, options: ListingOptions = {}): Promise<string> {
  if (options.look !== undefined) await resolveBranches(options.look.context, { ...options.look.watch, everyMs: 0 }).catch(() => []);
  const sessions = await readSessions(log, project, { ...options, of: options.all === true ? "all" : "in-view" });
  const shown = options.all === true ? sessions : sessions.filter((session) => session.listing !== "hidden");
  if (options.json === true) return JSON.stringify(shown, undefined, 2);
  const hidden = (options.all === true ? sessions.length : await log.sessionCount(project)) - shown.length;
  const count = `${shown.length} session${shown.length === 1 ? "" : "s"}${options.all === true ? "" : " in the list"}`;
  const header = hidden === 0 ? `${count}.` : `${count}; ${hidden} hidden (--all shows them).`;
  return [header, ...shown.map((session) => block(session, options.names))].join("\n\n");
}

export async function sessionShown(log: ActivityLog, project: string, id: string, options: Omit<ListingOptions, "all"> = {}): Promise<string | undefined> {
  if (options.look !== undefined) await resolveBranches(options.look.context, { ...options.look.watch, everyMs: 0 }).catch(() => []);
  const [session] = (await readSessions(log, project, { ...options, of: [id] })).filter((one) => one.session === id);
  if (session === undefined) return undefined;
  return options.json === true ? JSON.stringify(session, undefined, 2) : block(session, options.names);
}

function block(session: Session, names?: ReadonlyMap<string, string>): string {
  const lines = [`${session.label} ${session.session}: ${session.state}, ${session.listing}`];
  if (session.name !== undefined) lines.push(`  named: ${session.name}`);
  if (session.machine !== undefined) lines.push(`  machine: ${names?.get(session.machine) ?? session.machine}`);
  if (session.folder !== undefined) lines.push(`  folder: ${session.folder}`);
  const resolved = session.branches.filter((branch) => !session.openWork.includes(branch));
  if (session.openWork.length > 0) lines.push(`  open work: ${session.openWork.join(", ")}`);
  if (resolved.length > 0) lines.push(`  resolved: ${resolved.join(", ")}`);
  const closeOut = session.closeOut;
  if (closeOut !== undefined) {
    lines.push(`  closed out ${closeOut.at}: ${closeOut.safe ? "safe" : "not safe"} (${closeOut.why}), ${closeOut.verified ? "verified" : "not verified"}`);
    if (closeOut.needsYou !== undefined) lines.push(`  needs you: ${closeOut.needsYou}`);
  }
  if (session.tier === "connected") lines.push("  connected, not watched: storytree sees only its tool calls and commands");
  else if (!session.hooksRunning) lines.push("  hooks not running");
  lines.push(`  last seen ${session.lastSeenAt}`);
  return lines.join("\n");
}
