// Capability 3 · Hooks
import path from "node:path";

import type { ConnectOptions, Line } from "@storytree/library";
import { printable } from "@storytree/library/printable";

import { openNamedProject, requireApproval, route } from "@storytree/project-and-caller";
import { idleAfterMs } from "@storytree/project-and-caller";
import { withDeadline } from "./deadlines.js";

const WAIT_MS = 2_000;

export async function statusLine(input: string): Promise<string> {
  try {
    const { session, folder } = sessionIn(JSON.parse(input));
    if (session === undefined || folder === undefined) return "";
    const where = route(folder);
    if (where.status === "not-a-project") return "";
    if (where.status === "not-running") return "storytree isn't running";
    return printable((await withinTime(lineFor(where.library, where.project, session, folder, where.identity, where.folder))) ?? "");
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

async function lineFor(where: ConnectOptions, project: string, session: string, folder: string, identity: string | undefined, checkout: string): Promise<string> {
  const [{ openActivityLog }, { connect }, { readClaims }, { readSessionStates }] = await Promise.all([
    import("../activity/index.js"),
    import("@storytree/library"),
    import("../claims/index.js"),
    import("../sessions/index.js"),
  ]);
  const storytree = await connect(withDeadline(where, WAIT_MS));
  await requireApproval(storytree, project, checkout).catch(async (error: unknown) => {
    await storytree.close();
    throw error;
  });
  const log = await openActivityLog(storytree, { connectTimeoutMs: WAIT_MS });
  try {
    const now = Date.now();
    const quietMs = idleAfterMs();
    const [claims, states] = await Promise.all([readClaims(log, project, { now: new Date(now), quietMs }), readSessionStates(log, project, { now: new Date(now), quietMs })]);
    const held = claims.filter((claim) => claim.session === session);
    const others = states.filter((other) => other.session !== session && other.state === "working");
    const titles = new Map<string, string>();
    if (held.length > 0) {
      const library = await openNamedProject(storytree, project, identity);
      for (const id of held.map((claim) => claim.capability ?? claim.increment)) {
        const fields = (await library.get(id))?.fields as { title?: unknown } | undefined;
        if (typeof fields?.title === "string") titles.set(id, fields.title);
      }
    }
    const parts = [
      "storytree",
      held.length === 0 ? "holds nothing" : `holds ${held.map((claim) => titles.get(claim.capability ?? claim.increment) ?? claim.capability ?? claim.increment).join(", ")}`,
      others.length === 0 ? "no other agents working" : `${others.length} other agent${others.length === 1 ? "" : "s"} working`,
    ];
    const edits = others.length === 0 ? [] : await log.lines(project, {
      kinds: ["file-edited"], sessions: [session, ...others.map((other) => other.session)], since: new Date(now - quietMs).toISOString(), omit: ["transcript"],
    });
    const shared = sharedFile(edits, session, new Set(others.map((other) => other.session)), now - quietMs);
    if (shared !== undefined) parts.push(`⚠ ${shown(shared.file, folder)} is being edited by ${shared.label} too`);
    return parts.join(" · ");
  } finally {
    await Promise.allSettled([log.close(), storytree.close()]);
  }
}

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

function key(file: string, folder: string | undefined): string {
  const absolute = folder === undefined ? path.resolve(file) : path.resolve(folder, file);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

function shown(file: string, folder: string): string {
  const relative = path.relative(path.resolve(folder), file);
  return (relative.startsWith("..") || path.isAbsolute(relative) ? file : relative).split(path.sep).join("/");
}

function withinTime<T>(work: Promise<T>): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<undefined>((resolve) => (timer = setTimeout(() => resolve(undefined), WAIT_MS)));
  return Promise.race([work.catch(() => undefined), late]).finally(() => clearTimeout(timer));
}
