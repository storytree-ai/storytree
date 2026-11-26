// Capability 10 · Work in flight
import type { SchemaRecord, SchemaRecords, WriteOptions } from "../../storage/rules/index.js";

export interface NewFyi {
  readonly title: string;
  readonly what: string;
  readonly about: string;
}

export async function recordFyi(records: SchemaRecords, fyi: NewFyi, options: WriteOptions = {}): Promise<SchemaRecord<"fyi">> {
  return await records.create("fyi", { ...fyi, at: new Date().toISOString(), by: options.actor ?? "the library" }, options);
}
