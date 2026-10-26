/**
 * Capability 26 · Rounds (The library story, its curation tooling): when the librarian's pass runs, and what it looks
 * at. Graduation is due at every landing, because only this session knows what it learned; the friction drain is
 * Friction's own, which the landing's pass drains apart from this worklist (ADR-1077 D4); the
 * rest is due when the library's change feed since the session started shows a write to a curated
 * kind, and when there is no start to read from, since the trigger fires when unsure (0.2's
 * `pre-merge-librarian-pass`). The worklist gathers each capability's list into one report.
 *
 * A plugin's curation guidance (ADR-1178 D5) is a process or agent record titled `<plugin>: …`. It is offered for that
 * plugin's own kinds only, when one of them was written since the session started (or with no start), beneath every
 * core list and framed as plugin-supplied: a plugin kind's write makes its plugin's guidance due and nothing else.
 */
import type { Library, Related, SchemaRecord } from "../../index.js";

import { newNotes, type NewNote } from "../catalogue/index.js";
import { brokenEdges, type BrokenEdge } from "../decision-log/index.js";
import { memoryWorklist, processGaps, type MemoryItem, type ProcessGaps } from "../graduation/index.js";
import { relatedUnlinked, unrestedDecisions } from "../links/index.js";
import { allNotes } from "../notes.js";
import { openQuestions } from "../lapsed-questions/index.js";

/** The curated kinds: a write to any of them since the session started makes the whole pass due. */
export const CURATED: readonly string[] = ["decision", "question", "principle", "guardrail", "pattern", "process", "definition", "agent"];

/** What the pass has to do: graduation always, the rest when the trigger fired. */
export interface RoundDue {
  readonly graduation: true;
  readonly rest: boolean;
  /** The plugins whose kinds were written since the start, or every one with no start, when their kinds are named. */
  readonly plugins?: readonly string[];
}

/** A due plugin's curation guidance, offered beneath the core lists for its own kinds only. */
export interface PluginGuidance {
  readonly plugin: string;
  /** Its kinds, each `<plugin>.<kind>`: the only records its guidance applies to. */
  readonly kinds: readonly string[];
  /** Its process and agent records titled `<plugin>: …`. */
  readonly guidance: SchemaRecord<"process" | "agent">[];
  /** How a session is to read it: plugin-supplied, for its kinds only, never loosening a core rule. */
  readonly framing: string;
}

/** What the worklist is gathered from. */
export interface WorklistOptions {
  /** The change feed's cursor when the session started. Without it the trigger fires. */
  readonly since?: number;
  /** The agent's memory folders. */
  readonly memoryFolders?: readonly string[];
  /** The tools served, to match against the processes; without them, processes are not matched. */
  readonly tools?: readonly string[];
  readonly now?: Date;
  /** Told each phase as it starts; a rejection stops the worklist before that phase reads anything. */
  readonly progress?: (phase: string) => Promise<void>;
  /** The kinds the mounted plugins declare, each `<plugin>.<kind>`; without them, no plugin's guidance is offered. */
  readonly pluginKinds?: readonly string[];
}

/** The librarian's worklist: each capability's list. */
export interface Worklist {
  /** Graduation (4): memories new, changed or lapsed. Always there. */
  readonly graduation: MemoryItem[];
  /** The rest, when the trigger fired. */
  readonly rest?: {
    /** Links (1): accepted decisions on no shelf that nothing rests on. */
    readonly links: SchemaRecord<"decision">[];
    /** Links (1): related but unlinked neighbours for notes written since the session started; unread with no start. */
    readonly related?: Related[];
    /** Decision log (2), the health report: edges to records no longer live. */
    readonly health: BrokenEdge[];
    /** Catalogue (3): notes written new since the session started, with what might already cover them; unread with no start. */
    readonly catalogue?: NewNote[];
    /** Why a list was left unread: with no session start, which notes it wrote is unknown. */
    readonly unread?: string;
    /** Graduation (4): processes and tools that match nothing, when the tools served are known. */
    readonly processes?: ProcessGaps;
    /** Lapsed questions (5): open questions whose review lease has lapsed, longest lapsed first. */
    readonly questions: SchemaRecord<"question">[];
  };
  /** Each due plugin's guidance that has any, after every core list. */
  readonly plugins?: PluginGuidance[];
}

/** Whether the pass is due: graduation always; the rest on a curated write since `since`, or with no `since`. */
export async function roundDue(library: Library, { since, pluginKinds }: { since?: number; pluginKinds?: readonly string[] }): Promise<RoundDue> {
  const plugins = pluginKinds === undefined ? {} : { plugins: await pluginsDue(library, since, pluginKinds) };
  if (since === undefined) return { graduation: true, rest: true, ...plugins };
  // Whether one curated change came after `since`: one entry at most, never the changes themselves (6.6).
  const curated = await library.history({ since, types: CURATED, oldest: 1 });
  return { graduation: true, rest: curated.length > 0, ...plugins };
}

