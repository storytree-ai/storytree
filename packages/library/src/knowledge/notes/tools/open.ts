// Capability 17 · The library's commands
import type { Library } from "../../../index.js";
import { contextIn, PROJECT_INPUT, refusing, verb, VerbRefusal, type VerbAnswer } from "../../../commands/kit/index.js";
import { attachedLines, attachedTo } from "../../../plan/index.js";
import type { SchemaRecord } from "../../../storage/rules/index.js";
import { titleOf } from "../../search/index.js";
import { NOTE_TYPES } from "../links.js";
import { adrSaid, fieldOf, fieldsHeld, justificationOf, supersededLines, valueSaid, wholeRecord } from "../reading.js";
import { foundAs, type NoteRead, type NoteToolContext, type Presenter } from "./context.js";

type Stored = NonNullable<Awaited<ReturnType<Library["get"]>>>;

interface Shown {
  readonly lines: readonly string[];
  readonly data?: Record<string, unknown>;
  readonly peeks?: readonly string[];
}

function kindSaid(type: string): string {
  return `${type.charAt(0).toUpperCase()}${type.slice(1)}`;
}

function fieldLines(record: Stored, leaving: readonly string[]): string[] {
  return Object.entries(record.fields as Record<string, unknown>).filter(([field]) => !leaving.includes(field)).map(([field, value]) => `${field}: ${valueSaid(value)}`);
}

async function decisionShown(library: Library, record: SchemaRecord<"decision">): Promise<Shown> {
  const { fields } = record;
  const linksTo = [];
  for (const id of fields.links ?? []) {
    const target = await library.get(id);
    const justification = justificationOf(fields, id);
    linksTo.push({ id, title: target === null ? undefined : titleOf(target), ...(justification === undefined ? {} : { justification }) });
  }
  const linking = await library.linkingIn(record.id);
  const linkedFrom = linking.map((one) => ({ id: one.id, type: one.type, title: titleOf(one) }));
  return {
    lines: [
      `Decision ${JSON.stringify(fields.title)} (${adrSaid(record, record.id)}, ${fields.status})`,
      fields.text,
      ...(linksTo.length === 0 ? [] : ["It links to:", ...linksTo.map(({ id, title, justification }) => `  ${title ?? "(no longer live)"} [${id}]${justification === undefined ? "" : ` — ${justification}`}`)]),
      ...(linkedFrom.length === 0 ? [] : ["Linked from:", ...linkedFrom.map(({ id, type, title }) => `  ${id}  [${type}]  ${title}`)]),
      ...(await supersededLines(library, record)),
    ],
    data: { linksTo, linkedFrom },
  };
}

async function contractShown(library: Library, record: SchemaRecord<"contract">): Promise<Shown> {
  const { fields } = record;
  const part = async (id: string) => ({ id, title: titleOf((await library.get(id)) ?? ({ fields: {} } as Stored)) });
  const edgeRecord = fields.edge === undefined ? null : await library.get(fields.edge);
  const edge = edgeRecord?.type === "edge" ? { id: edgeRecord.id, from: await part(edgeRecord.fields.from), to: await part(edgeRecord.fields.to) } : undefined;
  const capability = fields.capability === undefined ? undefined : await part(fields.capability);
  const health = await library.health(record.id);
  const placed = edge !== undefined
    ? `It sits on the edge ${edge.id}: Capability ${JSON.stringify(edge.from.title)} (${edge.from.id}) depends on Capability ${JSON.stringify(edge.to.title)} (${edge.to.id}).`
    : `It is a contract of Capability ${JSON.stringify(capability?.title)} (${capability?.id}).`;
  return {
    lines: [`Contract ${JSON.stringify(fields.title)} (${record.id}):`, ...(fields.description === undefined ? [] : [fields.description]), placed, `Health: verified ${health.verified.state}, reported ${health.reported.state}.`],
    data: { contract: { id: record.id, title: fields.title, ...(fields.description === undefined ? {} : { description: fields.description }), ...(edge === undefined ? {} : { edge }), ...(capability === undefined ? {} : { capability }) }, health },
  };
}

