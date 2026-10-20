/**
 * Capability 13 · Decision log. The `adr` verbs, declared here beside the library's own commands (ADR-0969 D2, ADR-1077
 * D2) and mounted by the command line as its `adr` family, 4th among `storytree`'s families (ADR-1033): record a new
 * decision with the next number, its status, who decided it in their own words, and what it supersedes; pull a decision
 * out as a markdown file, edit it, push it back; write its composed statement; list them.
 * None is a tool: an agent reads a decision with the MCP server's `open` and records one with its `write_note`.
 *
 * - Every rule is the library's own (knowledge/decision-log.ts): numbers handed out inside the write, status,
 *   supersession and its loop check, the owner's words a stamp claiming his authority must quote, and whether a composed
 *   statement is stale.
 * - The file `adr pull` writes: a front matter of `key: <JSON value>` lines, then `# <title>`, a blank line, and the
 *   text. `push` hands the library's `editNote` only what differs from the stored decision, so a push with no edit
 *   writes nothing, and names no writer. The lines below `# read only` (its id, number, how it reads, its authority and
 *   composed statement) are shown, never pushed.
 * - A decision is named by its id or number. Listing uses list(kind), then decision(id) so the library owns
 *   supersession and the status shown or filtered.
 */
import { verb, VerbRefusal, type VerbContext, type VerbFamily } from "../verbs/verb.js";
import type { DecisionView, Library } from "../index.js";

/** The fields a pushed file may change, in the order the file shows them. */
const EDITABLE = ["status", "decided", "loadBearing", "supersedes", "links", "frontCoverOf"] as const;
const READ_ONLY_MARK = "# read only";

/** "ADR-0007": a decision's number as people say it. */
function adr(number: number | undefined): string {
  return number === undefined ? "an unnumbered decision" : `ADR-${String(number).padStart(4, "0")}`;
}

/**
 * A comma-separated list of ids. One holding whitespace is refused rather than split: PowerShell turns an unquoted comma
 * list into an array and joins it with spaces.
 */
export function idList(value: string | undefined, name: string): string[] | undefined {
  if (value === undefined) return undefined;
  const ids = value.split(",").map((one) => one.trim()).filter((one) => one !== "");
  if (ids.some((id) => /\s/.test(id))) {
    throw new VerbRefusal(
      `--${name} contains whitespace inside an id. PowerShell may have converted an unquoted comma list to an array and joined it with spaces. Retry with the whole comma-separated list quoted, for example --${name} "id1,id2" (replace id1 and id2 with your intended ids). No ids were guessed or split on whitespace.`,
      { misuse: true },
    );
  }
  return ids;
}

async function viewOf(library: Library, name: string): Promise<DecisionView> {
  const number = /^(?:adr-)?(\d+)$/i.exec(name)?.[1];
  const id = number === undefined ? name : (await library.list("decision")).find((record) => record.fields.number === Number(number))?.id;
  if (id === undefined) throw new VerbRefusal(`no decision "${name}" in this project`);
  const view = await library.decision(id);
  if (view === null) throw new VerbRefusal(`no decision "${name}" in this project`);
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
  if (lines[0] !== "---" || close === -1) throw new VerbRefusal(`${file} is not a decision file: it starts with a --- front matter, as \`storytree adr pull\` writes it`);
  const fields: Record<string, unknown> = {};
  for (const line of lines.slice(1, close)) {
    if (line === READ_ONLY_MARK) break;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    if (!(EDITABLE as readonly string[]).includes(key)) throw new VerbRefusal(`${file}: "${key}" is not a field push changes (${EDITABLE.join(", ")})`);
    try {
      fields[key] = JSON.parse(line.slice(colon + 1).trim());
    } catch {
      throw new VerbRefusal(`${file}: the value of "${key}" is not JSON: ${line.slice(colon + 1).trim()}`);
    }
  }
  const body = lines.slice(close + 1);
  const heading = body.findIndex((line) => line.startsWith("# "));
  if (heading === -1) throw new VerbRefusal(`${file} has no "# <title>" line`);
  const rest = body.slice(heading + 1).join("\n").replace(/^\n/, "").replace(/\s+$/, "");
  return { title: body[heading]!.slice(2).trim(), text: rest, fields };
}

