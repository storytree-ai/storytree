import type { FieldsOf, Library, SchemaRecord } from "@storytree/library";

export type Route = NonNullable<FieldsOf<"friction">["route"]>;
export async function openQuestions(_library: Library): Promise<SchemaRecord<"question">[]> {
  throw new Error("not built yet");
}
export async function frictionDrain(_library: Library, _options: { branch?: string }): Promise<SchemaRecord<"friction">[]> {
  throw new Error("not built yet");
}
export async function route(_library: Library, _id: string, _route: Route, _reason: string): Promise<SchemaRecord<"friction">> {
  throw new Error("not built yet");
}
