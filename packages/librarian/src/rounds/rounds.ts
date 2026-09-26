import type { Library, SchemaRecord } from "@storytree/library";

import type { NewNote } from "../catalogue/index.js";
import type { BrokenEdge } from "../decision-log/index.js";
import type { MemoryItem, ProcessGaps } from "../graduation/index.js";

export const CURATED: readonly string[] = [];
export interface RoundDue {
  readonly graduation: true;
  readonly rest: boolean;
}
export interface WorklistOptions {
  readonly since?: number;
  readonly branch?: string;
  readonly memoryFolders?: readonly string[];
  readonly tools?: readonly string[];
  readonly now?: Date;
}
export interface Worklist {
  readonly graduation: MemoryItem[];
  readonly rest?: {
    readonly links: SchemaRecord<"decision">[];
    readonly health: BrokenEdge[];
    readonly catalogue: NewNote[];
    readonly processes?: ProcessGaps;
    readonly questions: SchemaRecord<"question">[];
    readonly friction: SchemaRecord<"friction">[];
  };
}
export async function roundDue(_library: Library, _options: { since?: number }): Promise<RoundDue> {
  throw new Error("not built yet");
}
export async function worklist(_library: Library, _options: WorklistOptions): Promise<Worklist> {
  throw new Error("not built yet");
}
