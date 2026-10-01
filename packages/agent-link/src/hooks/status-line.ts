/**
 * The status line (ADR-0636 D1, b3; 0.2's `presence-hook.sh statusline`, ported by behaviour): one
 * line in a Claude Code window saying what storytree sees of this session. Claude Code runs it as a
 * command, with the session's id and folder on stdin, and shows what it prints.
 *
 * It reads: `storytree · holds Email form · 2 other agents working · ⚠ src/signup.ts is being edited
 * by Codex too`.
 * - What this session holds: its claims, by capability title (capability 5).
 * - How many other agents are working: the project's other live sessions (capability 4).
 * - The warning: a file this session edited within the quiet time that another live session has
 *   edited within it too. 0.2 warned when two sessions claimed one unit; in 0.3 a capability has one
 *   holder, so two agents meet in a file instead.
 * - `storytree isn't running` in a project while it is stopped, and nothing at all outside a project,
 *   since Claude Code shows the same status line in every folder.
 *
 * Claude Code has room for one status line, so the setup check installs this one only where the
 * user has none of their own (hooks-config.ts). Codex's status line shows only its own items.
 */
import path from "node:path";

import type { ConnectOptions } from "@storytree/library";

import type { Line } from "../activity/index.js";
import { openNamedProject, route, withConnectTimeout } from "../routing/index.js";
import { idleAfterMs } from "../settings/settings.js";

/** How long the status line waits for storytree before showing nothing. */
const WAIT_MS = 2_000;

/** The status line for a Claude Code status line input, or "" to show nothing. Never throws. */
export async function statusLine(input: string): Promise<string> {
  try {
    const { session, folder } = sessionIn(JSON.parse(input));
    if (session === undefined || folder === undefined) return "";
    const where = route(folder);
    if (where.status === "not-a-project") return "";
    if (where.status === "not-running") return "storytree isn't running";
    return (await withinTime(lineFor(where.library, where.project, session, folder))) ?? "";
  } catch {
    return "";
  }
}

function sessionIn(input: unknown): { session?: string; folder?: string } {
  if (typeof input !== "object" || input === null) return {};
  const { session_id: session, cwd, workspace } = input as Record<string, unknown>;
  const current = typeof workspace === "object" && workspace !== null ? (workspace as Record<string, unknown>).current_dir : undefined;
  const folder = typeof current === "string" && current !== "" ? current : typeof cwd === "string" && cwd !== "" ? cwd : undefined;
  return { ...(typeof session === "string" && session !== "" ? { session } : {}), ...(folder === undefined ? {} : { folder }) };
}

async function lineFor(where: ConnectOptions, project: string, session: string, folder: string): Promise<string> {
  const [{ openActivityLog }, { connect }, { claimsFrom, increments }, { sessionsFrom }] = await Promise.all([
    import("../activity/index.js"),
    import("@storytree/library"),
    import("../claims/index.js"),
    import("../sessions/index.js"),
  ]);
  const storytree = await connect(withConnectTimeout(where, WAIT_MS));
  const log = await openActivityLog(storytree, { connectTimeoutMs: WAIT_MS });
  try {
    const [{ lines }, library] = await Promise.all([log.since(project, 0), openNamedProject(storytree, project)]);
    const now = Date.now();
    const quietMs = idleAfterMs();
    const titles = new Map<string, string>();
    const [tree, live] = await Promise.all([library.projectTree(), increments(library)]);
    for (const story of tree.stories) for (const capability of story.capabilities) titles.set(capability.id, capability.title);
    for (const increment of live) titles.set(increment.id, increment.fields.title);

    const held = claimsFrom(lines, { now: new Date(now), quietMs }).filter((claim) => claim.session === session);
    const others = sessionsFrom(lines, { now: new Date(now), quietMs }).filter((other) => other.session !== session && other.state === "working");
    const parts = [
      "storytree",
      held.length === 0 ? "holds nothing" : `holds ${held.map((claim) => titles.get(claim.capability ?? claim.increment) ?? claim.capability ?? claim.increment).join(", ")}`,
      others.length === 0 ? "no other agents working" : `${others.length} other agent${others.length === 1 ? "" : "s"} working`,
    ];
    const shared = sharedFile(lines, session, new Set(others.map((other) => other.session)), now - quietMs);
    if (shared !== undefined) parts.push(`⚠ ${shown(shared.file, folder)} is being edited by ${shared.label} too`);
    return parts.join(" · ");
  } finally {
    await Promise.allSettled([log.close(), storytree.close()]);
  }
}

/** A file `session` edited since `since` that one of the `others` edited since then too, with who. */
function sharedFile(lines: readonly Line[], session: string, others: ReadonlySet<string>, since: number): { file: string; label: string } | undefined {
  const recent = lines.filter((line): line is Extract<Line, { kind: "file-edited" }> => line.kind === "file-edited" && Date.parse(line.at) >= since);
  const mine = new Set(recent.filter((line) => line.session === session).flatMap((line) => line.files.map((file) => key(file, line.folder))));
  for (const line of recent) {
    if (!others.has(line.session)) continue;
    const one = line.files.find((named) => mine.has(key(named, line.folder)));
    const file = one === undefined ? undefined : line.folder === undefined ? path.resolve(one) : path.resolve(line.folder, one);
    if (file !== undefined) return { file, label: line.harness === "codex" ? "Codex" : line.harness === "claude-code" ? "Claude Code" : "another agent" };
  }
  return undefined;
}

/** A file as one path whoever named it: absolute, and in one case on Windows, whose paths ignore case. */
function key(file: string, folder: string | undefined): string {
  const absolute = folder === undefined ? path.resolve(file) : path.resolve(folder, file);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

/** A file as the status line shows it: relative to the session's folder when inside it, with `/`. */
function shown(file: string, folder: string): string {
  const relative = path.relative(path.resolve(folder), file);
  return (relative.startsWith("..") || path.isAbsolute(relative) ? file : relative).split(path.sep).join("/");
}

function withinTime<T>(work: Promise<T>): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<undefined>((resolve) => (timer = setTimeout(() => resolve(undefined), WAIT_MS)));
  return Promise.race([work.catch(() => undefined), late]).finally(() => clearTimeout(timer));
}
