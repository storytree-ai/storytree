/**
 * Capability 5 · Claims. The session manager's one stale-claim worklist (ADR-0953 D4): the claimed increments
 * whose holder is quiet, with no command still running and no open pull request from the claim's branch, each
 * with its route. A holder that reads gone (no line for longer than a command may run, ADR-0754 D5), or whose
 * safe close-out is verified, is routed to release, through the manager's release (releaseFor, ADR-0944 D7); one
 * only quiet is routed to ask the holder first. Reading the worklist ends nothing: it replaces the hooks ending
 * gone holders' claims themselves (ADR-0944 D6, retired). Release on merge, the restart ending and idle takeover
 * stand beside it (ADR-0953 D1, D2).
 */
import type { ActivityLog } from "../activity/index.js";
import { held, LogFold, type Claim, type Restart } from "../readings.js";
import { idleAfterMs } from "../settings/settings.js";
import { COMMANDS_MS, thisRestart } from "./claims.js";
import { ghAllOpenPulls, type AllOpenPulls, type OpenPull } from "./merges.js";

/** One claimed increment the session manager should move, and how. */
export interface StaleClaim {
  readonly increment: string;
  /** The holding session. */
  readonly holder: string;
  /** Its harness as people call it. */
  readonly label: string;
  readonly reason: string;
  /** When it was claimed. */
  readonly since: string;
  readonly branch?: string;
  /** When the holder's latest line was written. */
  readonly lastSeenAt: string;
  /** release: the holder is gone, so the manager releases it; ask: the holder is only quiet, so the manager asks it first. */
  readonly route: "release" | "ask";
}

export interface StaleWorklist {
  /** Oldest claim first. */
  readonly claims: StaleClaim[];
  /** GitHub could not be asked which pull requests are open: no claim was left off for one, so check before releasing. */
  readonly pullsUnread?: true;
}

export interface StaleOptions {
  /** The time to judge holders by. By default, now. */
  readonly now?: Date;
  /** How long a holder may be quiet before it reads idle. By default, the current idle-after setting. */
  readonly quietMs?: number;
  readonly restarted?: Restart;
  /** How to ask GitHub which pull requests are open. By default, through `gh`. */
  readonly allOpenPulls?: AllOpenPulls;
}

/** The stale-claim worklist of `project`, asked of GitHub from `folder`. It only reads: no line is written. */
export async function staleClaims(context: { readonly log: ActivityLog; readonly project: string; readonly folder: string }, options: StaleOptions = {}): Promise<StaleWorklist> {
  const { log, project } = context;
  const now = options.now ?? new Date();
  const claimLines = await log.standing(project);
  const holders = [...new Set([...held(claimLines, new Map(), new Set(), now.getTime(), Infinity).values()].map((claim) => claim.session))];
  if (holders.length === 0) return { claims: [] };
  const fold = LogFold.fromBounded(await log.foldLines(project, holders, new Date(now.getTime() - COMMANDS_MS).toISOString()), claimLines);
  const restarted = options.restarted ?? thisRestart();
  const quiet = fold.claims({ now, quietMs: options.quietMs ?? idleAfterMs(), ...(restarted === undefined ? {} : { restarted }) })
    .filter((claim): claim is Claim & { increment: string } => claim.increment !== undefined && claim.holder === "idle");
  if (quiet.length === 0) return { claims: [] };
  // GitHub is asked only when a quiet claim names a branch a pull request could come from.
  const pulls: ReadonlyMap<string, OpenPull> | undefined = quiet.some((claim) => claim.branch !== undefined)
    ? await (options.allOpenPulls ?? ghAllOpenPulls)(context.folder).catch(() => undefined)
    : new Map();
  const sessions = new Map(fold.sessions({ now }).map((session) => [session.session, session]));
  const claims = quiet
    .filter((claim) => claim.branch === undefined || !pulls?.has(claim.branch))
    .map((claim): StaleClaim => {
      const session = sessions.get(claim.session);
      const gone = session?.state === "gone" || session?.closeOut?.verified === true;
      return {
        increment: claim.increment,
        holder: claim.session,
        label: claim.label,
        reason: claim.reason,
        since: claim.since,
        ...(claim.branch === undefined ? {} : { branch: claim.branch }),
        lastSeenAt: session?.lastSeenAt ?? claim.since,
        route: gone ? "release" : "ask",
      };
    })
    .sort((a, b) => a.since.localeCompare(b.since));
  return pulls === undefined ? { claims, pullsUnread: true } : { claims };
}
