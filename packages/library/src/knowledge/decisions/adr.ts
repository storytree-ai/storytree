// Capability 31 · Decisions
import { verb, VerbRefusal, type VerbContext, type VerbFamily } from "../../verbs/verb.js";
import type { DecisionView } from "./decision-log.js";
import { editDecision, recordDecision, type DecisionLibrary } from "./supersede.js";

type DecisionContext = VerbContext<DecisionLibrary>;

const EDITABLE = ["status", "decided", "loadBearing", "supersedes", "links", "justifications", "frontCoverOf"] as const;
const READ_ONLY_MARK = "# read only";

function adr(number: number | undefined): string {
  return number === undefined ? "an unnumbered decision" : `ADR-${String(number).padStart(4, "0")}`;
}

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

async function viewOf(library: Pick<DecisionLibrary, "list" | "decision">, name: string): Promise<DecisionView> {
  const number = /^(?:adr-)?(\d+)$/i.exec(name)?.[1];
  const id = number === undefined ? name : (await library.list("decision")).find((record) => record.fields.number === Number(number))?.id;
  if (id === undefined) throw new VerbRefusal(`no decision "${name}" in this project`);
  const view = await library.decision(id);
  if (view === null) throw new VerbRefusal(`no decision "${name}" in this project`);
  return view;
}

function fileOf(view: DecisionView, linkedFrom: readonly string[]): string {
  const fields = view.record.fields;
  const lines = ["---"];
  for (const key of EDITABLE) if (fields[key] !== undefined) lines.push(`${key}: ${JSON.stringify(fields[key])}`);
  lines.push(READ_ONLY_MARK, `id: ${JSON.stringify(view.record.id)}`);
  if (fields.number !== undefined) lines.push(`number: ${fields.number}`);
  lines.push(`reads-as: ${JSON.stringify(view.status)}`);
  if (view.supersededBy.length > 0) lines.push(`superseded-by: ${JSON.stringify(view.supersededBy)}`);
  if (view.supersededInPart.length > 0) lines.push(`superseded-in-part: ${JSON.stringify(view.supersededInPart)}`);
  if (linkedFrom.length > 0) lines.push(`linked-from: ${JSON.stringify(linkedFrom)}`);
  if (fields.authority !== undefined) lines.push(`authority: ${JSON.stringify(fields.authority)}`);
  if (view.composed !== undefined) {
    lines.push(`composed: ${JSON.stringify(view.composed.statement)}`);
    if (view.composed.stale) lines.push(`composed-reads: "stale: the text has changed since it was composed"`);
  }
  lines.push("---", "", `# ${fields.title}`, "", fields.text.trimEnd(), "");
  return lines.join("\n");
}

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
  const rest = body.slice(heading + 1).join("\n").replace(/^\n/, "").trimEnd();
  return { title: body[heading]!.slice(2).trim(), text: rest, fields };
}

function justificationsOf(why: readonly string[]): Record<string, string> | undefined {
  if (why.length === 0) return undefined;
  return Object.fromEntries(why.map((given) => {
    const equals = given.indexOf("=");
    if (equals < 1) throw new VerbRefusal(`--why is <target>=<why it is linked>, not ${JSON.stringify(given)}`, { misuse: true });
    return [given.slice(0, equals).trim(), given.slice(equals + 1)];
  }));
}

