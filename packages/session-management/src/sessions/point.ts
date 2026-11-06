/**
 * Capability 4 · Sessions. Contract 4.43 · A session points at one capability where the owner's eye is needed, saying
 * why and, when it is for one, the question: written as a `pointed` line, the latest wins, and pointing at nothing,
 * closing out or ending removes it. Contract 4.44 · or at the gate between two, naming the second as its gate. The map
 * pulses on it (Agent capability claims, 5.8 and 5.9); it never moves his camera.
 */
import type { Library, Line } from "@storytree/library";
import type { CloseOutContext } from "./close-out.js";

/** Where a session points: a capability, or the gate between it and `gate`, with why and the question it is for, or nothing (no capability). */
export interface PointAt {
  readonly capability?: string;
  readonly gate?: string;
  readonly why?: string;
  readonly question?: string;
}

export type PointAnswer = { ok: true; line: Line } | { ok: false; refused: "no-why" } | { ok: false; refused: "no-capability" } | { ok: false; refused: "not-a-capability" | "not-a-question" | "same-capability"; id: string };

/** Point the context's session at `at.capability`, or at nothing when it names none. */
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

/** What a refused point says. */
export function pointRefusal(answer: Exclude<PointAnswer, { ok: true }>): string {
  return answer.refused === "no-why" ? "Say why the owner's eye is needed there, in a few words."
    : answer.refused === "no-capability" ? "A gate is between two capabilities: name the first as the capability and the second as the gate."
    : answer.refused === "same-capability" ? `${answer.id} is named twice: a gate is between two different capabilities.`
    : answer.refused === "not-a-capability" ? `${answer.id} is not a capability: a session points at one capability.`
    : `${answer.id} is not a question: name the question the point is for, or none.`;
}
