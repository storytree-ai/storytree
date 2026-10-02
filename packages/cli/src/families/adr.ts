/**
 * Capability 6 · Decisions (the command line story): record a new decision with the next number, its
 * status, who decided it in their own words, and what it supersedes. Pull a decision out as a
 * markdown file, edit it, push it back, and write its composed statement (the owner's C2).
 *
 * - Every rule is the library's (its capability 13): numbers handed out inside the write, status,
 *   supersession and its loop check, the owner's words a stamp claiming his authority must quote,
 *   and whether a composed statement is stale.
 * - The file `adr pull` writes: a front matter of `key: <JSON value>` lines, then `# <title>`, a
 *   blank line, and the text. `push` hands the library's `editNote` only what differs from the
 *   stored decision, so a push with no edit writes nothing. The lines below `# read only` (its id,
 *   number, how it reads, its authority and composed statement) are shown, never pushed.
 * - A decision is named by its id or number. Listing uses list(kind), then decision(id) so the
 *   library owns supersession and the status shown or filtered.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import type { DecisionView, Library } from "@storytree/library";

import { Refusal } from "../answer.js";
import { commaSeparatedIds, type Args } from "../args.js";
import type { Family, Verb } from "../door.js";
import { person } from "../writer.js";

/** The fields a pushed file may change, in the order the file shows them. */
const EDITABLE = ["status", "decided", "loadBearing", "supersedes", "links", "frontCoverOf"] as const;
const READ_ONLY_MARK = "# read only";

/** "ADR-0007": a decision's number as people say it. */
function adr(number: number | undefined): string {
  return number === undefined ? "an unnumbered decision" : `ADR-${String(number).padStart(4, "0")}`;
}

function listFrom(args: Args, name: string): string[] | undefined {
  const value = args.text(name);
  return value === undefined ? undefined : commaSeparatedIds(value, name);
}

async function viewOf(library: Library, name: string): Promise<DecisionView> {
  const number = /^(?:adr-)?(\d+)$/i.exec(name)?.[1];
  const id = number === undefined ? name : (await library.list("decision")).find((record) => record.fields.number === Number(number))?.id;
  if (id === undefined) throw new Refusal(`no decision "${name}" in this project`);
  const view = await library.decision(id);
  if (view === null) throw new Refusal(`no decision "${name}" in this project`);
  return view;
}

/** A decision as the file `adr pull` writes. */
function fileOf(view: DecisionView): string {
  const fields = view.record.fields;
  const lines = ["---"];
  for (const key of EDITABLE) if (fields[key] !== undefined) lines.push(`${key}: ${JSON.stringify(fields[key])}`);
  lines.push(READ_ONLY_MARK, `id: ${JSON.stringify(view.record.id)}`);
  if (fields.number !== undefined) lines.push(`number: ${fields.number}`);
  lines.push(`reads-as: ${JSON.stringify(view.status)}`);
  if (view.supersededBy.length > 0) lines.push(`superseded-by: ${JSON.stringify(view.supersededBy)}`);
  if (fields.authority !== undefined) lines.push(`authority: ${JSON.stringify(fields.authority)}`);
  if (view.composed !== undefined) {
    lines.push(`composed: ${JSON.stringify(view.composed.statement)}`);
    if (view.composed.stale) lines.push(`composed-reads: "stale: the text has changed since it was composed"`);
  }
  lines.push("---", "", `# ${fields.title}`, "", fields.text.replace(/\s+$/, ""), "");
  return lines.join("\n");
}

/** What a file `adr pull` wrote says, now: its title, text and editable fields. */
function parseFile(text: string, file: string): { title: string; text: string; fields: Record<string, unknown> } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const close = lines.indexOf("---", 1);
  if (lines[0] !== "---" || close === -1) throw new Refusal(`${file} is not a decision file: it starts with a --- front matter, as \`storytree adr pull\` writes it`);
  const fields: Record<string, unknown> = {};
  for (const line of lines.slice(1, close)) {
    if (line === READ_ONLY_MARK) break;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    if (!(EDITABLE as readonly string[]).includes(key)) throw new Refusal(`${file}: "${key}" is not a field push changes (${EDITABLE.join(", ")})`);
    try {
      fields[key] = JSON.parse(line.slice(colon + 1).trim());
    } catch {
      throw new Refusal(`${file}: the value of "${key}" is not JSON: ${line.slice(colon + 1).trim()}`);
    }
  }
  const body = lines.slice(close + 1);
  const heading = body.findIndex((line) => line.startsWith("# "));
  if (heading === -1) throw new Refusal(`${file} has no "# <title>" line`);
  const rest = body.slice(heading + 1).join("\n").replace(/^\n/, "").replace(/\s+$/, "");
  return { title: body[heading]!.slice(2).trim(), text: rest, fields };
}