/** Reject typos instead of silently auto-numbering or rounding a supplied label. */
function decisionNumber(value: string): number {
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < 1) {
    throw new VerbRefusal(`decision number must be a positive safe integer, not ${JSON.stringify(value)}`);
  }
  return number;
}

/** The person at this computer, who scribes an authority stamp. */
async function person(): Promise<string> {
  const { userInfo } = await import("node:os");
  try {
    return userInfo().username;
  } catch {
    return process.env.USER ?? process.env.USERNAME ?? "unknown";
  }
}

const NO_TOOL = "an agent reads a decision with the open tool and records one with write_note";

const create = verb({
  command: {
    family: "adr",
    name: "new",
    summary: "record a decision with a supplied or next number, its status, who decided it, and what it supersedes",
    usage: "adr new --title <t> --text <text|@file> --status <proposed|accepted> [--number <n>] [--decided YYYY-MM-DD] [--basis <owner-directed|owner-ratified|agent-derived|agent-flipped> --owner-said <his words|@file>] [--supersedes a,b] [--links a,b] [--front-cover-of <node>] [--load-bearing]",
  },
  tool: { absent: NO_TOOL },
  inputs: {
    title: { kind: "text", optional: true, describe: "the decision's title" },
    text: { kind: "text", optional: true, describe: "its text" },
    status: { kind: "text", optional: true, describe: "proposed or accepted" },
    number: { kind: "text", optional: true, describe: "its number, when not the next" },
    decided: { kind: "text", optional: true, describe: "the day it was decided, YYYY-MM-DD" },
    basis: { kind: "text", optional: true, describe: "who decided it: owner-directed, owner-ratified, agent-derived or agent-flipped" },
    "owner-said": { kind: "text", optional: true, describe: "the owner's own words, when he decided it" },
    supersedes: { kind: "text", optional: true, describe: "the decisions it supersedes, comma-separated" },
    links: { kind: "text", optional: true, describe: "what it links to, comma-separated" },
    "front-cover-of": { kind: "text", optional: true, describe: "the node it is the front cover of" },
    "load-bearing": { kind: "switch", describe: "every session calibrates to it" },
  },
  writes: true,
  async act(input, context: VerbContext) {
    const basis = input.basis;
    const ownerSaid = input["owner-said"];
    const optional: Record<string, unknown> = {
      number: input.number === undefined ? undefined : decisionNumber(input.number),
      decided: input.decided,
      supersedes: idList(input.supersedes, "supersedes"),
      links: idList(input.links, "links"),
      frontCoverOf: input["front-cover-of"],
      loadBearing: input["load-bearing"] ? true : undefined,
      authority: basis === undefined ? undefined : { basis, scribedBy: await person(), at: new Date().toISOString(), ...(ownerSaid === undefined ? {} : { ownerSaid }) },
    };
    const fields = { title: input.title, text: input.text, status: input.status, ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined)) };
    const decision = await context.library.recordDecision(fields as never, context.writer);
    return {
      text: `Recorded ${adr(decision.fields.number)} (${decision.id}), ${decision.fields.status}.`,
      next: [{ command: `adr pull ${decision.id} --out ${decision.id}.md`, why: "read or edit it as a file" }],
    };
  },
});

