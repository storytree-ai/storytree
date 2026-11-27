// Capability 17 · The library's commands
import type { VerbContext } from "../../../commands/kit/index.js";
import type { NewLine, SchemaRecord } from "../../../storage/rules/index.js";
import type { PlanClaim } from "../../../work/arcs/index.js";

export type HeldClaim = PlanClaim;

export type Found = Extract<NewLine, { kind: "note-read" }>["found"];

export interface NoteRead {
  readonly note: string;
  readonly found: Found;
  readonly read: "peek" | "whole";
}

export interface Presenter {
  readonly session: string;
  readonly label: string;
  readonly since: string;
}

export interface NoteToolContext extends VerbContext {
  claims(): Promise<readonly HeldClaim[]>;
  notesRead(): Promise<readonly NoteRead[]>;
  recordReads(reads: readonly NoteRead[]): Promise<void>;
  presenterOf(question: SchemaRecord<"question">): Promise<Presenter | undefined>;
}

export async function foundAs(context: NoteToolContext, note: string): Promise<Found> {
  return (await context.notesRead()).filter((read) => read.note === note).at(-1)?.found ?? "id";
}
