// Capability 10 · Work in flight
import type { SchemaRecord, SchemaRecords, WriteOptions } from "../../storage/rules/index.js";

export interface NewFyi {
  readonly title: string;
  readonly what: string;
  readonly about: string;
  readonly by?: string | undefined;
  readonly at?: string | undefined;
}

export async function recordFyi(records: SchemaRecords, { by, at, ...fyi }: NewFyi, options: WriteOptions = {}): Promise<SchemaRecord<"fyi">> {
  return await records.create("fyi", { ...fyi, at: at ?? new Date().toISOString(), by: by ?? options.actor ?? "unknown" }, options);
}

export async function unheardFyis(records: SchemaRecords): Promise<SchemaRecord<"fyi">[]> {
  const unheard = (await records.list("fyi")).filter(({ fields }) => fields.heardAt === undefined);
  return unheard.sort((a, b) => (a.fields.at < b.fields.at ? -1 : a.fields.at > b.fields.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export async function markFyisHeard(records: SchemaRecords, ids: readonly string[], options: WriteOptions = {}): Promise<string[]> {
  return await records.inOneWrite(async () => {
    const held: SchemaRecord<"fyi">[] = [];
    for (const id of ids) {
      const record = await records.get(id);
      if (record?.type !== "fyi") throw new Error(`${id} is no FYI, so nothing was marked heard`);
      held.push(record);
    }
    const heardAt = new Date().toISOString();
    const marked: string[] = [];
    for (const record of held) {
      if (record.fields.heardAt !== undefined || marked.includes(record.id)) continue;
      await records.edit(record.id, { heardAt }, options);
      marked.push(record.id);
    }
    return marked;
  }, options.signal);
}