function decisionNumber(value: string): number {
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < 1) {
    throw new VerbRefusal(`decision number must be a positive safe integer, not ${JSON.stringify(value)}`);
  }
  return number;
}

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
    usage: "adr new --title <t> --text <text|@file> --status accepted [--number <n>] [--decided YYYY-MM-DD] [--basis <owner-directed|owner-ratified|agent-derived|agent-flipped> --owner-said <his words|@file> | --basis brought-across --brought-from <0.2 record> --brought-basis <0.2's basis>] [--supersedes a,b] [--links a,b] [--why <target>=<text>]… [--front-cover-of <node>] [--load-bearing]",
  },
  tool: { absent: NO_TOOL },
  inputs: {
    title: { kind: "text", optional: true, describe: "the decision's title" },
    text: { kind: "text", optional: true, describe: "its text" },
    status: { kind: "text", optional: true, describe: "accepted; a new decision written proposed is refused (ADR-1232 D1)" },
    number: { kind: "text", optional: true, describe: "its number, when not the next" },
    decided: { kind: "text", optional: true, describe: "the day it was decided, YYYY-MM-DD" },
    basis: { kind: "text", optional: true, describe: "who decided it: owner-directed, owner-ratified, agent-derived, agent-flipped or brought-across" },
    "owner-said": { kind: "text", optional: true, describe: "the owner's own words, when he decided it" },
    "brought-from": { kind: "text", optional: true, describe: "the 0.2 record a brought-across decision was carried over from, such as ADR-0138" },
    "brought-basis": { kind: "text", optional: true, describe: "who decided it in 0.2, for a brought-across decision: one of the other four bases" },
    supersedes: { kind: "text", optional: true, describe: "the decisions it supersedes, comma-separated" },
    links: { kind: "text", optional: true, describe: "what it links to, comma-separated" },
    why: { kind: "text", many: true, optional: true, describe: "each decision it links to or supersedes, as <target>=<why>: at most two lines, why an agent would follow it and why it was linked" },
    "front-cover-of": { kind: "text", optional: true, describe: "the node it is the front cover of" },
    "load-bearing": { kind: "switch", describe: "every session calibrates to it" },
  },
  writes: true,
  async act(input, context: DecisionContext) {
    const basis = input.basis;
    const ownerSaid = input["owner-said"];
    const broughtFrom = input["brought-from"] === undefined && input["brought-basis"] === undefined ? undefined : { record: input["brought-from"], basis: input["brought-basis"] };
    if (broughtFrom !== undefined && basis !== "brought-across") throw new VerbRefusal("--brought-from and --brought-basis point a --basis brought-across decision at its 0.2 record");
    const optional: Record<string, unknown> = {
      number: input.number === undefined ? undefined : decisionNumber(input.number),
      decided: input.decided,
      supersedes: idList(input.supersedes, "supersedes"),
      links: idList(input.links, "links"),
      justifications: justificationsOf(input.why ?? []),
      frontCoverOf: input["front-cover-of"],
      loadBearing: input["load-bearing"] ? true : undefined,
      authority: basis === undefined ? undefined : { basis, scribedBy: await person(), at: new Date().toISOString(), ...(ownerSaid === undefined ? {} : { ownerSaid }), ...(broughtFrom === undefined ? {} : { broughtFrom }) },
    };
    const fields = { title: input.title, text: input.text, status: input.status, ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined)) };
    const decision = await recordDecision(context.library, fields as never, context.writer);
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
  async act({ decision, out }, context: DecisionContext) {
    const view = await viewOf(context.library, decision);
    const file = fileOf(view, (await context.library.linkingIn(view.record.id)).map((record) => record.id));
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
  async act({ decision, file }, context: DecisionContext) {
    const pushed = parseFile(await readFile(context.folder, file), file);
    const record = (await viewOf(context.library, decision)).record;
    const id = record.id;
    const stored = record.fields as Record<string, unknown>;
    const changes: Record<string, unknown> = {};
    if (pushed.title !== stored.title) changes.title = pushed.title;
    if (pushed.text !== String(stored.text).trimEnd()) changes.text = pushed.text;
    for (const key of EDITABLE) {
      if (JSON.stringify(pushed.fields[key]) !== JSON.stringify(stored[key])) changes[key] = pushed.fields[key];
    }
    const names = Object.keys(changes);
    if (names.length === 0) return { text: `No change: ${file} says what ${id} already says.` };
    await editDecision(context.library, id, changes as never, context.writer);
    return { text: `Pushed ${id}: ${names.join(", ")}.`, next: [{ command: `adr pull ${id}`, why: "read it back" }] };
  },
});

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
  async act({ decision, statement }, context: DecisionContext) {
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
  async act(input, context: DecisionContext) {
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

const moveNarrows = verb({
  command: { family: "adr", name: "move-narrows", summary: "move every stored narrows onto supersedesClauses, its clauses those the narrowing text names beside the narrowed decision's number, partial where it names none (ADR-1379 D1)", usage: "adr move-narrows" },
  tool: { absent: NO_TOOL },
  inputs: {},
  writes: true,
  async act(_inputs, context: DecisionContext) {
    const moved = await context.library.moveNarrowsToClauses(context.writer);
    if (moved.decisions.length === 0) return { text: "No decision stores a narrows: nothing to move." };
    return { text: `Moved ${moved.edges} ${moved.edges === 1 ? "narrowing" : "narrowings"} onto supersedesClauses (${moved.partial} partial), from ${moved.decisions.length} ${moved.decisions.length === 1 ? "decision" : "decisions"}: ${moved.decisions.join(", ")}.` };
  },
});

const pairs = verb({
  command: { family: "adr", name: "pairs", summary: "check each clause-scoped supersedes has its in-place note, and each in-place note its edge; what came before 2026-11-20 is counted, not failed", usage: "adr pairs" },
  tool: { absent: NO_TOOL },
  inputs: {},
  async act(_inputs, context: DecisionContext) {
    const { flagged, backlog } = await context.library.supersessionPairs();
    const counted = `${backlog} older ${backlog === 1 ? "pair" : "pairs"} counted as backlog.`;
    if (flagged.length > 0) {
      const lines = flagged.map(({ kind, from, to }) => (kind === "no-note" ? `  ${from} supersedes clauses of ${to}, which has no in-place note naming it` : `  ${to} has an in-place note naming ${from}, which has no supersession edge to it`));
      throw new VerbRefusal([`${flagged.length} unpaired ${flagged.length === 1 ? "supersession" : "supersessions"}:`, ...lines, counted].join("\n"));
    }
    return { text: `Every supersession is paired with its in-place note. ${counted}` };
  },
});

const backlog = verb({
  command: { family: "adr", name: "backlog", summary: "count the old-shape decision links, stored with no justification, and the decisions holding them (ADR-1379 D2)", usage: "adr backlog [--by-target]" },
  tool: { absent: NO_TOOL },
  inputs: {
    "by-target": { kind: "switch", describe: "list each decision old-shape links point at, most links in first" },
  },
  async act(input, context: DecisionContext) {
    const { links, decisions, targets } = await context.library.decisionLinkBacklog();
    if (input["by-target"]) return { text: targets.map((target) => `${adr(target.number)}  ${target.title}  ${target.links} old-shape ${target.links === 1 ? "link" : "links"} in`).join("\n") };
    return { text: `${links} old-shape decision ${links === 1 ? "link" : "links"} (no justification) across ${decisions} ${decisions === 1 ? "decision" : "decisions"}` };
  },
});

const changes = verb({
  command: { family: "adr", name: "changes", summary: "count, per UTC day and in total, the decision links pruned, restored, justified, corrected and added, and the decisions touched", usage: "adr changes [--from <day>] [--to <day>] [--by <writer>]" },
  tool: { absent: NO_TOOL },
  inputs: {
    from: { kind: "text", optional: true, describe: "the first UTC day counted, YYYY-MM-DD" },
    to: { kind: "text", optional: true, describe: "the last UTC day counted, YYYY-MM-DD" },
    by: { kind: "text", optional: true, describe: "only this writer's writes, such as session:<id>" },
  },
  async act({ from, to, by }, context: DecisionContext) {
    const { days, total } = await context.library.decisionLinkChanges({ from, to, by });
    const span = `from ${from ?? "the start"} to ${to ?? "now"}${by === undefined ? "" : ` by ${by}`}`;
    if (days.length === 0) return { text: `No decision link changed ${span}.` };
    const counts = (one: typeof total): string => `pruned ${one.pruned} · restored ${one.restored} · justified ${one.justified} · corrected ${one.corrected} · added ${one.added} · decisions ${one.decisions}`;
    return { text: [`Decision link changes ${span}:`, ...days.map((one) => `${one.day}  ${counts(one)}`), `total       ${counts(total)}`].join("\n") };
  },
});

async function refused<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (error instanceof RangeError && / has no (?:archived )?link to /.test(error.message)) throw new VerbRefusal(error.message);
    throw error;
  }
}

