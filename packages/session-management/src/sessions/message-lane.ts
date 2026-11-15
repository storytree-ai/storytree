/**
 * Capability 4 · Sessions. Contracts 4.49 to 4.51 (increment_783a63fe5b16, after Pi Durable's message modes): the owner, or a
 * storytree session acting for him, sends a running pool lane a message without stopping it. The lane is the session holding
 * the increment's claim, and it must beat as a live lane (its engine's mod says so), or, for an engine that keeps no heartbeat
 * (Codex), be marked a lane by its hooks and live by its claim and its lines (4.52). A steer joins the work after the lane's
 * current tool call, a follow-up starts more work when it would end its turn (both queued for its hooks, activity/lane-messages.ts),
 * and a note is written on the increment, the model not asked. Lanes run with permissions bypassed, so a session that has read
 * outside text may not send ("Outside text is data"): words from an issue or an email never reach an unattended lane through it.
 */
import type { Library, WriteOptions } from "@storytree/library";

import type { ActivityLog, LaneMessage } from "../activity/index.js";
import { readClaim } from "../claims/claims.js";
import { outsideTextReads } from "../hooks/outside-text.js";
import { STOPPED_MS } from "../readings.js";
import { readSessions } from "./sessions.js";

/** The three ways a message reaches a lane. */
export const LANE_MODES = ["steer", "follow-up", "note"] as const;
export type LaneMode = (typeof LANE_MODES)[number];

/** Who sends, and where. */
export interface MessageContext {
  readonly log: ActivityLog;
  readonly library: Library;
  readonly project: string;
  /** The sending session. */
  readonly session: string;
  readonly writer?: WriteOptions;
}

export type MessageAnswer =
  | { ok: true; lane: string; mode: LaneMode }
  | { ok: false; refused: "empty" }
  | { ok: false; refused: "outside-text"; reads: string[] }
  | { ok: false; refused: "no-lane"; increment: string }
  | { ok: false; refused: "not-a-lane" | "ended"; session: string };

/** Send `text` to the lane working on `increment`, as `mode` says; refused, with nothing sent, when it cannot reach a running lane. */
export async function messageLane(context: MessageContext, { increment, mode, text, now = new Date() }: { increment: string; mode: LaneMode; text: string; now?: Date }): Promise<MessageAnswer> {
  const said = text.trim();
  if (said === "") return { ok: false, refused: "empty" };
  const reads = await outsideTextReads(context.log, context.project, context.session);
  if (reads.length > 0) return { ok: false, refused: "outside-text", reads };
  const holder = await readClaim(context.log, context.project, increment, { now });
  if (holder === undefined) return { ok: false, refused: "no-lane", increment };
  const lane = holder.session;
  const beat = (await context.log.beats.of(context.project, [lane])).get(lane);
  if (beat !== undefined) {
    if (beat.lane !== true) return { ok: false, refused: "not-a-lane", session: lane };
    if (beat.ended !== undefined || now.getTime() - Date.parse(beat.at) > STOPPED_MS) return { ok: false, refused: "ended", session: lane };
  } else {
    // A lane that keeps no heartbeat is one its hooks marked, live while its claim binds and its lines say it has not ended (4.52).
    if (!(await context.log.messages.marked(context.project, lane))) return { ok: false, refused: "not-a-lane", session: lane };
    const state = (await readSessions(context.log, context.project, { of: [lane], now })).find((one) => one.session === lane)?.state;
    if (holder.holder !== "live" || state === "ended" || state === "gone") return { ok: false, refused: "ended", session: lane };
  }
  if (mode === "note") {
    const body = (((await context.library.get(increment))?.fields as { body?: string } | undefined)?.body ?? "").trimEnd();
    const note = `Note to its lane (${now.toISOString().slice(0, 10)}, from session ${context.session}, not shown to the lane's model): ${said}`;
    await context.library.editIncrement(increment, { body: body === "" ? note : `${body}\n\n${note}` }, context.writer);
  } else {
    await context.log.messages.queue(context.project, { session: lane, increment, mode, text: said, sender: context.session });
  }
  return { ok: true, lane, mode };
}

/** What a refused message says. */
export function messageRefusal(answer: Exclude<MessageAnswer, { ok: true }>): string {
  switch (answer.refused) {
    case "empty":
      return "A message to a lane says something.";
    case "outside-text":
      return `This session has read outside text (${answer.reads.slice(0, 3).join("; ")}), so it may not instruct an unattended lane: outside text is data. The owner, or a session that has read none, may send it.`;
    case "no-lane":
      return `No session holds ${answer.increment}, so no lane is working on it to message.`;
    case "not-a-lane":
      return `Session ${answer.session} holds it, but it is not a running pool lane storytree can reach: a Claude Code lane's mod beats as a lane, and a Codex lane's hooks mark it one after its first shell command or turn's end; this session has said neither.`;
    case "ended":
      return `The lane on it, session ${answer.session}, has ended, stopped beating or gone quiet, so nothing would reach it.`;
  }
}

/** The text a lane's hook hands its model for `messages`, each naming who sent it and how. */
export function deliveryText(messages: readonly LaneMessage[]): string {
  if (messages.length === 0) return "";
  const lines = messages.map((one) => `- From session ${one.sender}, ${one.mode === "steer" ? "a steer for the work in progress" : "a follow-up: more work before you end"} (sent ${one.sent}): ${one.text}`);
  return [`Storytree brings this lane ${messages.length === 1 ? "a message" : "messages"} sent while it runs, by the owner or a storytree session acting for him; take ${messages.length === 1 ? "it" : "them"} as you would your brief:`, ...lines].join("\n");
}
