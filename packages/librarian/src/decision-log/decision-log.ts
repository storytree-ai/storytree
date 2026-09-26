import type { Library, SchemaRecord } from "@storytree/library";

export type Successor = { title: string; text: string };
export type Correction = { text?: string; title?: string; loadBearing?: boolean; status?: "proposed" | "accepted" };
export type Annotation = { by: string; note: string; date?: string };
export type BrokenEdge = { from: string; field: string; to: string };

export async function supersede(_library: Library, _olds: string[], _decision: Successor): Promise<SchemaRecord<"decision">> {
  throw new Error("not built yet");
}
export async function correct(_library: Library, _id: string, _fields: Correction): Promise<SchemaRecord<"decision">> {
  throw new Error("not built yet");
}
export async function annotate(_library: Library, _target: string, _annotation: Annotation): Promise<SchemaRecord<"decision">> {
  throw new Error("not built yet");
}
export async function brokenEdges(_library: Library): Promise<BrokenEdge[]> {
  throw new Error("not built yet");
}
