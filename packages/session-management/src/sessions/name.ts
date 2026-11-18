// Capability 4 · Sessions
import type { Line } from "@storytree/library";
import type { CloseOutContext } from "./close-out.js";

export const SESSION_NAME_LIMIT = 40;

export type NameAnswer = { ok: true; line: Line } | { ok: false; refused: "empty" } | { ok: false; refused: "too-long"; limit: number; length: number };

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

export function nameRefusal(answer: Exclude<NameAnswer, { ok: true }>): string {
  return answer.refused === "empty" ? "A session's name says what it is doing, in a few words." : `A session's name is held to ${answer.limit} characters, what the sessions list shows; this one has ${answer.length}.`;
}
