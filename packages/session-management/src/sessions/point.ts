// Capability 4 · Sessions
import type { Library, Line } from "@storytree/library";
import type { CloseOutContext } from "./close-out.js";

export interface PointAt {
  readonly capability?: string;
  readonly gate?: string;
  readonly why?: string;
  readonly question?: string;
}

export type PointAnswer = { ok: true; line: Line } | { ok: false; refused: "no-why" } | { ok: false; refused: "no-capability" } | { ok: false; refused: "not-a-capability" | "not-a-question" | "same-capability"; id: string };

export async function pointAt(context: CloseOutContext & { readonly library: Pick<Library, "get"> }, at: PointAt): Promise<PointAnswer> {
  const capability = at.capability?.trim() || undefined;
  const why = at.why?.trim().replace(/\s+/g, " ") || undefined;
  const question = at.question?.trim() || undefined;
  const gate = at.gate?.trim() || undefined;
  if (gate !== undefined && capability === undefined) return { ok: false, refused: "no-capability" };
  if (capability !== undefined) {
    if ((await context.library.get(capability))?.type !== "capability") return { ok: false, refused: "not-a-capability", id: capability };
    if (gate === capability) return { ok: false, refused: "same-capability", id: gate };
    if (gate !== undefined && (await context.library.get(gate))?.type !== "capability") return { ok: false, refused: "not-a-capability", id: gate };
    if (why === undefined) return { ok: false, refused: "no-why" };
    if (question !== undefined && (await context.library.get(question))?.type !== "question") return { ok: false, refused: "not-a-question", id: question };
  }
  const line = await context.log.append(context.project, {
    session: context.session,
    ...(context.harness === undefined ? {} : { harness: context.harness }),
    source: "tool",
    ...(context.folder === undefined ? {} : { folder: context.folder }),
    ...(context.branch === undefined ? {} : { branch: context.branch }),
    kind: "pointed",
    ...(capability === undefined ? {} : { capability, ...(gate === undefined ? {} : { gate }), why, ...(question === undefined ? {} : { question }) }),
  });
  return { ok: true, line };
}

export function pointRefusal(answer: Exclude<PointAnswer, { ok: true }>): string {
  return answer.refused === "no-why" ? "Say why the owner's eye is needed there, in a few words."
    : answer.refused === "no-capability" ? "A gate is between two capabilities: name the first as the capability and the second as the gate."
    : answer.refused === "same-capability" ? `${answer.id} is named twice: a gate is between two different capabilities.`
    : answer.refused === "not-a-capability" ? `${answer.id} is not a capability: a session points at one capability.`
    : `${answer.id} is not a question: name the question the point is for, or none.`;
}
