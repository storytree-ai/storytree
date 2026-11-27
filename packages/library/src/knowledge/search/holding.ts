// Capability 17 · The library's commands
import type { Library } from "../../index.js";
import type { SchemaRecord } from "../../storage/rules/index.js";
import type { PhraseKind } from "./phrase.js";
import { titleOf } from "./render.js";

export interface PhraseHit {
  readonly record: SchemaRecord<PhraseKind>;
  readonly title: string;
  readonly fields: readonly string[];
}

function holds(value: unknown, phrase: string): boolean {
  if (typeof value === "string") return value.includes(phrase);
  if (Array.isArray(value)) return value.some((member) => holds(member, phrase));
  if (typeof value === "object" && value !== null) return Object.values(value).some((member) => holds(member, phrase));
  return false;
}

export async function everyHolding(library: Library, phrase: string, options: { kinds?: readonly PhraseKind[]; fields?: readonly string[] } = {}): Promise<PhraseHit[]> {
  const hits: PhraseHit[] = [];
  let after: string | undefined;
  do {
    const page = await library.findPhrase(phrase, {
      limit: 100,
      ...(options.kinds === undefined ? {} : { kinds: options.kinds }),
      ...(options.fields === undefined ? {} : { fields: options.fields }),
      ...(after === undefined ? {} : { after }),
    });
    for (const record of page.records) {
      const fields = Object.entries(record.fields as Record<string, unknown>)
        .filter(([field, value]) => (options.fields === undefined || options.fields.includes(field)) && holds(value, phrase))
        .map(([field]) => field)
        .sort();
      hits.push({ record, title: titleOf(record), fields });
    }
    after = page.next;
  } while (after !== undefined);
  return hits;
}

export function holdingLines(phrase: string, hits: readonly PhraseHit[]): string {
  const quoted = JSON.stringify(phrase);
  if (hits.length === 0) return `No record holds ${quoted} exactly.`;
  const head = `${hits.length} ${hits.length === 1 ? "record holds" : "records hold"} ${quoted} exactly:`;
  return [head, ...hits.map(({ record, title, fields }) => `  ${record.id}  [${record.type}]  ${title}  (${fields.join(", ")})`)].join("\n");
}
