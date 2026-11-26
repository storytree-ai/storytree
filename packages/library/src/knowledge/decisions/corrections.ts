// Capability 31 · Decisions
import type { SchemaRecord, WriteOptions } from "../../records/index.js";

import { withClauses } from "./decision-log.js";
import { DecisionRefusal, label, type DecisionLibrary } from "./supersede.js";

type Correcting = Pick<DecisionLibrary, "decision" | "editNote">;

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
  readonly clauses?: readonly string[];
  readonly why?: string;
}

export async function correct(library: Correcting, id: string, fields: Correction, writer?: WriteOptions): Promise<SchemaRecord<"decision">> {
  const decision = await liveDecision(library, id);
  if (fields.status === "proposed" && decision.fields.status === "accepted") {
    throw new DecisionRefusal(`${label(decision)} is accepted, and only the owner turns an accepted decision back to proposed`);
  }
  return (await library.editNote(id, fields, writer)) as SchemaRecord<"decision">;
}

export async function annotate(library: Correcting, target: string, { by, note, date, clauses, why }: Annotation, writer?: WriteOptions): Promise<SchemaRecord<"decision">> {
  const decision = await liveDecision(library, target);
  const superseding = await liveDecision(library, by);
  const day = date ?? new Date().toISOString().slice(0, 10);
  const text = `${decision.fields.text}\n\n*Annotated ${day} by ${label(superseding)}:* ${note}`;
  const entries = superseding.fields.supersedesClauses ?? [];
  const next = withClauses(entries, target, clauses ?? []);
  if (JSON.stringify(next) !== JSON.stringify(entries)) await library.editNote(by, { supersedesClauses: next, ...(why === undefined ? {} : { justifications: { [target]: why } }) }, writer);
  return (await library.editNote(target, { text }, writer)) as SchemaRecord<"decision">;
}

async function liveDecision(library: Correcting, id: string): Promise<SchemaRecord<"decision">> {
  const decision = (await library.decision(id))?.record;
  if (decision === undefined) throw new DecisionRefusal(`${id} is not a live decision`);
  return decision;
}