async function questionShown(library: Library, record: SchemaRecord<"question">, presenter: Presenter | undefined): Promise<Shown> {
  const { fields } = record;
  const holding = (await library.list("increment")).filter((increment) => increment.fields.status !== "closed" && (increment.fields.heldOn ?? []).includes(record.id)).map(({ id }) => id);
  const evidence = [];
  for (const id of fields.links ?? []) {
    const linked = await library.get(id);
    evidence.push(linked === null ? `${id} (no longer live)` : `${titleOf(linked)} [${id}]`);
  }
  const said = (label: string, value: string | undefined) => (value === undefined ? [] : [`${label}: ${value}`]);
  return {
    lines: [
      `Question ${JSON.stringify(fields.title)} (${record.id})`,
      `On ${fields.arc}, ${fields.lifecycle}`,
      ...said("Stakes", fields.stakes),
      ...said("Statement", fields.statement),
      ...said("Context", fields.context),
      ...said("Options", fields.options),
      ...said("Recommendation", fields.recommendation),
      ...said("Answer", fields.answer),
      ...(presenter === undefined ? [] : [`Being put to the owner by ${presenter.label} session ${presenter.session} since ${presenter.since}`]),
      ...(holding.length === 0 ? [] : [`Holding: ${holding.join(", ")}`]),
      ...(evidence.length === 0 ? [] : [`Evidence: ${evidence.join("; ")}`]),
    ],
    data: { question: { id: record.id, arc: fields.arc, lifecycle: fields.lifecycle, holding } },
  };
}

async function partShown(library: Library, record: SchemaRecord<"story" | "capability">): Promise<Shown> {
  const attached = await attachedTo(library, record);
  return {
    lines: [`${kindSaid(record.type)} ${JSON.stringify(record.fields.title)}`, ...(record.fields.description === undefined ? [] : [record.fields.description]), ...attachedLines(attached)],
    data: { shelf: attached.shelf, attached },
    peeks: [...attached.shelf, ...attached.capabilities.flatMap(({ shelf }) => shelf)].map(({ id }) => id),
  };
}

async function linkedNotes(library: Library, record: Stored): Promise<string[]> {
  const out = ((record.fields as { readonly links?: readonly string[] }).links ?? []);
  const linked: string[] = [];
  for (const id of out) if (NOTE_TYPES.includes((await library.get(id))?.type ?? "")) linked.push(id);
  for (const one of await library.linkingIn(record.id)) if (NOTE_TYPES.includes(one.type)) linked.push(one.id);
  return [...new Set(linked)].filter((id) => id !== record.id);
}

async function shown(library: Library, record: Stored, context: NoteToolContext): Promise<Shown> {
  if (record.type === "decision") return await decisionShown(library, record);
  if (record.type === "contract") return await contractShown(library, record);
  if (record.type === "question") return await questionShown(library, record, await context.presenterOf(record));
  if (record.type === "story" || record.type === "capability") return await partShown(library, record);
  if (NOTE_TYPES.includes(record.type)) return { lines: [`${kindSaid(record.type)} ${JSON.stringify(titleOf(record))}`, ...fieldLines(record, ["title", "term"])] };
  return { lines: [wholeRecord(record)] };
}

export const OPEN = verb({
  command: { absent: "library read reads a record whole on the command line" },
  tool: { name: "open", description: "Open one record of the library whole by its id: a note, a decision, a question, a contract, or a story or capability with everything attached to it; give field for one field exactly as stored" },
  inputs: {
    id: { kind: "text", describe: "The id of the record to open" },
    field: { kind: "text", optional: true, describe: "One field to give exactly as stored, instead of the whole record" },
    project: PROJECT_INPUT,
  },
  async act({ id, field, project }, context: NoteToolContext): Promise<VerbAnswer> {
    const there = await contextIn(context, project);
    const own = there === context;
    const record = await there.library.get(id);
    if (record === null) throw new VerbRefusal(`no record ${id} in this project${own ? "" : ` (${there.project})`}`);
    if (record.type === "arc") throw new VerbRefusal(`${id} is an arc, which open does not read: show_plan lists its increments, and storytree arc show ${id} reads it whole`);
    const note = NOTE_TYPES.includes(record.type);
    const reads: NoteRead[] = [];
    if (field !== undefined) {
      if (!fieldsHeld(record).includes(field)) throw new VerbRefusal(`${id} has no field ${JSON.stringify(field)}: its fields are ${fieldsHeld(record).join(", ")}`, { misuse: true });
      if (own && note) await context.recordReads([{ note: id, found: await foundAs(context, id), read: "whole" }]);
      return { text: valueSaid(await fieldOf(there.library, record, field)), raw: true };
    }
    const { lines, data, peeks = [] } = await refusing(() => shown(there.library, record, there));
    if (own) {
      if (note) reads.push({ note: id, found: await foundAs(context, id), read: "whole" });
      reads.push(...peeks.map((peek) => ({ note: peek, found: "shelf" as const, read: "peek" as const })));
      if (note) reads.push(...(await linkedNotes(there.library, record)).map((peek) => ({ note: peek, found: "link" as const, read: "peek" as const })));
      if (reads.length > 0) await context.recordReads(reads);
    }
    const text = lines.join("\n");
    return { text: own ? text : `project ${there.project}:\n${text}`, data: { id: record.id, type: record.type, ...data } };
  },
});
