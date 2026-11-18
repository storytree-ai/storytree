// Capability 3 · Hooks
import type { TakenAt } from "../activity/index.js";
import { approvedHere, route, type LocateOptions } from "@storytree/project-and-caller";
import { LANE_RUN } from "./close-out-reminder.js";
import { withDeadline } from "./deadlines.js";

export const LANE_TAKE_MS = 4_000;

export interface LaneReach {
  readonly locate?: LocateOptions | undefined;
  readonly home: string;
  readonly connectMs: number;
  readonly env?: NodeJS.ProcessEnv;
  readonly started?: number;
}

export async function codexLaneMessages(harness: string, input: unknown, at: TakenAt, { locate, home, connectMs, env = process.env, started = Date.now() }: LaneReach): Promise<string | undefined> {
  if (harness !== "codex" || !env[LANE_RUN] || typeof input !== "object" || input === null) return undefined;
  const { session_id: session, cwd: folder } = input as Record<string, unknown>;
  if (typeof session !== "string" || session === "" || typeof folder !== "string" || folder === "") return undefined;
  try {
    const where = route(folder, locate);
    if (where.status !== "routed" || !approvedHere(where.project, folder, home)) return undefined;
    const [{ openActivityLog }, { connect }, { deliveryText }] = await Promise.all([import("../activity/index.js"), import("@storytree/library"), import("../sessions/message-lane.js")]);
    const storytree = await connect(withDeadline(where.library, connectMs));
    try {
      const log = await openActivityLog(storytree, { connectTimeoutMs: connectMs });
      try {
        await log.messages.mark(where.project, session);
        const text = deliveryText(await log.messages.take(where.project, session, at, started + LANE_TAKE_MS));
        return text === "" ? undefined : text;
      } finally {
        await log.close();
      }
    } finally {
      await storytree.close();
    }
  } catch {
    return undefined;
  }
}

export function withSteers(answer: string | undefined, text: string | undefined): string | undefined {
  if (text === undefined) return answer;
  const parsed = answer === undefined ? {} : (JSON.parse(answer) as { hookSpecificOutput?: { additionalContext?: string } });
  const said = parsed.hookSpecificOutput?.additionalContext;
  return JSON.stringify({ ...parsed, hookSpecificOutput: { ...parsed.hookSpecificOutput, hookEventName: "PostToolUse", additionalContext: said === undefined ? text : `${said}\n\n${text}` } });
}

export function withFollowUps(answer: string | undefined, text: string | undefined): string | undefined {
  if (text === undefined) return answer;
  const parsed = answer === undefined ? {} : (JSON.parse(answer) as { decision?: string; reason?: string });
  return JSON.stringify({ ...parsed, decision: "block", reason: parsed.decision === "block" && parsed.reason !== undefined ? `${parsed.reason}\n\n${text}` : text });
}
