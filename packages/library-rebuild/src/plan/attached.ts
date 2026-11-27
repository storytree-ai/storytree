// Capability 17 · The library's commands
import type { Library } from "../index.js";
import type { SchemaRecord } from "../storage/rules/index.js";

export interface ShelfEntry {
  readonly id: string;
  readonly title: string;
}

export interface Attached {
  readonly shelf: readonly ShelfEntry[];
  readonly capabilities: readonly { readonly id: string; readonly title: string; readonly shelf: readonly ShelfEntry[] }[];
  readonly increments: readonly { readonly id: string; readonly title: string; readonly heldOn: readonly string[] }[];
  readonly namedBy: readonly { readonly id: string; readonly kind: string; readonly label: string }[];
}

function labelOf(record: SchemaRecord): string {
  const fields = record.fields as Record<string, unknown>;
  const label = fields["title"] ?? fields["term"];
  return typeof label === "string" ? label : record.id;
}

export async function shelfOf(library: Library, id: string): Promise<ShelfEntry[]> {
  return (await library.frontCovers(id)).map(({ id: cover, fields }) => ({ id: cover, title: fields.title }));
}

export async function attachedTo(library: Library, part: SchemaRecord<"story" | "capability">): Promise<Attached> {
  const shelf = await shelfOf(library, part.id);
  const inside = part.type === "story" ? (await library.list("capability")).filter(({ fields }) => fields.story === part.id) : [];
  const capabilities = [];
  for (const capability of inside) capabilities.push({ id: capability.id, title: capability.fields.title, shelf: await shelfOf(library, capability.id) });
  const named = new Set([part.id, ...inside.map(({ id }) => id)]);
  const increments = (await library.list("increment"))
    .filter(({ fields }) => fields.status !== "closed" && (fields.capabilities ?? []).some((capability) => named.has(capability)))
    .map(({ id, fields }) => ({ id, title: fields.title, heldOn: fields.heldOn ?? [] }));
  const listed = new Set([...shelf.map(({ id }) => id), ...inside.map(({ id }) => id)]);
  const namedBy = (await library.naming(part.id))
    .filter((record) => record.type !== "increment" && !listed.has(record.id) && !(record.type === "decision" && record.fields.frontCoverOf === part.id))
    .map((record) => ({ id: record.id, kind: record.type, label: labelOf(record) }));
  return { shelf, capabilities, increments, namedBy };
}

export function attachedLines({ shelf, capabilities, increments, namedBy }: Attached): string[] {
  const covers = (entries: readonly ShelfEntry[], indent: string) => entries.map(({ id, title }) => `${indent}${id}  ${title}`);
  return [
    ...(shelf.length === 0 ? [] : ["Front covers:", ...covers(shelf, "  ")]),
    ...(capabilities.length === 0 ? [] : ["Capabilities:", ...capabilities.flatMap(({ id, title, shelf: theirs }) => [`  ${id}  ${title}`, ...covers(theirs, "    cover ")])]),
    ...(increments.length === 0 ? [] : ["Open increments naming it:", ...increments.map(({ id, title, heldOn }) => `  ${id}  ${title}${heldOn.length === 0 ? "" : `  (held on ${heldOn.join(", ")})`}`)]),
    ...(namedBy.length === 0 ? [] : ["Named in a field by:", ...namedBy.map(({ id, kind, label }) => `  ${id}  [${kind}]  ${label}`)]),
  ];
}
