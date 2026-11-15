/**
 * Capability 3 · Hooks. A Codex pool lane takes the messages sent it while it runs (contract 3.61, Session management's 4.52), as
 * Claude Code's mod brings a Claude Code lane its own (3.60): Codex keeps no heartbeat, so its hooks mark it a lane instead. Read
 * from Codex 0.153.4's source (codex-rs/core/src/session/turn.rs, hook_runtime.rs, tools/registry.rs), `codex exec` runs the same
 * turn loop as its terminal: a sync PostToolUse hook's `additionalContext` reaches the model with the tool's result, and a Stop
 * hook's `{"decision":"block","reason"}` keeps the turn going with the reason as its next prompt. So the hook after each shell
 * command (the shell guard, which Codex waits for) takes the waiting steers, and the turn-end hook (the close-out reminder's) takes
 * the follow-ups too. A patch, which no waited-for hook follows, leaves its steers for the next command or the turn's end.
 *
 * The lane is the engine its runner started with STORYTREE_LANE_RUN set; any other session asks nothing. Like every hook this
 * never breaks the agent: on any failure it takes nothing, and a take past its time takes nothing (3.60), so no message is lost.
 */
import type { TakenAt } from "../activity/index.js";
import { approvedHere, route, type LocateOptions } from "@storytree/project-and-caller";
import { LANE_RUN } from "./close-out-reminder.js";
import { withDeadline } from "./deadlines.js";

/** How long after the hook starts its take must be answered: inside the 5 s the turn-end hook may run. */
export const LANE_TAKE_MS = 4_000;

/** Where a lane's hook reaches storytree: its routing, the home whose approved checkouts it is held to, and how long a handshake may take. */
export interface LaneReach {
  readonly locate?: LocateOptions | undefined;
  readonly home: string;
  readonly connectMs: number;
  readonly env?: NodeJS.ProcessEnv;
  /** When the hook started, ms since the epoch. */
  readonly started?: number;
}

/** The waiting messages' text for the Codex lane whose hook input is `input`, taken `at` its tool call's or turn's end; undefined outside a lane or with none. Never throws. */
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

/** Codex's answer to its PostToolUse hook `answer` (the shell guard's, or none) with the lane's steers `text` added for the model. */
export function withSteers(answer: string | undefined, text: string | undefined): string | undefined {
  if (text === undefined) return answer;
  const parsed = answer === undefined ? {} : (JSON.parse(answer) as { hookSpecificOutput?: { additionalContext?: string } });
  const said = parsed.hookSpecificOutput?.additionalContext;
  return JSON.stringify({ ...parsed, hookSpecificOutput: { ...parsed.hookSpecificOutput, hookEventName: "PostToolUse", additionalContext: said === undefined ? text : `${said}\n\n${text}` } });
}

/** Codex's answer to its Stop hook `answer` (a turn-end notice, or none) kept going with the lane's messages `text`. */
export function withFollowUps(answer: string | undefined, text: string | undefined): string | undefined {
  if (text === undefined) return answer;
  const parsed = answer === undefined ? {} : (JSON.parse(answer) as { decision?: string; reason?: string });
  return JSON.stringify({ ...parsed, decision: "block", reason: parsed.decision === "block" && parsed.reason !== undefined ? `${parsed.reason}\n\n${text}` : text });
}
