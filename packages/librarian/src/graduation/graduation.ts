import type { Library, Note } from "@storytree/library";

export type GraduationKind = "principle" | "process" | "definition";
export interface MemoryItem {
  readonly file: string;
  readonly why: "new" | "changed" | "lapsed";
  readonly text: string;
}
export interface ProcessGaps {
  readonly processes: Note[];
  readonly tools: string[];
}
export async function memoryWorklist(_folders: readonly string[], _options: { now?: Date } = {}): Promise<MemoryItem[]> {
  throw new Error("not built yet");
}
export async function park(_file: string, _reason: string, _options: { now?: Date } = {}): Promise<void> {
  throw new Error("not built yet");
}
export async function graduate(_library: Library, _file: string, _kind: string, _fields: Record<string, unknown>): Promise<Note> {
  throw new Error("not built yet");
}
export async function processGaps(_library: Library, _tools: readonly string[]): Promise<ProcessGaps> {
  throw new Error("not built yet");
}
