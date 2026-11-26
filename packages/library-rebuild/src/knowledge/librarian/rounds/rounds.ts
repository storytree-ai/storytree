// Capability 26 · Rounds
import type { Library, SchemaRecord } from "../../../index.js";
import { byCreation } from "../../decisions/index.js";
import type { Related } from "../../notes/index.js";
import { markedWrites, newNotes, type MarkedWrite, type NewNote } from "../catalogue.js";
import { memoryWorklist, processGaps, type MemoryItem, type ProcessGaps } from "../graduation.js";
import { brokenEdges, relatedUnlinked, unrestedDecisions, type BrokenEdge } from "../links.js";

export const CURATED: readonly string[] = ["decision", "definition", "principle", "guardrail", "pattern", "process", "agent"];

export interface RoundDue {
  readonly graduation: true;
  readonly rest: boolean;
  readonly plugins?: readonly string[];
}

export interface PluginGuidance {
  readonly plugin: string;
  readonly kinds: readonly string[];
  readonly guidance: SchemaRecord<"process" | "agent">[];
  readonly framing: string;
}

export interface WorklistOptions {
  readonly since?: number;
  readonly memoryFolders?: readonly string[];
  readonly tools?: readonly string[];
  readonly now?: Date;
  readonly progress?: (phase: string) => Promise<void>;
  readonly pluginKinds?: readonly string[];
}

export interface Worklist {
  readonly graduation: MemoryItem[];
  readonly rest?: {
    readonly links: SchemaRecord<"decision">[];
    readonly related?: Related[];
    readonly health: BrokenEdge[];
    readonly catalogue?: NewNote[];
    readonly marked?: MarkedWrite[];
    readonly unread?: string;
    readonly processes?: ProcessGaps;
    readonly questions: SchemaRecord<"question">[];
  };
  readonly plugins?: PluginGuidance[];
}

export interface Named {
  readonly id: string;
  readonly type: string;
  readonly title: string;
}

export interface WorklistView {
  readonly graduation: { readonly file: string; readonly why: MemoryItem["why"] }[];
  readonly rest?: {
    readonly links: Named[];
    readonly related?: { readonly source: string; readonly hits: { readonly id: string; readonly type: string; readonly title: string; readonly score: number }[] }[];
    readonly health: BrokenEdge[];
    readonly catalogue?: { readonly note: Named; readonly lookalikes: Named[] }[];
    readonly marked?: { readonly note: Named; readonly action: MarkedWrite["action"]; readonly actor?: string; readonly outsideRead: readonly string[] }[];
    readonly unread?: string;
    readonly processes?: { readonly processes: Named[]; readonly tools: string[] };
    readonly questions: Named[];
    readonly counts: {
      readonly links: number;
      readonly related?: number;
      readonly health: number;
      readonly catalogue?: number;
      readonly marked?: number;
      readonly processes?: number;
      readonly questions: number;
    };
  };
  readonly plugins?: { readonly plugin: string; readonly kinds: readonly string[]; readonly guidance: Named[]; readonly framing: string }[];
}

const FEW = 5;
const UNREAD = "no session start is recorded, so the catalogue, related and marked lists were left unread rather than read from every note's whole history";

function pluginOf(kind: string): string {
  return kind.slice(0, kind.indexOf("."));
}

async function curatedSince(library: Library, since: number | undefined): Promise<boolean> {
  return since === undefined || (await library.history({ since, types: CURATED, oldest: 1 })).length > 0;
}

async function writtenKinds(library: Library, since: number | undefined, kinds: readonly string[]): Promise<string[]> {
  if (since === undefined) return [...kinds];
  const written: string[] = [];
  for (const kind of kinds) if ((await library.history({ since, types: [kind], oldest: 1 })).length > 0) written.push(kind);
  return written;
}

function pluginsOf(kinds: readonly string[]): string[] {
  return [...new Set(kinds.map(pluginOf))];
}

export async function roundDue(library: Library, { since, pluginKinds }: { since?: number; pluginKinds?: readonly string[] }): Promise<RoundDue> {
  const rest = await curatedSince(library, since);
  if (pluginKinds === undefined) return { graduation: true, rest };
  return { graduation: true, rest, plugins: pluginsOf(await writtenKinds(library, since, pluginKinds)) };
}

