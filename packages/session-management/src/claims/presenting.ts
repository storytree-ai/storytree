// Capability 5 · Claims
import type { Library, SchemaRecord } from "@storytree/library";

import { readSessions } from "../sessions/sessions.js";
import type { ClaimContext } from "./claims.js";

export interface Presenter {
  readonly session: string;
  readonly label: string;
  readonly since: string;
}

export type PresentAnswer =
  | { ok: true; since: string }
  | { ok: false; refused: "presenting"; presenter: Presenter }
  | { ok: false; refused: "settled" | "unknown-question"; question: string };

type PresentContext = Pick<ClaimContext, "log" | "library" | "project" | "session" | "writer">;

export async function presentQuestion(context: PresentContext, id: string): Promise<PresentAnswer> {
  return context.log.locked(context.project, async () => {
    const question = await questionNamed(context.library, id);
    if (question === undefined) return { ok: false, refused: "unknown-question", question: id };
    if (question.fields.lifecycle === "settled") return { ok: false, refused: "settled", question: id };
    const standing = question.fields.presenting;
    if (standing?.session === context.session) return { ok: true, since: standing.since };
    const presenter = (await presentersOf(context.log, context.project, [question])).get(id);
    if (presenter !== undefined) return { ok: false, refused: "presenting", presenter };
    const since = new Date().toISOString();
    await context.library.editQuestion(id, { presenting: { session: context.session, since } }, writerOf(context));
    return { ok: true, since };
  });
}

export async function stopPresenting(context: PresentContext, id: string): Promise<boolean> {
  return context.log.locked(context.project, async () => {
    const question = await questionNamed(context.library, id);
    if (question?.fields.lifecycle !== "open" || question.fields.presenting?.session !== context.session) return false;
    await context.library.editQuestion(id, { presenting: undefined }, writerOf(context));
    return true;
  });
}

export async function presentersOf(log: ClaimContext["log"], project: string, questions: readonly SchemaRecord<"question">[]): Promise<Map<string, Presenter>> {
  const marked = questions.filter((question) => question.fields.lifecycle === "open" && question.fields.presenting !== undefined);
  if (marked.length === 0) return new Map();
  const sessions = await readSessions(log, project, { of: [...new Set(marked.map((question) => question.fields.presenting!.session))] });
  const live = new Map(sessions.filter((one) => (one.state === "working" || one.state === "waiting") && one.closeOut === undefined).map((one) => [one.session, one]));
  return new Map(marked.flatMap((question) => {
    const { session, since } = question.fields.presenting!;
    const presenting = live.get(session);
    return presenting === undefined ? [] : [[question.id, { session, label: presenting.label, since }]];
  }));
}

async function questionNamed(library: Library, id: string): Promise<SchemaRecord<"question"> | undefined> {
  const record = await library.get(id);
  return record?.type === "question" ? (record as SchemaRecord<"question">) : undefined;
}

function writerOf(context: PresentContext) {
  return { ...context.writer, actor: `session:${context.session}` };
}
