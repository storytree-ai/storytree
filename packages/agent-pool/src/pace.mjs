// Capability 3 · The dispatcher's pace (ADR-1056 D3): it reads the rate-limit windows the lanes' Claude Code mod reports,
// and slows or pauses dispatch while the lanes near a limit, resuming when the window resets. Lanes without readings dispatch as before.
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { pickEngine, readLatestAllowance } from "./engine.mjs";
import { withLibrary } from "./feed.mjs";

const iso = (ms) => new Date(ms).toISOString().replace(/:\d{2}\.\d{3}Z$/, "Z");

/**
 * The pace the lanes' readings call for (each a session's latest reported `usage` and `failed` turn, context.ts's reportedUsageOf):
 * the latest reading of each rate-limit window, a failed turn that names a window putting it at 100% from then; a window
 * whose reset has passed, or with no reset that has gone unread for `staleMs`, no longer counts. Any window at `pauseAt`
 * or more pauses dispatch until the last of those resets; at `slowAt` or more it slows; otherwise, and with no readings, undefined.
 */
export function paceOf(readings, { now, slowAt = 80, pauseAt = 95, staleMs = 60 * 60_000 }) {
  const windows = new Map();
  for (const { usage } of readings) {
    if (!usage) continue;
    const at = Date.parse(usage.at);
    for (const limit of usage.rateLimits) if (!(windows.get(limit.kind)?.at >= at)) windows.set(limit.kind, { ...limit, at });
  }
  for (const { failed } of readings) {
    const at = Date.parse(failed?.at);
    for (const kind of failed?.limits ?? []) {
      const seen = windows.get(kind);
      if (seen?.at >= at) continue;
      const resetsAt = seen?.resetsAt && Date.parse(seen.resetsAt) > at ? seen.resetsAt : undefined;
      windows.set(kind, { kind, percentUsed: 100, ...(resetsAt ? { resetsAt } : {}), at });
    }
  }
  const live = [...windows.values()].filter((one) => (one.resetsAt ? Date.parse(one.resetsAt) > now : now - one.at < staleMs));
  const said = (some) => some.map((one) => `${one.kind} ${Math.round(one.percentUsed)}% used${one.resetsAt ? ` (resets ${iso(Date.parse(one.resetsAt))})` : ""}`).join(", ");
  const full = live.filter((one) => one.percentUsed >= pauseAt);
  if (full.length) {
    const resets = full.map((one) => Date.parse(one.resetsAt)).filter(Number.isFinite);
    const until = resets.length === full.length ? Math.max(...resets) : undefined;
    return { hold: "pause", windows: full.map((one) => one.kind), ...(until ? { until } : {}),
      reason: `Claude's ${said(full)}: no new lane ${until ? `until ${iso(until)}` : "until a fresh reading is lower"}` };
  }
  const near = live.filter((one) => one.percentUsed >= slowAt);
  if (near.length) return { hold: "slow", windows: near.map((one) => one.kind), reason: `Claude's ${said(near)}: half the cap` };
  return undefined;
}

/** The session ids the lanes' mod wrote beside their logs (runner.mjs's `<log>.session`), the `newest` most recently written. */
export async function laneSessions(lanesDir, { newest = 8 } = {}) {
  const names = (await readdir(lanesDir).catch(() => [])).filter((name) => name.endsWith(".session"));
  const dated = await Promise.all(names.map(async (name) => ({ name, at: (await stat(join(lanesDir, name)).catch(() => undefined))?.mtimeMs ?? 0 })));
  const ids = await Promise.all(dated.sort((a, b) => b.at - a.at).slice(0, newest).map(async ({ name }) => (await readFile(join(lanesDir, name), "utf8").catch(() => "")).trim()));
  return [...new Set(ids.filter(Boolean))];
}

/** Each of `sessions`' latest reported usage and failed turn, from the shared library. */
async function libraryUsage(sessions, project) {
  const { openActivityLog, reportedUsageOf } = await import("@storytree/session-management");
  return withLibrary(project, async (_library, storytree) => reportedUsageOf(await openActivityLog(storytree), project, sessions));
}

/**
 * The dispatcher's pace now: paceOf over the newest lanes' readings while the next lane would run Claude Code; a Codex lane
 * spends Codex's allowance, which the lane runner guards, so it is never held back by Claude's windows.
 */
export async function readLanePace({ lanesDir, sessionsDir, stopAt, now = Date.now, project = "storytree", usageOf = libraryUsage,
  nextEngine = async () => pickEngine({ lanesDir, reading: await readLatestAllowance(sessionsDir), now: now() / 1000, stopAt }) }) {
  const sessions = await laneSessions(lanesDir);
  if (!sessions.length || (await nextEngine()).engine !== "claude") return undefined;
  return paceOf([...(await usageOf(sessions, project)).values()], { now: now() });
}
