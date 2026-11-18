// Capability 5 · Claims
import type { ActivityLog } from "../activity/index.js";
import { holdersOf, isMainBranch, LogFold, type Claim, type Restart } from "../readings.js";
import { idleAfterMs } from "@storytree/project-and-caller";
import { COMMANDS_MS, thisRestart } from "./claims.js";
import { ghAllOpenPulls, type AllOpenPulls, type OpenPull } from "./merges.js";

export interface StaleClaim {
  readonly increment: string;
  readonly holder: string;
  readonly label: string;
  readonly reason: string;
  readonly since: string;
  readonly branch?: string;
  readonly lastSeenAt: string;
  readonly route: "release" | "ask";
  readonly ended?: true;
}

export interface StaleWorklist {
  readonly claims: StaleClaim[];
  readonly pullsUnread?: true;
}

export interface StaleOptions {
  readonly now?: Date;
  readonly quietMs?: number;
  readonly restarted?: Restart;
  readonly allOpenPulls?: AllOpenPulls;
}

export async function staleClaims(context: { readonly log: ActivityLog; readonly project: string; readonly folder: string }, options: StaleOptions = {}): Promise<StaleWorklist> {
  const { log, project } = context;
  const now = options.now ?? new Date();
  const quietMs = options.quietMs ?? idleAfterMs();
  const claimLines = await log.standing(project);
  const holders = holdersOf(claimLines);
  if (holders.length === 0) return { claims: [] };
  const [lines, beats] = await Promise.all([log.foldLines(project, holders, new Date(now.getTime() - COMMANDS_MS).toISOString()), log.beats.of(project, holders)]);
  const fold = LogFold.fromBounded(lines, claimLines);
  const restarted = options.restarted ?? thisRestart();
  const quiet = fold.claims({ now, quietMs, beats, ...(restarted === undefined ? {} : { restarted }) })
    .filter((claim): claim is Claim & { increment: string } => claim.increment !== undefined && claim.holder === "idle");
  if (quiet.length === 0) return { claims: [] };
  const sessions = new Map(fold.sessions({ now }).map((session) => [session.session, session]));
  const branchesOf = (claim: Claim): readonly string[] =>
    claim.branch !== undefined && !isMainBranch(claim.branch) ? [claim.branch] : sessions.get(claim.session)?.branches ?? [];
  const pulls: ReadonlyMap<string, OpenPull> | undefined = quiet.some((claim) => claim.branch !== undefined || branchesOf(claim).length > 0)
    ? await (options.allOpenPulls ?? ghAllOpenPulls)(context.folder).catch(() => undefined)
    : new Map();
  const claims = quiet
    .filter((claim) => !branchesOf(claim).some((branch) => pulls?.has(branch)))
    .map((claim): StaleClaim => {
      const session = sessions.get(claim.session);
      const gone = session?.state === "gone" || session?.closeOut?.verified === true;
      const ended = !gone && claim.quiet?.because === "stopped" && now.getTime() - Date.parse(claim.quiet.since) > quietMs;
      return {
        increment: claim.increment,
        holder: claim.session,
        label: claim.label,
        reason: claim.reason,
        since: claim.since,
        ...(claim.branch === undefined ? {} : { branch: claim.branch }),
        lastSeenAt: session?.lastSeenAt ?? claim.since,
        route: gone || ended ? "release" : "ask",
        ...(ended ? { ended: true as const } : {}),
      };
    })
    .sort((a, b) => a.since.localeCompare(b.since));
  return pulls === undefined ? { claims, pullsUnread: true } : { claims };
}
