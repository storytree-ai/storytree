/**
 * Capability 1 · Quality control checks: the checks as one reading, for the change-reviewer and for
 * people, the same from both front doors (contract 1.2). The library declares the check kind
 * (ADR-0958, ADR-0964 D1); this story only reads its live records, through the library's public API.
 */
import type { Library } from "@storytree/library";

/** A note a check enforces (ADR-0956 D3); kind and title are absent when the note is no longer live. */
export interface Enforced {
  readonly id: string;
  readonly kind?: string;
  readonly title?: string;
}

/** One live check: the question a reviewer answers yes or no, and the notes that carry its reason. */
export interface Check {
  readonly id: string;
  readonly title: string;
  readonly question: string;
  readonly enforces: readonly Enforced[];
  /** Each part graduated to a deterministic check in Guardrails, with that check's name (ADR-0956 D5); absent when none has. */
  readonly graduated?: readonly Graduated[];
}

/** A part of a check that graduated, and the Guardrails check that now enforces it. */
export interface Graduated {
  readonly part: string;
  readonly enforcedBy: string;
}

/** Every live check, in id order, each with the notes it enforces. A retired check is not in it. */
export async function checks(library: Library): Promise<Check[]> {
  const live = await library.list("check");
  const ids = [...new Set(live.flatMap((check) => check.fields.enforces))];
  const notes = new Map(await Promise.all(ids.map(async (id) => [id, await library.get(id)] as const)));
  return live.map((check) => ({
    id: check.id,
    title: check.fields.title,
    question: check.fields.question,
    enforces: check.fields.enforces.map((id) => {
      const note = notes.get(id);
      if (note === null || note === undefined) return { id };
      // A definition is named by its term; every other kind a check may enforce has a title.
      const fields = note.fields as { title?: string; term?: string };
      return { id, kind: note.type, title: fields.title ?? fields.term ?? id };
    }),
    ...(check.fields.graduated === undefined ? {} : { graduated: check.fields.graduated }),
  }));
}

/** The reading as the plain text both front doors answer with. */
export function checksText(reading: readonly Check[]): string {
  if (reading.length === 0) return "No quality control checks are in this library.";
  return [
    `${reading.length} quality control check${reading.length === 1 ? "" : "s"}:`,
    ...reading.flatMap((check) => [
      `  ${check.id}  ${check.title}`,
      `    ${check.question}`,
      ...check.enforces.map((note) => `    enforces ${note.id}${note.kind === undefined ? "  (no longer live)" : `  [${note.kind}]  ${note.title}`}`),
      ...(check.graduated ?? []).map((part) => `    graduated to Guardrails' ${part.enforcedBy}: ${part.part}`),
    ]),
  ].join("\n");
}