const create: Verb = {
  name: "new",
  usage:
    "adr new --title <t> --text <text|@file> --status <proposed|accepted> [--number <n>] [--decided YYYY-MM-DD] [--basis <owner-directed|owner-ratified|agent-derived|agent-flipped> --owner-said <his words|@file>] [--supersedes a,b] [--links a,b] [--front-cover-of <node>] [--load-bearing]",
  summary: "record a decision with a supplied or next number, its status, who decided it, and what it supersedes",
  switches: ["load-bearing"],
  async act(args, context) {
    const basis = args.text("basis");
    const ownerSaid = args.text("owner-said");
    const optional: Record<string, unknown> = {
      number: args.has("number") ? decisionNumber(args.need("number", this.usage)) : undefined,
      decided: args.text("decided"),
      supersedes: listFrom(args, "supersedes"),
      links: listFrom(args, "links"),
      frontCoverOf: args.text("front-cover-of"),
      loadBearing: args.has("load-bearing") ? true : undefined,
      authority: basis === undefined ? undefined : { basis, scribedBy: person(), at: new Date().toISOString(), ...(ownerSaid === undefined ? {} : { ownerSaid }) },
    };
    const fields = { title: args.text("title"), text: args.text("text"), status: args.text("status"), ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined)) };
    const decision = await (await context.library()).recordDecision(fields as never, context.writer());
    return {
      text: `Recorded ${adr(decision.fields.number)} (${decision.id}), ${decision.fields.status}.`,
      next: [{ command: `storytree adr pull ${decision.id} --out ${decision.id}.md`, why: "read or edit it as a file" }],
    };
  },
};

/** Reject typos instead of silently auto-numbering or rounding a supplied label. */
function decisionNumber(value: string): number {
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < 1) {
    throw new Refusal(`decision number must be a positive safe integer, not ${JSON.stringify(value)}`);
  }
  return number;
}

const pull: Verb = {
  name: "pull",
  usage: "adr pull <decision> [--out <file>]",
  summary: "a decision as a markdown file, to read or edit",
  async act(args, context) {
    const id = args.word(0, "the decision's id", this.usage);
    const file = fileOf(await viewOf(await context.library(), id));
    const out = args.text("out");
    if (out === undefined) return { text: file };
    writeFileSync(path.resolve(context.cwd, out), file);
    return { text: `Pulled ${id} to ${out}. Once you have edited it: storytree adr push ${id} --file ${out}` };
  },
};

const push: Verb = {
  name: "push",
  usage: "adr push <decision> --file <file>",
  summary: "write back what you changed in a pulled file, and nothing else",
  async act(args, context) {
    const name = args.word(0, "the decision's id or number", this.usage);
    const file = args.need("file", this.usage);
    const pushed = parseFile(args.read(`@${file}`), file);
    const library = await context.library();
    const record = (await viewOf(library, name)).record;
    const id = record.id;
    const stored = record.fields as Record<string, unknown>;
    const changes: Record<string, unknown> = {};
    if (pushed.title !== stored.title) changes.title = pushed.title;
    if (pushed.text !== String(stored.text).replace(/\s+$/, "")) changes.text = pushed.text;
    for (const key of EDITABLE) {
      if (JSON.stringify(pushed.fields[key]) !== JSON.stringify(stored[key])) changes[key] = pushed.fields[key];
    }
    const names = Object.keys(changes);
    if (names.length === 0) return { text: `No change: ${file} says what ${id} already says.` };
    await library.editNote(id, changes as never, context.writer());
    return { text: `Pushed ${id}: ${names.join(", ")}.`, next: [{ command: `storytree adr pull ${id}`, why: "read it back" }] };
  },
};

const compose: Verb = {
  name: "compose",
  usage: "adr compose <decision> --statement <text|@file>",
  summary: "write a decision's one composed statement, beside its text",
  async act(args, context) {
    const name = args.word(0, "the decision's id or number", this.usage);
    const library = await context.library();
    const id = (await viewOf(library, name)).record.id;
    const composed = await library.composeStatement(id, args.text("statement") as string, context.writer());
    if (composed === null) throw new Refusal(`no decision "${id}" in this project`);
    return { text: `Composed ${id}'s statement.` };
  },
};

const list: Verb = {
  name: "list",
  usage: "adr list [--current] [--status <s>] [--load-bearing]",
  summary: "the decisions: current (accepted), by status, load-bearing",
  switches: ["current", "load-bearing"],
  async act(args, context) {
    const library = await context.library();
    const lines: string[] = [];
    for (const view of await library.decisions()) {
      if (args.has("current") && view.status !== "accepted") continue;
      if (args.has("status") && view.status !== args.text("status")) continue;
      if (args.has("load-bearing") && !view.record.fields.loadBearing) continue;
      const fields = view.record.fields;
      lines.push(`  ${adr(fields.number)}  ${view.record.id}  [${view.status}]${fields.loadBearing ? "  load-bearing" : ""}  ${fields.title}`);
    }
    return {
      text: lines.length === 0 ? "No decisions match." : [`${lines.length} decisions:`, ...lines].join("\n"),
      next: [{ command: "storytree adr pull <id|number>", why: "read one whole" }],
    };
  },
};

export const decisions: Family = {
  name: "adr",
  summary: "the decision log: new, pull, push, compose, list",
  verbs: [list, create, pull, push, compose],
  guesses: { show: "adr pull <decision>", read: "adr pull <decision>", get: "adr pull <decision>", open: "adr pull <decision>" },
};
