// Capability 22 · Decision corrections
import type { Library, SchemaRecord, WriteOptions } from "../index.js";

import { DecisionRefusal, label } from "./supersede.js";

export interface Correction {
  readonly text?: string;
  readonly title?: string;
  readonly loadBearing?: boolean;
  readonly status?: "proposed" | "accepted";
}

export interface Annotation {
  readonly by: string;
  readonly note: string;
  readonly date?: string;
}

export async function correct(library: Library, id: string, fields: Correction, writer?: WriteOptions): Promise<SchemaRecord<"decision">> {
  const decision = await liveDecision(library, id);
  if (fields.status === "proposed" && decision.fields.status === "accepted") {
    throw new DecisionRefusal(`${label(decision)} is accepted, and only the owner turns an accepted decision back to proposed`);
  }
  return (await library.editNote(id, fields, writer)) as SchemaRecord<"decision">;
}

export async function annotate(library: Library, target: string, { by, note, date }: Annotation, writer?: WriteOptions): Promise<SchemaRecord<"decision">> {
  const decision = await liveDecision(library, target);
  const narrowing = await liveDecision(library, by);
  const day = date ?? new Date().toISOString().slice(0, 10);
  const text = `${decision.fields.text}\n\n*Annotated ${day} by ${label(narrowing)}:* ${note}`;
  const narrows = narrowing.fields.narrows ?? [];
  if (!narrows.includes(target)) await library.editNote(by, { narrows: [...narrows, target] }, writer);
  return (await library.editNote(target, { text }, writer)) as SchemaRecord<"decision">;
}

async function liveDecision(library: Library, id: string): Promise<SchemaRecord<"decision">> {
  const decision = (await library.decision(id))?.record;
  if (decision === undefined) throw new DecisionRefusal(`${id} is not a live decision`);
  return decision;
}
