// Capability 17 · The library's commands
import { isDeepStrictEqual } from "node:util";

import { titleOf } from "../../knowledge/search/index.js";
import type { RecordType, SchemaRecord } from "../../storage/rules/index.js";
import type { HistoryEntry } from "../../storage/store/index.js";
import { branchIncrement, type LibraryVerbContext } from "../context.js";
import { fieldValue, refusing, verb, VerbRefusal, type VerbAnswer } from "../kit/index.js";
import { dormantSaid } from "./dormant.js";
import { countOf } from "./search.js";

const PLANNED: readonly string[] = ["story", "capability", "contract", "edge"];

function whereOf(clause: string): (fields: Readonly<Record<string, unknown>>) => boolean {
  const at = clause.indexOf("=");
  if (at <= 0) throw new VerbRefusal(`--where is <field>=<value>, not ${JSON.stringify(clause)}`, { misuse: true });
  const field = clause.slice(0, at);
  const text = clause.slice(at + 1);
  const value = fieldValue(text);
  return (fields) => {
    const held = fields[field];
    if (Array.isArray(held) && !Array.isArray(value)) return held.includes(value) || held.includes(text);
    return isDeepStrictEqual(held, value) || held === text;
  };
}

function entryLines({ seq, at, action, type, recordId, actor, reason, outsideRead, record }: HistoryEntry, fields: boolean): string[] {
  return [
    `${seq}  ${at}  ${action}  ${type} ${recordId}  ${actor === undefined ? "writer not recorded" : `by ${actor}`}${reason === undefined ? "" : `: ${reason}`}`,
    ...(outsideRead === undefined || outsideRead.length === 0 ? [] : [`    read outside text first: ${outsideRead.join("; ")}`]),
    ...(fields ? [`    fields: ${JSON.stringify(record.fields)}`] : []),
  ];
}

async function refusePlanned(context: LibraryVerbContext, ids: readonly string[], what: string): Promise<void> {
  const increment = await branchIncrement(context);
  if (increment === undefined) return;
  for (const id of ids) {
    const type = (await context.library.history({ id, newest: 1 }))[0]?.type;
    if (type !== undefined && PLANNED.includes(type)) {
      throw new VerbRefusal(`${what} the ${type} ${id} cannot wait on ${increment} as an edit does, and you hold ${increment} on a branch: run it from a session that holds no increment; nothing was written`);
    }
  }
}

export const LIST = verb({
  command: { family: "library", name: "list", summary: "list the live records of one kind", usage: "library list <kind> [--where <field>=<value> …] [--open] [--all]" },
  tool: { absent: "listing is done on the command line" },
  inputs: {
    kind: { kind: "text", word: 0, describe: "The kind of record to list" },
    where: { kind: "text", many: true, optional: true, describe: "Keep only records whose field holds this value: <field>=<value>; a list field matches a member" },
    all: { kind: "switch", describe: "List every one" },
    open: { kind: "switch", describe: "Keep only open increments, proposed or active" },
  },
  async act({ kind, where, open, all }, context: LibraryVerbContext): Promise<VerbAnswer> {
    const dormant = await dormantSaid(context, [kind]);
    if (dormant.length > 0) return { text: dormant.join("\n") };
    if (open && kind !== "increment") throw new VerbRefusal(`--open keeps the open increments, so it lists increments, not ${kind} records`, { misuse: true });
    const matches = where.map(whereOf);
    const records = ((await refusing(() => context.library.list(kind as RecordType))) as SchemaRecord[]).filter(({ fields }) => {
      const held = fields as Readonly<Record<string, unknown>>;
      return matches.every((match) => match(held)) && (!open || held["status"] !== "closed");
    });
    const settled = kind === "friction" && !all && !where.some((clause) => clause.startsWith("state="))
      ? records.filter(({ fields }) => ["resolved", "dismissed"].includes(String((fields as { readonly state?: unknown }).state)))
      : [];
    const shown = records.filter((record) => !settled.includes(record));
    const leftOut = settled.length === 0 ? [] : [`${settled.length} settled (resolved or dismissed) left out; --all lists them.`];
    if (shown.length === 0) return { text: [`No ${kind} records.`, ...leftOut].join("\n") };
    return { text: [`${shown.length} ${kind} records:`, ...shown.map((record) => `  ${record.id}  ${titleOf(record)}`), ...leftOut].join("\n") };
  },
});

