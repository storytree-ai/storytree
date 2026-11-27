// Capability 27 · Fixed data questions
import { isDeepStrictEqual } from "node:util";

import type { Library } from "../../index.js";
import type { SchemaRecord } from "../../storage/rules/index.js";
import type { LibraryVerbContext } from "../context.js";
import { verb, VerbRefusal, type VerbAnswer } from "../kit/index.js";
import { countOf } from "../library/search.js";
import { decisionNumberOf, MOST_ROWS, type WriterChange } from "./questions.js";

const TITLE_CUT = 80;

function cut(title: string | null): string {
  const text = title ?? "";
  return text.length > TITLE_CUT ? `${text.slice(0, TITLE_CUT - 1)}…` : text;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function valueSaid(value: unknown): string {
  return value === undefined ? "(none)" : typeof value === "string" ? value : JSON.stringify(value);
}

function fieldsOf(record: SchemaRecord | null): Readonly<Record<string, unknown>> {
  return (record?.fields ?? {}) as Readonly<Record<string, unknown>>;
}

function writerLines({ id, type, writes, before, after, retired, later }: WriterChange): string[] {
  const done = retired !== undefined ? `retired: ${retired}` : before === null ? "created" : `updated by ${plural(writes, "write", "writes")}`;
  const was = fieldsOf(before);
  const now = fieldsOf(after);
  const changed = retired !== undefined ? [] : [...new Set([...Object.keys(now), ...Object.keys(was)])].filter((field) => !isDeepStrictEqual(was[field], now[field]));
  return [
    `  ${id}  [${type}]  ${done}`,
    ...changed.map((field) => `    ${field}: ${valueSaid(was[field])} -> ${valueSaid(now[field])}`),
    ...(later === undefined ? [] : [`    written since by ${later.actor ?? "a writer who gave no name"} at entry ${later.seq}`]),
  ];
}

export async function decisionNamed(library: Library, name: string): Promise<string> {
  const number = decisionNumberOf(name);
  if (number === undefined) return name;
  return (await library.decisionNumbered(number))?.id ?? name;
}

export const COUNT = verb({
  command: { family: "library", name: "count", summary: "how many live records of each kind and status, and open increments by arc", usage: "library count" },
  tool: { absent: "counting is done on the command line" },
  inputs: {},
  async act(_input, context: LibraryVerbContext): Promise<VerbAnswer> {
    const { kinds, openByArc } = await context.library.counts();
    const width = Math.max(0, ...kinds.map(({ kind }) => kind.length));
    return {
      text: [
        "Live records by kind:",
        ...kinds.map(({ kind, count, statuses }) => `  ${kind.padEnd(width)}  ${count}${statuses.length === 0 ? "" : `: ${statuses.map(({ status, count: held }) => `${status} ${held}`).join(", ")}`}`),
        ...(openByArc.length === 0 ? [] : ["Open increments by arc:", ...openByArc.map(({ arc, title, open }) => `  ${open} open  ${arc}  ${title ?? ""}`.trimEnd())]),
      ].join("\n"),
    };
  },
});

export const CHANGES = verb({
  command: { family: "library", name: "changes", summary: "the latest changes, newest first, or every record one writer wrote", usage: "library changes [--limit <n>] [--actor <writer>]" },
  tool: { absent: "changes are read on the command line" },
  inputs: {
    limit: { kind: "text", optional: true, describe: `How many changes to give, ${MOST_ROWS} at most and unless given` },
    actor: { kind: "text", optional: true, describe: "The writer whose records to show, all of them" },
  },
  async act({ limit, actor }, context: LibraryVerbContext): Promise<VerbAnswer> {
    if (actor !== undefined) {
      if (limit !== undefined) throw new VerbRefusal("--actor shows every record the writer wrote, so it takes no --limit", { misuse: true });
      const changes = await context.library.writtenBy(actor);
      if (changes.length === 0) return { text: `${actor} wrote nothing.` };
      return { text: [`${actor} wrote ${plural(changes.length, "record", "records")}:`, ...changes.flatMap(writerLines)].join("\n") };
    }
    const count = countOf("limit", limit) ?? MOST_ROWS;
    if (count > MOST_ROWS) throw new VerbRefusal(`--limit is ${MOST_ROWS} at most, not ${count}`, { misuse: true });
    const changes = await context.library.latestChanges(count);
    if (changes.length === 0) return { text: "No changes yet." };
    return {
      text: [
        `The latest ${plural(changes.length, "change", "changes")}, newest first:`,
        ...changes.map(({ seq, at, action, type, id, title }) => `  ${seq}  ${at}  ${action}  ${type}  ${id}  ${cut(title)}`.trimEnd()),
      ].join("\n"),
    };
  },
});

export const FIND = verb({
  command: { family: "library", name: "find", summary: "the live records whose title holds every word, or a decision by its number", usage: "library find <words> … [--history]" },
  tool: { absent: "finding by title is done on the command line" },
  inputs: {
    words: { kind: "text", word: 0, many: true, describe: "The words every title found holds, or a decision's number" },
    history: { kind: "switch", describe: "Bring back resteers, friction and superseded decisions too" },
  },
  async act({ words, history }, context: LibraryVerbContext): Promise<VerbAnswer> {
    const hits = await context.library.findByTitle(words, { history });
    if (hits.length === 0) return { text: `No titles holding "${words.join(" ")}".` };
    return { text: [`${plural(hits.length, "title holds", "titles hold")} "${words.join(" ")}":`, ...hits.map(({ id, type, title }) => `  ${id}  [${type}]  ${cut(title)}`)].join("\n") };
  },
});
