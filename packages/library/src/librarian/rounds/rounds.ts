// Capability 26 · Rounds
import type { Library, Related, SchemaRecord } from "../../index.js";

import { markedWrites, newNotes, type MarkedWrite, type NewNote } from "../catalogue/index.js";
import { memoryWorklist, processGaps, type MemoryItem, type ProcessGaps } from "../graduation/index.js";
import { brokenEdges, relatedUnlinked, unrestedDecisions, type BrokenEdge } from "../links/index.js";
import { allNotes } from "../notes.js";

export const CURATED: readonly string[] = ["decision", "question", "principle", "guardrail", "pattern", "process", "definition", "agent"];

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

export async function roundDue(library: Library, { since, pluginKinds }: { since?: number; pluginKinds?: readonly string[] }): Promise<RoundDue> {
  const plugins = pluginKinds === undefined ? {} : { plugins: await pluginsDue(library, since, pluginKinds) };
  if (since === undefined) return { graduation: true, rest: true, ...plugins };
  const curated = await library.history({ since, types: CURATED, oldest: 1 });
  return { graduation: true, rest: curated.length > 0, ...plugins };
}

async function pluginsDue(library: Library, since: number | undefined, pluginKinds: readonly string[]): Promise<string[]> {
  const due: string[] = [];
  for (const [plugin, kinds] of byPlugin(pluginKinds)) {
    if (since === undefined || (await library.history({ since, types: kinds, oldest: 1 })).length > 0) due.push(plugin);
  }
  return due;
}

function byPlugin(pluginKinds: readonly string[]): Map<string, string[]> {
  const plugins = new Map<string, string[]>();
  for (const kind of pluginKinds) {
    const plugin = kind.split(".")[0]!;
    plugins.set(plugin, [...(plugins.get(plugin) ?? []), kind]);
  }
  return plugins;
}

async function pluginGuidance(library: Library, due: readonly string[], pluginKinds: readonly string[]): Promise<PluginGuidance[]> {
  if (due.length === 0) return [];
  const records = [...(await library.list("process")), ...(await library.list("agent"))] as SchemaRecord<"process" | "agent">[];
  const kindsOf = byPlugin(pluginKinds);
  return due.flatMap((plugin) => {
    const guidance = records.filter((record) => record.fields.title.startsWith(`${plugin}:`));
    if (guidance.length === 0) return [];
    const kinds = kindsOf.get(plugin) ?? [];
    const framing = `Supplied by the ${plugin} plugin, beneath the core rules above: it applies only to records of ${kinds.join(", ")}, and where it differs from a core rule, the core rule holds.`;
    return [{ plugin, kinds, guidance, framing }];
  });
}

export async function worklist(library: Library, options: WorklistOptions): Promise<Worklist> {
  const phase = async (name: string): Promise<void> => options.progress?.(name);
  await phase("graduation");
  const graduation = await memoryWorklist(options.memoryFolders ?? [], options.now === undefined ? {} : { now: options.now });
  await phase("trigger");
  const due = await roundDue(library, options);
  const plugins = async (): Promise<{ plugins?: PluginGuidance[] }> => {
    if (due.plugins === undefined || due.plugins.length === 0) return {};
    await phase("plugins");
    const offered = await pluginGuidance(library, due.plugins, options.pluginKinds ?? []);
    return offered.length === 0 ? {} : { plugins: offered };
  };
  if (!due.rest) return { graduation, ...(await plugins()) };
  const { since } = options;
  const notes = await allNotes(library);
  await phase("links");
  const links = await unrestedDecisions(library, notes);
  if (since !== undefined) await phase("related");
  const related = since === undefined ? undefined : await relatedUnlinked(library, since, notes);
  await phase("health");
  const health = await brokenEdges(library, notes);
  if (since !== undefined) await phase("catalogue");
  const catalogue = since === undefined ? undefined : await newNotes(library, since, notes);
  const marked = since === undefined ? undefined : await markedWrites(library, since);
  if (options.tools !== undefined) await phase("processes");
  const processes = options.tools === undefined ? undefined : await processGaps(library, options.tools, notes);
  await phase("questions");
  const questions = await library.lapsedQuestions(options.now);
  const offered = await plugins();
  return {
    graduation,
    rest: {
      links,
      ...(related === undefined || catalogue === undefined
        ? { unread: "No session start is recorded, so the notes this session wrote are unknown: the catalogue and related lists were not gathered. Search for each note you wrote, and read its related notes, by hand." }
        : { related, catalogue, ...(marked === undefined ? {} : { marked }) }),
      health,
      ...(processes === undefined ? {} : { processes }),
      questions,
    },
    ...offered,
  };
}

