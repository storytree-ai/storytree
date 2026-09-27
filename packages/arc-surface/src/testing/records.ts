import type { FieldsOf, RecordType, SchemaRecord } from "@storytree/library";
export function record<T extends RecordType>(id: string, type: T, fields: FieldsOf<T>, at = "2026-09-27T00:00:00Z"): SchemaRecord<T> {
  return { id, type, fields, version: 1, createdAt: at, updatedAt: at } as SchemaRecord<T>;
}