const prune = verb({
  command: { family: "adr", name: "prune", summary: "move a decision's link into its archive, with who, when and why, so nothing follows it; adr restore puts it back", usage: "adr prune <decision> <target> --reason <why>" },
  tool: { absent: NO_TOOL },
  inputs: {
    decision: { kind: "text", word: 0, describe: "the decision's id or number" },
    target: { kind: "text", word: 1, describe: "the id it links to" },
    reason: { kind: "text", optional: true, describe: "why the link is pruned" },
  },
  writes: true,
  async act({ decision, target, reason }, context: DecisionContext) {
    if (reason === undefined || reason.trim() === "") throw new VerbRefusal("adr prune keeps why a link was pruned: give --reason <why>", { misuse: true });
    const id = (await viewOf(context.library, decision)).record.id;
    await refused(() => context.library.pruneLink(id, target, reason, context.writer));
    return { text: `Pruned ${id}'s link to ${target}: archived, with its reason.` };
  },
});

const pruned = verb({
  command: { family: "adr", name: "pruned", summary: "the archived decision links: from, to, field, by, at and reason", usage: "adr pruned [<decision>]" },
  tool: { absent: NO_TOOL },
  inputs: { decision: { kind: "text", word: 0, optional: true, describe: "only this decision's" } },
  async act({ decision }, context: DecisionContext) {
    const from = decision === undefined ? undefined : (await viewOf(context.library, decision)).record.id;
    const archived = await context.library.archivedLinks(from);
    if (archived.length === 0) return { text: "No decision link is archived." };
    const lines = archived.map((one) => `  ${one.from} → ${one.to}  ${one.field}${one.clauses === undefined ? "" : ` ${one.clauses.join(", ")}`}  by ${one.by} at ${one.at}: ${one.reason}`);
    return { text: [`${archived.length} archived decision ${archived.length === 1 ? "link" : "links"}:`, ...lines].join("\n") };
  },
});

const restore = verb({
  command: { family: "adr", name: "restore", summary: "put an archived decision link back, with its justification or --why", usage: "adr restore <decision> <target> [--why <text>]" },
  tool: { absent: NO_TOOL },
  inputs: {
    decision: { kind: "text", word: 0, describe: "the decision's id or number" },
    target: { kind: "text", word: 1, describe: "the id it linked to" },
    why: { kind: "text", optional: true, describe: "its justification, when it was archived with none" },
  },
  writes: true,
  async act({ decision, target, why }, context: DecisionContext) {
    const id = (await viewOf(context.library, decision)).record.id;
    await refused(() => context.library.restoreLink(id, target, why, context.writer));
    return { text: `Restored ${id}'s link to ${target}.` };
  },
});

export const ADR_FAMILY: VerbFamily<DecisionContext> = {
  name: "adr",
  summary: "the decision log: new, pull, push, compose, list, move-narrows, pairs, backlog, changes, prune, pruned, restore",
  order: 4,
  guesses: { read: "adr pull <decision>", get: "adr pull <decision>", open: "adr pull <decision>" },
  verbs: [list, create, pull, push, compose, moveNarrows, pairs, backlog, changes, prune, pruned, restore],
};