async function guidanceOf(library: Library, kinds: readonly string[]): Promise<PluginGuidance[]> {
  if (kinds.length === 0) return [];
  const notes = [...(await library.list("process")), ...(await library.list("agent"))].sort(byCreation);
  return pluginsOf(kinds).map((plugin) => {
    const own = kinds.filter((kind) => pluginOf(kind) === plugin);
    return {
      plugin,
      kinds: own,
      guidance: notes.filter(({ fields }) => fields.title.startsWith(`${plugin}:`)),
      framing: `This guidance is supplied by the ${plugin} plugin and applies only to records of ${own.join(", ")}; where it differs from the core lists above, the core rule holds.`,
    };
  });
}

async function restOf(library: Library, options: WorklistOptions, step: (phase: string) => Promise<void>): Promise<NonNullable<Worklist["rest"]>> {
  const { since, tools } = options;
  await step("links");
  const notes = await library.search("");
  const links = await unrestedDecisions(library, notes);
  await step("related");
  const related = since === undefined ? undefined : await relatedUnlinked(library, since, notes);
  await step("health");
  const health = await brokenEdges(library, notes);
  await step("catalogue");
  const catalogue = since === undefined ? undefined : await newNotes(library, since, notes);
  const marked = since === undefined ? undefined : await markedWrites(library, since);
  await step("processes");
  const processes = tools === undefined ? undefined : await processGaps(library, tools, notes);
  await step("questions");
  const questions = await library.lapsedQuestions(options.now);
  return {
    links,
    ...(related === undefined ? {} : { related }),
    health,
    ...(catalogue === undefined ? {} : { catalogue }),
    ...(marked === undefined ? {} : { marked }),
    ...(since === undefined ? { unread: UNREAD } : {}),
    ...(processes === undefined ? {} : { processes }),
    questions,
  };
}

export async function worklist(library: Library, options: WorklistOptions): Promise<Worklist> {
  const step = options.progress ?? (async () => {});
  await step("graduation");
  const graduation = await memoryWorklist(options.memoryFolders ?? [], options.now === undefined ? {} : { now: options.now });
  await step("trigger");
  const due = await curatedSince(library, options.since);
  const kinds = options.pluginKinds === undefined ? [] : await writtenKinds(library, options.since, options.pluginKinds);
  const rest = due ? await restOf(library, options, step) : undefined;
  const plugins = await guidanceOf(library, kinds);
  return { graduation, ...(rest === undefined ? {} : { rest }), ...(plugins.length === 0 ? {} : { plugins }) };
}

function named(record: { readonly id: string; readonly type: string; readonly fields: object }): Named {
  const fields = record.fields as Record<string, unknown>;
  return { id: record.id, type: record.type, title: String(fields["title"] ?? fields["term"] ?? record.id) };
}

function restView(rest: NonNullable<Worklist["rest"]>): NonNullable<WorklistView["rest"]> {
  const { related, catalogue, marked, processes, unread } = rest;
  return {
    links: rest.links.slice(0, FEW).map(named),
    ...(related === undefined ? {} : {
      related: related.slice(0, FEW).map(({ source, hits }) => ({ source, hits: hits.slice(0, FEW).map(({ id, type, title, score }) => ({ id, type, title, score })) })),
    }),
    health: rest.health.slice(0, FEW),
    ...(catalogue === undefined ? {} : {
      catalogue: catalogue.slice(0, FEW).map(({ note, lookalikes }) => ({ note: named(note), lookalikes: lookalikes.slice(0, FEW).map(named) })),
    }),
    ...(marked === undefined ? {} : {
      marked: marked.slice(0, FEW).map(({ id, type, fields, action, actor, outsideRead }) => ({ note: named({ id, type, fields }), action, ...(actor === undefined ? {} : { actor }), outsideRead })),
    }),
    ...(unread === undefined ? {} : { unread }),
    ...(processes === undefined ? {} : { processes: { processes: processes.processes.slice(0, FEW).map(named), tools: processes.tools } }),
    questions: rest.questions.slice(0, FEW).map(named),
    counts: {
      links: rest.links.length,
      ...(related === undefined ? {} : { related: related.length }),
      health: rest.health.length,
      ...(catalogue === undefined ? {} : { catalogue: catalogue.length }),
      ...(marked === undefined ? {} : { marked: marked.length }),
      ...(processes === undefined ? {} : { processes: processes.processes.length }),
      questions: rest.questions.length,
    },
  };
}

export function worklistView(full: Worklist): WorklistView {
  const { rest, plugins } = full;
  return {
    graduation: full.graduation.map(({ file, why }) => ({ file, why })),
    ...(rest === undefined ? {} : { rest: restView(rest) }),
    ...(plugins === undefined ? {} : { plugins: plugins.map(({ plugin, kinds, guidance, framing }) => ({ plugin, kinds, guidance: guidance.map(named), framing })) }),
  };
}