const pull = verb({
  command: { family: "adr", name: "pull", summary: "a decision as a markdown file, to read or edit" },
  tool: { absent: NO_TOOL },
  inputs: {
    decision: { kind: "text", word: 0, describe: "the decision's id" },
    out: { kind: "text", optional: true, describe: "the file to write it to" },
  },
  async act({ decision, out }, context: VerbContext) {
    const file = fileOf(await viewOf(context.library, decision));
    if (out === undefined) return { text: file };
    const { writeFileSync } = await import("node:fs");
    const path = await import("node:path");
    writeFileSync(path.resolve(context.folder, out), file);
    return { text: `Pulled ${decision} to ${out}. Once you have edited it: storytree adr push ${decision} --file ${out}` };
  },
});

const push = verb({
  command: { family: "adr", name: "push", summary: "write back what you changed in a pulled file, and nothing else" },
  tool: { absent: NO_TOOL },
  inputs: {
    decision: { kind: "text", word: 0, describe: "the decision's id or number" },
    file: { kind: "text", describe: "the file adr pull wrote, as you edited it" },
  },
  writes: true,
  async act({ decision, file }, context: VerbContext) {
    const pushed = parseFile(await readFile(context.folder, file), file);
    const record = (await viewOf(context.library, decision)).record;
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
    await context.library.editNote(id, changes as never, context.writer);
    return { text: `Pushed ${id}: ${names.join(", ")}.`, next: [{ command: `adr pull ${id}`, why: "read it back" }] };
  },
});

/** The text of `file`, relative to `folder`, without a leading byte-order mark (PowerShell 5.1's utf8 writes one). */
async function readFile(folder: string, file: string): Promise<string> {
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const at = path.resolve(folder, file);
  try {
    return readFileSync(at, "utf8").replace(/^﻿/, "");
  } catch (error) {
    throw new VerbRefusal(`cannot read ${at}: ${(error as Error).message}`);
  }
}

const compose = verb({
  command: { family: "adr", name: "compose", summary: "write a decision's one composed statement, beside its text" },
  tool: { absent: NO_TOOL },
  inputs: {
    decision: { kind: "text", word: 0, describe: "the decision's id or number" },
    statement: { kind: "text", describe: "its one composed statement" },
  },
  writes: true,
  async act({ decision, statement }, context: VerbContext) {
    const id = (await viewOf(context.library, decision)).record.id;
    const composed = await context.library.composeStatement(id, statement, context.writer);
    if (composed === null) throw new VerbRefusal(`no decision "${id}" in this project`);
    return { text: `Composed ${id}'s statement.` };
  },
});

const list = verb({
  command: { family: "adr", name: "list", summary: "the decisions: current (accepted), by status, load-bearing", usage: "adr list [--current] [--status <s>] [--load-bearing]" },
  tool: { absent: NO_TOOL },
  inputs: {
    current: { kind: "switch", describe: "only the accepted ones" },
    status: { kind: "text", optional: true, describe: "only those that read as this status" },
    "load-bearing": { kind: "switch", describe: "only the load-bearing ones" },
  },
  async act(input, context: VerbContext) {
    const lines: string[] = [];
    for (const view of await context.library.decisions()) {
      if (input.current && view.status !== "accepted") continue;
      if (input.status !== undefined && view.status !== input.status) continue;
      if (input["load-bearing"] && !view.record.fields.loadBearing) continue;
      const fields = view.record.fields;
      lines.push(`  ${adr(fields.number)}  ${view.record.id}  [${view.status}]${fields.loadBearing ? "  load-bearing" : ""}  ${fields.title}`);
    }
    return {
      text: lines.length === 0 ? "No decisions match." : [`${lines.length} decisions:`, ...lines].join("\n"),
      next: [{ command: "adr pull <id|number>", why: "read one whole" }],
    };
  },
});

/** The `adr` family, 4th among `storytree`'s families, with the words agents try for reading one decision. */
export const ADR_FAMILY: VerbFamily = {
  name: "adr",
  summary: "the decision log: new, pull, push, compose, list",
  order: 4,
  guesses: { read: "adr pull <decision>", get: "adr pull <decision>", open: "adr pull <decision>" },
  verbs: [list, create, pull, push, compose],
};