export const HISTORY = verb({
  command: { family: "library", name: "history", summary: "the history entries of a record, or of the library", usage: "library history [<id>] [--fields]" },
  tool: { absent: "history is read on the command line" },
  inputs: {
    id: { kind: "text", word: 0, optional: true, describe: "The record whose history to show" },
    fields: { kind: "switch", describe: "Show each entry's fields too" },
  },
  async act({ id, fields }, context: LibraryVerbContext): Promise<VerbAnswer> {
    const entries = await context.library.history(id === undefined ? {} : { id });
    if (entries.length === 0) return { text: id === undefined ? "No history yet." : `No history for ${id}.` };
    return { text: entries.flatMap((entry) => entryLines(entry, fields)).join("\n") };
  },
});

export const REVERT = verb({
  command: { family: "library", name: "revert", summary: "write a record back to an entry its history shows", usage: "library revert <id> --to <seq> --read <seq> [--reason <why>]" },
  tool: { absent: "reverting is done on the command line" },
  inputs: {
    id: { kind: "text", word: 0, describe: "The record to revert" },
    to: { kind: "text", describe: "The seq of the entry to write it back to" },
    read: { kind: "text", describe: "The seq of its newest entry, as you read it" },
    reason: { kind: "text", optional: true, describe: "Why it is reverted" },
  },
  writes: true,
  async act({ id, to, read, reason }, context: LibraryVerbContext): Promise<VerbAnswer> {
    const target = countOf("to", to)!;
    const newest = countOf("read", read)!;
    await refusePlanned(context, [id], "A revert of");
    await refusing(() => context.library.revert(id, target, newest, { ...context.writer, ...(reason === undefined ? {} : { reason }) }));
    return { text: `Reverted ${id} to entry ${target}.`, data: { id } };
  },
});

export const UNDO = verb({
  command: { family: "library", name: "undo", summary: "write every record one writer wrote back to before that writer's first write", usage: "library undo <writer> [--reason <why>]" },
  tool: { absent: "undoing a writer is done on the command line" },
  inputs: {
    actor: { kind: "text", word: 0, describe: "The writer whose writes to undo" },
    reason: { kind: "text", optional: true, describe: "Why they are undone" },
  },
  writes: true,
  async act({ actor, reason }, context: LibraryVerbContext): Promise<VerbAnswer> {
    const wrote = [...new Set((await context.library.history({ actor })).map(({ recordId }) => recordId))];
    await refusePlanned(context, wrote, "Undoing a write to");
    const reverted = await refusing(() => context.library.revertWrites(actor, { ...context.writer, ...(reason === undefined ? {} : { reason }) }));
    if (reverted.length === 0) return { text: `${actor} wrote nothing to revert.` };
    const lines = reverted.map(({ id, action, to }) => `  ${id}  ${action}${to === undefined ? "" : ` back to entry ${to}`}`);
    return { text: [`Reverted ${reverted.length} ${reverted.length === 1 ? "record" : "records"} ${actor} wrote:`, ...lines].join("\n") };
  },
});

export const MOVE_TO_EDGES = verb({
  command: { family: "library", name: "move-to-edges", summary: "move stored same-story dependsOn ids onto edges", usage: "library move-to-edges" },
  tool: { absent: "the move is done on the command line" },
  inputs: {},
  writes: true,
  async act(_input, context: LibraryVerbContext): Promise<VerbAnswer> {
    const moved = await refusing(() => context.library.moveDependsOnToEdges(context.writer));
    if (moved.edges.length === 0) return { text: "Every same-story dependsOn is on an edge already: nothing to move." };
    const links = `${moved.edges.length} ${moved.edges.length === 1 ? "link" : "links"}`;
    const from = `${moved.capabilities.length} ${moved.capabilities.length === 1 ? "capability" : "capabilities"}`;
    return { text: `Moved ${links} onto edges, from ${from}.` };
  },
});
