/**
 * Capability 27 · Fixed data questions: the `library count`, `changes` (the latest, or one writer's as a diff) and `find` commands, mounted in the library
 * family beside capability 17's (commands/index.ts). Each asks one of data-questions.ts's fixed questions and answers
 * in plain text, at most ANSWER_ROWS rows, each value cut to one short line. None is a tool: the voice door mounts the
 * questions it needs itself.
 */
import type { Library } from "../index.js";
import { ANSWER_ROWS, type TitleHit } from "./data-questions.js";
import { verb, VerbRefusal, type VerbContext } from "../verbs/verb.js";

/** The longest a value is shown: past it, it is cut, so no answer runs long. */
const SHOWN = 80;

/** `value`'s first line, cut at SHOWN characters; a blank for none. */
function cut(value: string | null): string {
  const line = (value ?? "").split(/\r?\n/, 1)[0] ?? "";
  return line.length > SHOWN ? `${line.slice(0, SHOWN - 1)}…` : line;
}

/** "ADR-1103", "adr-1103" or "1103": the number it names, else undefined. */
export function decisionNumber(name: string): number | undefined {
  const digits = /^(?:adr-)?(\d{1,15})$/i.exec(name.trim())?.[1];
  return digits === undefined ? undefined : Number(digits);
}

const NOT_A_TOOL = { absent: "the voice door mounts the fixed data questions it needs itself" } as const;

export const count = verb({
  command: { family: "library", name: "count", summary: "how many live records of each kind and status, and the arcs with the most open increments", usage: "library count" },
  tool: NOT_A_TOOL,
  inputs: {},
  async act(_inputs, context: VerbContext) {
    const { kinds, openByArc } = await context.library.counts();
    const width = Math.max(0, ...kinds.map(({ kind }) => kind.length));
    const lines = kinds.map(({ kind, count, statuses }) => `  ${kind.padEnd(width)}  ${count}${statuses.length === 0 ? "" : `: ${statuses.map(({ status, count }) => `${status} ${count}`).join(", ")}`}`);
    const arcs = openByArc.length === 0 ? ["  none"] : openByArc.map(({ arc, title, open }) => `  ${open} open  ${arc}  ${cut(title)}`);
    return { text: ["Live records by kind:", ...(lines.length === 0 ? ["  none"] : lines), "", "Open increments by arc:", ...arcs].join("\n") };
  },
});

export const changes = verb({
  command: {
    family: "library",
    name: "changes",
    summary: `the latest changes, newest first, health left out (${ANSWER_ROWS} unless --limit asks for fewer); with --actor, every record one writer wrote, each field from before its first write to after its last`,
    usage: "library changes [--limit <n> | --actor <writer>]",
  },
  tool: NOT_A_TOOL,
  inputs: {
    limit: { kind: "text", optional: true, describe: `how many to show, ${ANSWER_ROWS} at most` },
    actor: { kind: "text", optional: true, describe: "a writer, as history names them (session:<id> or person:<name>): every record they wrote, as one diff" },
  },
  async act({ limit, actor }, context: VerbContext) {
    if (actor !== undefined) {
      if (limit !== undefined) throw new VerbRefusal("--actor shows every record the writer wrote, so it takes no --limit", { misuse: true });
      return writerDiff(actor, context.library);
    }
    if (limit !== undefined && !(/^[1-9]\d*$/.test(limit) && Number(limit) <= ANSWER_ROWS)) {
      throw new VerbRefusal(`--limit is how many to show, a whole number from 1 to ${ANSWER_ROWS}; got "${limit}"`, { misuse: true });
    }
    const latest = await context.library.latestChanges(limit === undefined ? ANSWER_ROWS : Number(limit));
    if (latest.length === 0) return { text: "No changes yet." };
    const lines = latest.map((change) => `  ${change.seq}  ${change.at.slice(0, 16).replace("T", " ")}  ${change.action}  ${change.type}  ${change.id}  ${cut(change.title)}`.trimEnd());
    return { text: ["Latest changes, newest first:", ...lines].join("\n"), next: [{ command: "library read <id>", why: "read one whole" }] };
  },
});

/** Every record `actor` wrote, by id, with each field that differs from before their first write to after their last, whole. */
async function writerDiff(actor: string, library: Library): Promise<{ text: string; next?: { command: string; why: string }[] }> {
  const written = await library.writtenBy(actor);
  if (written.length === 0) return { text: `${actor} wrote nothing (health left out).` };
  const said = (value: unknown): string => (value === null || value === undefined ? "(none)" : typeof value === "string" ? value : JSON.stringify(value));
  const lines = written.flatMap(({ id, type, writes, before, after, retired, later }) => {
    const what = after === null ? `retired${retired === undefined ? "" : `: ${retired}`}` : before === null ? "created" : `updated by ${writes} write${writes === 1 ? "" : "s"}`;
    const was = (before?.fields ?? {}) as Record<string, unknown>;
    const now = (after?.fields ?? {}) as Record<string, unknown>;
    const fields = after === null ? [] : [...new Set([...Object.keys(was), ...Object.keys(now)])]
      .filter((field) => JSON.stringify(was[field]) !== JSON.stringify(now[field]))
      .map((field) => `    ${field}: ${said(was[field])} -> ${said(now[field])}`);
    const since = later === undefined ? [] : [`    written since by ${later.actor ?? "a writer who gave no name"} at entry ${later.seq}: library undo refuses while it stands`];
    return [`  ${id}  [${type}]  ${what}`, ...fields, ...since];
  });
  return {
    text: [`${actor} wrote ${written.length} record${written.length === 1 ? "" : "s"} (health left out), each from before its first write to after its last:`, ...lines].join("\n"),
    next: [{ command: `library undo ${actor}`, why: "revert them all" }, { command: "library history <id>", why: "see one record's every entry" }],
  };
}

export const find = verb({
  command: { family: "library", name: "find", summary: `the records whose title holds every word, any case, ${ANSWER_ROWS} at most; a decision by its number (1103 or ADR-1103)`, usage: "library find <title words…|decision number>" },
  tool: NOT_A_TOOL,
  inputs: { words: { kind: "text", word: 0, many: true, optional: true, blank: true, describe: "the title's words, or a decision's number" } },
  async act({ words }, context: VerbContext) {
    const given = words.flatMap((word) => word.split(/\s+/)).filter((word) => word !== "");
    if (given.length === 0) throw new VerbRefusal("this needs a title's words, or a decision's number", { misuse: true });
    const number = given.length === 1 ? decisionNumber(given[0]!) : undefined;
    const hits = number === undefined ? await context.library.findByTitle(given) : [await context.library.decisionNumbered(number)].filter((hit): hit is TitleHit => hit !== null);
    const asked = number === undefined ? `titles holding "${given.join(" ")}"` : `decision number ${number}`;
    if (hits.length === 0) return { text: `No ${asked}.` };
    const lines = hits.map((hit) => `  ${hit.id}  [${hit.type}]  ${cut(hit.title)}`);
    return { text: [`${hits.length === ANSWER_ROWS ? `The first ${ANSWER_ROWS} ` : ""}${asked}:`, ...lines].join("\n"), next: [{ command: "library read <id>", why: "read one whole" }] };
  },
});

/** The live decision `name` numbers (1103 or ADR-1103), its id; undefined when `name` is no number. */
export async function decisionNamed(library: Library, name: string): Promise<string | undefined> {
  const number = decisionNumber(name);
  if (number === undefined) return undefined;
  const hit = await library.decisionNumbered(number);
  if (hit === null) throw new VerbRefusal(`no decision numbered ${number} in this project`);
  return hit.id;
}
