// Capability 14 · Ranked search
import type { SchemaRecord } from "../../storage/rules/index.js";

const CHUNK = 1600;
const ID = /^[a-z][A-Za-z]*_[0-9a-f]{12}$/;

export function titleOf(record: SchemaRecord): string {
  const fields = record.fields as Record<string, unknown>;
  const title = fields["title"] ?? fields["term"];
  return typeof title === "string" ? title : "";
}

function wordsOf(record: SchemaRecord): string[] {
  const fields = record.fields as Record<string, unknown>;
  const body = Object.entries(fields)
    .filter(([field]) => field !== "title" && field !== "term")
    .map(([, value]) => value)
    .filter((value): value is string => typeof value === "string" && value.trim() !== "" && !ID.test(value));
  return [`# ${titleOf(record)}`, ...body];
}

export function renderNote(record: SchemaRecord): string {
  const [heading, ...body] = wordsOf(record);
  return [heading, `${record.type} ${record.id}`, ...body].join("\n\n");
}

export function searchableText(record: SchemaRecord): string {
  return wordsOf(record).join("\n\n");
}

export function chunksOf(text: string): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of text.split("\n\n").flatMap(pieces)) {
    if (current === "") current = paragraph;
    else if (current.length + 2 + paragraph.length <= CHUNK) current = `${current}\n\n${paragraph}`;
    else {
      chunks.push(current);
      current = paragraph;
    }
  }
  if (current !== "") chunks.push(current);
  return chunks;
}

function pieces(paragraph: string): string[] {
  const found: string[] = [];
  let rest = paragraph.trim();
  while (rest.length > CHUNK) {
    const cut = rest.lastIndexOf(" ", CHUNK);
    const at = cut > 0 ? cut : CHUNK;
    found.push(rest.slice(0, at));
    rest = rest.slice(at).trimStart();
  }
  if (rest !== "") found.push(rest);
  return found;
}