export const SHOWN = 5;

export interface NoteRef {
  readonly id: string;
  readonly type: string;
  readonly title: string;
}

export interface WorklistView {
  readonly graduation: MemoryItem[];
  readonly rest?: {
    readonly links: NoteRef[];
    readonly related?: { source: string; hits: (NoteRef & { readonly linked: boolean })[] }[];
    readonly health: BrokenEdge[];
    readonly catalogue?: { note: NoteRef; lookalikes: NoteRef[] }[];
    readonly marked?: { note: NoteRef; seq: number; action: MarkedWrite["action"]; actor?: string; outsideRead: readonly string[] }[];
    readonly unread?: string;
    readonly processes?: { processes: NoteRef[]; tools: string[] };
    readonly questions: NoteRef[];
    readonly counts: { links: number; related?: number; health: number; catalogue?: number; marked?: number; processes?: number; questions: number };
  };
  readonly plugins?: { plugin: string; kinds: readonly string[]; guidance: NoteRef[]; framing: string }[];
}

export function worklistView(full: Worklist): WorklistView {
  const plugins = full.plugins?.map(({ plugin, kinds, guidance, framing }) => ({ plugin, kinds, guidance: guidance.map(ref), framing }));
  const view: WorklistView = {
    graduation: full.graduation,
  };
  const { rest } = full;
  if (rest === undefined) return { ...view, ...(plugins === undefined ? {} : { plugins }) };
  const shown = <T>(list: readonly T[]): T[] => list.slice(0, SHOWN);
  return {
    ...view,
    rest: {
      links: shown(rest.links).map(ref),
      ...(rest.related === undefined ? {} : { related: shown(rest.related).map(({ source, hits }) => ({ source, hits: shown(hits).map((hit) => ({ id: hit.id, type: hit.type, title: hit.title, linked: hit.linked })) })) }),
      health: shown(rest.health),
      ...(rest.catalogue === undefined ? {} : { catalogue: shown(rest.catalogue).map(({ note, lookalikes }) => ({ note: ref(note), lookalikes: shown(lookalikes).map(ref) })) }),
      ...(rest.marked === undefined ? {} : { marked: shown(rest.marked).map(({ id, type, fields, seq, action, actor, outsideRead }) =>
        ({ note: ref({ id, type, fields }), seq, action, ...(actor === undefined ? {} : { actor }), outsideRead })) }),
      ...(rest.unread === undefined ? {} : { unread: rest.unread }),
      ...(rest.processes === undefined ? {} : { processes: { processes: shown(rest.processes.processes).map(ref), tools: rest.processes.tools } }),
      questions: shown(rest.questions).map(ref),
      counts: {
        links: rest.links.length,
        ...(rest.related === undefined ? {} : { related: rest.related.length }),
        health: rest.health.length,
        ...(rest.catalogue === undefined ? {} : { catalogue: rest.catalogue.length }),
        ...(rest.marked === undefined ? {} : { marked: rest.marked.length }),
        ...(rest.processes === undefined ? {} : { processes: rest.processes.processes.length }),
        questions: rest.questions.length,
      },
    },
    ...(plugins === undefined ? {} : { plugins }),
  };
}

function ref(note: { readonly id: string; readonly type: string; readonly fields: object }): NoteRef {
  const fields = note.fields as Readonly<Record<string, unknown>>;
  return { id: note.id, type: note.type, title: String(fields.title ?? fields.term ?? fields.name ?? note.id) };
}
