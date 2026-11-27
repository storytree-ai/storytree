// Capability 14 · Ranked search
import { RECORD_SCHEMAS, type RecordType, type SchemaRecord, type SchemaRecords } from "../../storage/rules/index.js";
import { SEARCHABLE_KINDS, type NoteType, type PlanKind } from "./rank.js";

export type PhraseKind = NoteType | PlanKind | Extract<keyof typeof RECORD_SCHEMAS, "question">;

export interface PhraseOptions {
  readonly kinds?: readonly PhraseKind[];
  readonly fields?: readonly string[];
  readonly limit?: number;
  readonly after?: string;
}

export interface PhrasePage {
  readonly records: SchemaRecord<PhraseKind>[];
  readonly next?: string;
}

const PHRASE_KINDS: readonly string[] = [...SEARCHABLE_KINDS, "question"];

export async function findPhrase(records: Pick<SchemaRecords, "list">, phrase: string, options: PhraseOptions = {}): Promise<PhrasePage> {
  if (phrase === "") throw new Error("a phrase lookup needs a phrase, not an empty one");
  const limit = options.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError(`a phrase lookup's limit is a whole number from 1 to 100, not ${limit}`);
  for (const kind of options.kinds ?? []) {
    if (!PHRASE_KINDS.includes(kind)) throw new Error(`unknown kind for a phrase lookup: ${kind}`);
  }
  const kinds = (options.kinds ?? PHRASE_KINDS).filter((kind) => Object.hasOwn(RECORD_SCHEMAS, kind));
  if (kinds.length === 0 || options.fields?.length === 0) return { records: [] };
  const found = await records.list(kinds as RecordType[], {
    phrase: { text: phrase, ...(options.fields === undefined ? {} : { fields: options.fields }) },
    ...(options.after === undefined ? {} : { after: options.after }),
    limit: limit + 1,
  });
  const page = found.slice(0, limit) as SchemaRecord<PhraseKind>[];
  return found.length > limit ? { records: page, next: page.at(-1)!.id } : { records: page };
}
