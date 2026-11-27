// Capability 13 · Decision log
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { refusing, verb, VerbRefusal, type VerbAnswer, type VerbContext } from "../../commands/kit/index.js";
import type { Library } from "../../index.js";
import { editDecision } from "./door.js";
import type { DecisionView } from "./knowledge.js";

const FIXED = ["title", "text", "number"];
const READ_ONLY = ["authority", "composed", "archivedLinks"];
const READ_ONLY_MARK = "# read only";
const FENCE = "---";
const NUMBERED = /^(?:ADR-)?(\d+)$/i;

type Fields = Readonly<Record<string, unknown>>;

export async function decisionCalled(library: Library, name: string): Promise<DecisionView> {
  const number = NUMBERED.exec(name)?.[1];
  const id = number === undefined ? name : ((await library.decisionNumbered(Number(number)))?.id ?? name);
  const view = await library.decision(id);
  if (view === null) throw new VerbRefusal(`no decision ${name} in this project`);
  return view;
}

function line(key: string, value: unknown): string {
  return `${key}: ${JSON.stringify(value)}`;
}

function editable(fields: Fields): [string, unknown][] {
  return Object.entries(fields).filter(([key]) => !FIXED.includes(key) && !READ_ONLY.includes(key));
}

async function pulled(library: Library, view: DecisionView): Promise<string> {
  const { record } = view;
  const fields = record.fields as Fields;
  const linking = (await library.linkingIn(record.id)).map(({ id }) => id);
  const readOnly = [
    line("id", record.id),
    ...(record.fields.number === undefined ? [] : [line("number", record.fields.number)]),
    line("reads-as", view.status),
    ...(view.supersededBy.length === 0 ? [] : [line("superseded-by", view.supersededBy)]),
    ...(view.supersededInPart.length === 0 ? [] : [line("superseded-in-part", view.supersededInPart)]),
    ...(linking.length === 0 ? [] : [line("linked-from", linking)]),
    ...READ_ONLY.filter((key) => fields[key] !== undefined).map((key) => line(key, fields[key])),
  ];
  return [FENCE, ...editable(fields).map(([key, value]) => line(key, value)), READ_ONLY_MARK, ...readOnly, FENCE, "", `# ${record.fields.title}`, "", `${record.fields.text}\n`].join("\n");
}

function parsed(file: string): { readonly front: Record<string, unknown>; readonly title: string; readonly text: string } {
  const content = file.replace(/\r\n/g, "\n");
  const close = content.indexOf(`\n${FENCE}\n`, FENCE.length);
  if (!content.startsWith(`${FENCE}\n`) || close === -1) throw new VerbRefusal("this file is not a pulled decision: it opens with a --- front matter, closed by another ---; nothing was written", { misuse: true });
  const front: Record<string, unknown> = {};
  for (const held of content.slice(FENCE.length + 1, close).split("\n")) {
    if (held === READ_ONLY_MARK) break;
    if (held.trim() === "") continue;
    const at = held.indexOf(": ");
    if (at === -1) throw new VerbRefusal(`the front matter line ${JSON.stringify(held)} is not <field>: <JSON value>; nothing was written`, { misuse: true });
    try {
      front[held.slice(0, at)] = JSON.parse(held.slice(at + 2));
    } catch {
      throw new VerbRefusal(`the front matter line ${JSON.stringify(held)} holds no JSON value; nothing was written`, { misuse: true });
    }
  }
  const body = /^\n*# ([^\n]*)\n\n?([\s\S]*)$/.exec(content.slice(close + FENCE.length + 2));
  if (body === null) throw new VerbRefusal("the body under the front matter starts with the decision's title, as # <title>; nothing was written", { misuse: true });
  return { front, title: body[1]!, text: body[2]!.replace(/\n$/, "") };
}

function changed(fields: Fields, file: ReturnType<typeof parsed>): Record<string, unknown> {
  const edit: Record<string, unknown> = {};
  if (file.title !== fields["title"]) edit["title"] = file.title;
  if (file.text !== fields["text"]) edit["text"] = file.text;
  for (const [key, value] of Object.entries(file.front)) if (!FIXED.includes(key) && !READ_ONLY.includes(key) && !isDeepStrictEqual(fields[key], value)) edit[key] = value;
  for (const [key] of editable(fields)) if (!Object.hasOwn(file.front, key)) edit[key] = undefined;
  return edit;
}

export const PULL = verb({
  command: { family: "adr", name: "pull", summary: "a decision as a markdown file, to read or edit", usage: "adr pull <decision> [--out <file>]" },
  tool: { absent: "a decision is pulled on the command line" },
  inputs: {
    decision: { kind: "text", word: 0, describe: "The decision, by id or number" },
    out: { kind: "text", optional: true, describe: "The file to write it to" },
  },
  async act({ decision, out }, context: VerbContext): Promise<VerbAnswer> {
    const view = await decisionCalled(context.library, decision);
    const file = await pulled(context.library, view);
    if (out === undefined) return { text: file, raw: true };
    const target = path.resolve(context.folder, out);
    writeFileSync(target, file);
    return { text: `Wrote ${view.record.id} to ${target}.`, data: { id: view.record.id } };
  },
});

export const PUSH = verb({
  command: { family: "adr", name: "push", summary: "write back what changed in a pulled decision file, and nothing else", usage: "adr push <decision> --file <file>" },
  tool: { absent: "a decision is pushed on the command line" },
  inputs: {
    decision: { kind: "text", word: 0, describe: "The decision the file was pulled from" },
    file: { kind: "text", describe: "The pulled file, edited" },
  },
  writes: true,
  async act({ decision, file }, context: VerbContext): Promise<VerbAnswer> {
    const view = await decisionCalled(context.library, decision);
    const { id } = view.record;
    const edit = changed(view.record.fields as Fields, parsed(readFileSync(path.resolve(context.folder, file), "utf8")));
    const names = Object.keys(edit);
    if (names.length === 0) return { text: `No change: ${file} matches ${id} as stored.` };
    const writer = context.writer;
    await refusing(() => editDecision(context.library, id, edit, writer));
    return { text: `Pushed ${id}: ${names.join(", ")}.`, data: { id } };
  },
});
