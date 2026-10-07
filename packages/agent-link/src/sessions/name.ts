/**
 * Capability 4 · Sessions. Contract 6.32 · A session names itself: a short one-line title the running-sessions list calls
 * its row by, written as a `session-named` line; it names itself again when its work shifts, and the
 * latest wins. Eventually consistent: until it names itself, the list names the row as before.
 */
import type { Line } from "../activity/index.js";
import type { CloseOutContext } from "./close-out.js";

/** The longest a session's name runs, as a claim reason is held (ADR-0737 D2): what the list's label column shows. */
export const SESSION_NAME_LIMIT = 40;

export type NameAnswer = { ok: true; line: Line } | { ok: false; refused: "empty" } | { ok: false; refused: "too-long"; limit: number; length: number };

/** Name the context's session `title`, one line, held to the limit. */
export async function nameSession(context: CloseOutContext, title: string): Promise<NameAnswer> {
  const named = title.trim().replace(/\s+/g, " ");
  if (named === "") return { ok: false, refused: "empty" };
  const length = [...named].length;
  if (length > SESSION_NAME_LIMIT) return { ok: false, refused: "too-long", limit: SESSION_NAME_LIMIT, length };
  const line = await context.log.append(context.project, {
    session: context.session,
    ...(context.harness === undefined ? {} : { harness: context.harness }),
    source: "tool",
    ...(context.folder === undefined ? {} : { folder: context.folder }),
    ...(context.branch === undefined ? {} : { branch: context.branch }),
    kind: "session-named",
    title: named,
  });
  return { ok: true, line };
}

/** What a refused name says. */
export function nameRefusal(answer: Exclude<NameAnswer, { ok: true }>): string {
  return answer.refused === "empty" ? "A session's name says what it is doing, in a few words." : `A session's name is held to ${answer.limit} characters, what the sessions list shows; this one has ${answer.length}.`;
}