/** The plugins one of whose kinds was written after `since`, one entry at most each; every plugin with no `since`. */
async function pluginsDue(library: Library, since: number | undefined, pluginKinds: readonly string[]): Promise<string[]> {
  const due: string[] = [];
  for (const [plugin, kinds] of byPlugin(pluginKinds)) {
    if (since === undefined || (await library.history({ since, types: kinds, oldest: 1 })).length > 0) due.push(plugin);
  }
  return due;
}

/** Each plugin's kinds, in the order they were named. */
function byPlugin(pluginKinds: readonly string[]): Map<string, string[]> {
  const plugins = new Map<string, string[]>();
  for (const kind of pluginKinds) {
    const plugin = kind.split(".")[0]!;
    plugins.set(plugin, [...(plugins.get(plugin) ?? []), kind]);
  }
  return plugins;
}

/** The due plugins' guidance, each with its kinds and framing; a plugin with no guidance is left out. */
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

/** Gather the worklist: graduation's list always, the rest when the trigger fired. */
export async function worklist(library: Library, options: WorklistOptions): Promise<Worklist> {
  const phase = async (name: string): Promise<void> => options.progress?.(name);
  await phase("graduation");
  const graduation = await memoryWorklist(options.memoryFolders ?? [], options.now === undefined ? {} : { now: options.now });
  await phase("trigger");
  const due = await roundDue(library, options);
  // Beneath every core list, so read after them: a plugin's guidance never comes before a core rule.
  const plugins = async (): Promise<{ plugins?: PluginGuidance[] }> => {
    if (due.plugins === undefined || due.plugins.length === 0) return {};
    await phase("plugins");
    const offered = await pluginGuidance(library, due.plugins, options.pluginKinds ?? []);
    return offered.length === 0 ? {} : { plugins: offered };
  };
  if (!due.rest) return { graduation, ...(await plugins()) };
  const { since } = options;
  // The live notes, read once for every list that needs them (6.7).
  const notes = await allNotes(library);
  await phase("links");
  const links = await unrestedDecisions(library, notes);
  // With no start the notes this session wrote are unknown; every note's history is never read instead (6.7).
  if (since !== undefined) await phase("related");
  const related = since === undefined ? undefined : await relatedUnlinked(library, since, notes);
  await phase("health");
  const health = await brokenEdges(library, notes);
  if (since !== undefined) await phase("catalogue");
  const catalogue = since === undefined ? undefined : await newNotes(library, since, notes);
  if (options.tools !== undefined) await phase("processes");
  const processes = options.tools === undefined ? undefined : await processGaps(library, options.tools, notes);
  await phase("questions");
  const questions = await openQuestions(library, options.now);
  const offered = await plugins();
  return {
    graduation,
    rest: {
      links,
      ...(related === undefined || catalogue === undefined
        ? { unread: "No session start is recorded, so the notes this session wrote are unknown: the catalogue and related lists were not gathered. Search for each note you wrote, and read its related notes, by hand." }
        : { related, catalogue }),
      health,
      ...(processes === undefined ? {} : { processes }),
      questions,
    },
    ...offered,
  };
}

/** How many items of each rest list a session is shown; the counts say how many there are. */
export const SHOWN = 5;

/** A note named by what a session needs to pick it: its ID, kind and title. Read it whole with its ID. */
export interface NoteRef {
  readonly id: string;
  readonly type: string;
  readonly title: string;
}

/**
 * The worklist as a session reads it (6.9): graduation whole, and each rest list's first few items, named only, with how many each holds. The full
 * records once took fifteen million characters; any one is read whole by its ID.
 */
export interface WorklistView {
  readonly graduation: MemoryItem[];
  readonly rest?: {
    readonly links: NoteRef[];
    readonly related?: { source: string; hits: (NoteRef & { readonly linked: boolean })[] }[];
    readonly health: BrokenEdge[];
    readonly catalogue?: { note: NoteRef; lookalikes: NoteRef[] }[];
    readonly unread?: string;
    readonly processes?: { processes: NoteRef[]; tools: string[] };
    readonly questions: NoteRef[];
    /** How many each list holds, of which the first few are shown. */
    readonly counts: { links: number; related?: number; health: number; catalogue?: number; processes?: number; questions: number };
  };
  /** Each due plugin's guidance, named, after the core lists. */
  readonly plugins?: { plugin: string; kinds: readonly string[]; guidance: NoteRef[]; framing: string }[];
}

/** Bound a worklist to what a session can read: SHOWN items a list, named only, with counts. */
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
      ...(rest.unread === undefined ? {} : { unread: rest.unread }),
      ...(rest.processes === undefined ? {} : { processes: { processes: shown(rest.processes.processes).map(ref), tools: rest.processes.tools } }),
      questions: shown(rest.questions).map(ref),
      counts: {
        links: rest.links.length,
        ...(rest.related === undefined ? {} : { related: rest.related.length }),
        health: rest.health.length,
        ...(rest.catalogue === undefined ? {} : { catalogue: rest.catalogue.length }),
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
