import type { Library, Note, SchemaRecord } from "@storytree/library";

export async function link(_library: Library, _from: string, _to: string): Promise<Note> {
  throw new Error("not built yet");
}

export async function unrestedDecisions(_library: Library): Promise<SchemaRecord<"decision">[]> {
  throw new Error("not built yet");
}
