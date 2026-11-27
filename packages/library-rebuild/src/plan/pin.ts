// Capability 7 · Library API
import type { FieldsOf, SchemaRecord, SchemaRecords, WriteOptions } from "../storage/rules/index.js";

export type PinNote = Omit<FieldsOf<"pin">, "at"> & { readonly at?: string | undefined };

export async function recordPin(records: SchemaRecords, { at, ...pin }: PinNote, options: WriteOptions = {}): Promise<SchemaRecord<"pin">> {
  return await records.create("pin", { ...pin, at: at ?? new Date().toISOString() }, options);
}
