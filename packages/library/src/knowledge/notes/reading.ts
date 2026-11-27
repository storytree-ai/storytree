// Capability 17 · The library's commands
import type { Library } from "../../index.js";
import { titleOf } from "../search/index.js";

type Stored = NonNullable<Awaited<ReturnType<Library["get"]>>>;

const DECISION_FIELDS = ["links", "supersedes"] as const;

export function valueSaid(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

interface Pending {
  readonly record: string;
  readonly type: string;
  readonly before?: Readonly<Record<string, unknown>>;
  readonly after?: Readonly<Record<string, unknown>>;
  readonly retire?: string;
}

function pendingSaid(changes: readonly Pending[]): string {
  const said = (value: unknown): string => (value === undefined || value === null ? "(none)" : typeof value === "string" ? value : JSON.stringify(value));
  return [
    `pending: ${changes.length} ${changes.length === 1 ? "change" : "changes"}`,
    ...changes.flatMap(({ record, type, before = {}, after = {}, retire }) => [
      `  ${record} (${type})`,
      ...(retire === undefined ? Object.entries(after).map(([field, value]) => `    ${field}: ${said(before[field])} -> ${said(value)}`) : [`    retire: ${retire}`]),
    ]),
  ].join("\n");
}

export function wholeRecord(record: Stored): string {
  const dormant = record.dormant === true ? "  dormant: its plugin is not mounted on this computer" : "";
  const fields = Object.entries(record.fields as Record<string, unknown>).map(([field, value]) =>
    record.type === "increment" && field === "pending" && Array.isArray(value) ? pendingSaid(value as Pending[]) : `${field}: ${valueSaid(value)}`);
  return [`${record.id}  [${record.type}]  schema ${record.version}${dormant}`, ...fields].join("\n");
}

export function justificationOf(fields: object, target: string): string | undefined {
  return (fields as { justifications?: Readonly<Record<string, string>> }).justifications?.[target];
}

export function justificationSaid(fields: object, target: string, before: string): string {
  return `${before}  ${justificationOf(fields, target) ?? "(old shape: no justification)"}`;
}

export function adrSaid(record: Stored | null, id: string): string {
  const number = (record?.fields as { number?: unknown } | undefined)?.number;
  return typeof number === "number" ? `ADR-${String(number).padStart(4, "0")}` : id;
}

export async function supersededLines(library: Library, record: { readonly id: string; readonly type: string }): Promise<string[]> {
  if (record.type !== "decision") return [];
  const view = await library.decision(record.id);
  if (view === null) return [];
  const lines: string[] = [];
  for (const id of view.supersededBy) lines.push(`Superseded by ${adrSaid(await library.get(id), id)}`);
  for (const { decision, clauses } of view.supersededInPart) {
    lines.push(`Superseded in part by ${adrSaid(await library.get(decision), decision)}${clauses === undefined || clauses.length === 0 ? "" : ` (${clauses.join(", ")})`}`);
  }
  return lines;
}

export async function decisionLinkLines(library: Library, record: Stored): Promise<string[]> {
  if (record.type !== "decision") return [];
  const fields = record.fields as Record<string, unknown>;
  const lines: string[] = [];
  for (const field of DECISION_FIELDS) {
    const targets = Array.isArray(fields[field]) ? (fields[field] as unknown[]).filter((one): one is string => typeof one === "string") : [];
    for (const target of targets) {
      if ((await library.get(target))?.type === "decision") lines.push(justificationSaid(fields, target, `  ${field} ${target}`));
    }
  }
  return lines.length === 0 ? [] : ["decision links:", ...lines];
}

export async function linkedFromLines(library: Library, id: string): Promise<string[]> {
  const linking = await library.linkingIn(id);
  return linking.length === 0 ? [] : ["Linked from:", ...linking.map((record) => `  ${record.id}  [${record.type}]  ${titleOf(record)}`)];
}

export async function fieldOf(library: Library, record: Stored, field: string): Promise<unknown> {
  if (record.type === "capability" && field === "dependsOn") return (await library.dependsOn(record.id)) ?? [];
  return (record.fields as Record<string, unknown>)[field];
}

export function fieldsHeld(record: Stored): string[] {
  return [...Object.keys(record.fields as Record<string, unknown>), ...(record.type === "capability" && !Object.hasOwn(record.fields, "dependsOn") ? ["dependsOn"] : [])];
}
