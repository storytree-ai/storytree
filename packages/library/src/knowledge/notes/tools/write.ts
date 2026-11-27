// Capability 17 · The library's commands
import type { Library } from "../../../index.js";
import { refuseStaleEdit, refusing, verb, VerbRefusal, type VerbAnswer } from "../../../commands/kit/index.js";
import { correct, recordDecision } from "../../decisions/door.js";
import { filedOnSaid, shelfOf } from "../../../plan/index.js";
import type { KnowledgeKind } from "../../search/index.js";
import { NOTE_REFUSALS } from "../kinds.js";
import { ARTIFACT_KINDS, NOTE_TYPES } from "../links.js";
import type { HeldClaim, NoteToolContext } from "./context.js";

const PARTS: readonly string[] = ["story", "capability", "contract", "edge"];

function present(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

function listed(said: readonly string[]): string {
  return said.length < 2 ? said.join("") : `${said.slice(0, -1).join(", ")} and ${said.at(-1)}`;
}

async function heldParts(context: NoteToolContext): Promise<string[]> {
  const mine = (await context.claims()).filter((claim: HeldClaim) => claim.session === context.session && claim.capability !== undefined);
  return [...new Set([...mine].sort((a, b) => a.since.localeCompare(b.since)).map(({ capability }) => capability!))];
}

async function titleOf(library: Library, id: string): Promise<string> {
  return JSON.stringify(String(((await library.get(id))?.fields as { title?: unknown } | undefined)?.title));
}

const UNSHELVED: readonly string[] = ["escape", "drill", "measure"];

interface Placed {
  readonly links?: string[];
  readonly empty: boolean;
}

async function placedLinks(context: NoteToolContext, given: readonly string[]): Promise<Placed> {
  if (given.length > 0) return { links: [...given], empty: false };
  const capability = (await heldParts(context)).at(-1);
  if (capability === undefined) return { empty: false };
  const shelf = (await shelfOf(context.library, capability)).map(({ id }) => id);
  const opened = (await context.notesRead()).filter(({ note, read }) => read === "whole" && shelf.includes(note)).at(-1)?.note;
  const cover = opened ?? shelf[0];
  return cover === undefined ? { empty: true } : { links: [cover], empty: false };
}

function placedData(id: string, placed: Placed): Record<string, unknown> {
  return placed.empty ? { id, shelf: "empty" } : { id };
}

async function writeDecision(context: NoteToolContext, title: string | undefined, text: string | undefined, links: readonly string[], frontCoverOf: string | undefined, justifications: Readonly<Record<string, unknown>>): Promise<VerbAnswer> {
  const { library } = context;
  for (const link of links) {
    if (PARTS.includes((await library.get(link))?.type ?? "")) {
      throw new VerbRefusal(`"links" takes notes, not parts. To file this decision on ${await titleOf(library, link)}, pass front_cover_of: ${link}.`, { misuse: true });
    }
  }
  let cover = frontCoverOf;
  let held = "";
  if (cover === undefined) {
    const parts = await heldParts(context);
    if (parts.length > 1) {
      const named = await Promise.all(parts.map(async (part) => `${await titleOf(library, part)} (${part})`));
      throw new VerbRefusal(`You hold ${parts.length} parts, ${listed(named)}, and named none: give front_cover_of, the part this decision is filed on.`, { misuse: true });
    }
    cover = parts[0];
    if (cover !== undefined) held = ` as a front cover of ${cover}, the capability you hold`;
  }
  const decision = present({ status: "accepted", title, text, links: links.length === 0 ? undefined : [...links], frontCoverOf: cover, justifications: Object.keys(justifications).length === 0 ? undefined : justifications });
  const written = await refusing(() => recordDecision(library, decision as never, context.writer));
  const filed = cover === undefined ? "" : `\n${await filedOnSaid(library, cover, "edit_plan")}`;
  return { text: `Wrote decision ${written.id}${held}.${filed}`, data: { id: written.id } };
}

export const WRITE_NOTE = verb({
  command: { absent: "library new writes a record on the command line" },
  tool: { name: "write_note", description: "Write a note into the library: a decision (title, text), a definition (term, meaning) or another kind of artifact (its fields); with no place named it goes onto the shelf of the capability you hold" },
  inputs: {
    kind: { kind: "text", describe: "The kind of note: decision, definition, or a kind of artifact" },
    title: { kind: "text", optional: true, describe: "A decision's title" },
    text: { kind: "text", optional: true, verbatim: true, describe: "A decision's text" },
    term: { kind: "text", optional: true, describe: "A definition's term" },
    meaning: { kind: "text", optional: true, verbatim: true, describe: "A definition's meaning" },
    fields: { kind: "fields", json: true, describe: "Another kind's fields" },
    links: { kind: "text", many: true, optional: true, describe: "The notes this one links to" },
    front_cover_of: { kind: "text", optional: true, describe: "The story or capability a decision is filed on" },
    justifications: { kind: "fields", json: true, describe: "For each decision a decision links to, why it follows it, in at most two lines" },
  },
  writes: true,
  async act(input, context: NoteToolContext): Promise<VerbAnswer> {
    const { kind, fields = {}, links = [] } = input;
    const captured = (ARTIFACT_KINDS as Readonly<Record<string, { readonly captured?: { readonly command: string; readonly tool: string } }>>)[kind]?.captured;
    if (captured !== undefined) {
      throw new VerbRefusal(`A ${kind} is captured with ${captured.tool} (on the command line, \`${captured.command}\`), which files it with its evidence; write_note writes none, so nothing was written.`, { misuse: true });
    }
    if (kind === "decision") return await writeDecision(context, input.title ?? (fields["title"] as string | undefined), input.text ?? (fields["text"] as string | undefined), links, input.front_cover_of, input.justifications ?? {});
    if (kind === "definition") {
      const placed = await placedLinks(context, links);
      const written = await refusing(() => context.library.defineTerm(present({ term: input.term, meaning: input.meaning, links: placed.links }) as never, context.writer));
      return { text: `Wrote definition ${written.id}.`, data: placedData(written.id, placed) };
    }
    if (Object.hasOwn(NOTE_REFUSALS, kind)) throw new VerbRefusal(`write_note does not write a ${kind}: ${NOTE_REFUSALS[kind]}; nothing was written`, { misuse: true });
    if (!Object.hasOwn(ARTIFACT_KINDS, kind)) {
      throw new VerbRefusal(`${kind} is no kind write_note writes: give decision, definition or one of ${Object.keys(ARTIFACT_KINDS).join(", ")}`, { misuse: true });
    }
    if (Object.keys(fields).length === 0) throw new VerbRefusal(`Give the required fields for a ${kind} in fields.`, { misuse: true });
    const placed = fields["links"] !== undefined && links.length === 0 ? { links: fields["links"] as string[], empty: false } : UNSHELVED.includes(kind) ? { links: [...links], empty: false } : await placedLinks(context, links);
    const shaped = { ...fields, links: placed.links ?? [] };
    const written = await refusing(() => context.library.writeKnowledge(kind as KnowledgeKind, shaped as never, context.writer));
    return { text: `Wrote ${kind} ${written.id}.`, data: placedData(written.id, placed) };
  },
});

export const CORRECT_NOTE = verb({
  command: { absent: "library edit corrects a record on the command line" },
  tool: { name: "correct_note", description: "Correct a note's wording in place: it keeps its id, and only the fields given change; give read, the history entry you read, to write over another writer's recent change" },
  inputs: {
    id: { kind: "text", describe: "The note to correct" },
    title: { kind: "text", optional: true, describe: "Its new title" },
    text: { kind: "text", optional: true, verbatim: true, describe: "Its new text" },
    term: { kind: "text", optional: true, describe: "Its new term" },
    meaning: { kind: "text", optional: true, verbatim: true, describe: "Its new meaning" },
    fields: { kind: "fields", json: true, describe: "Any other fields to change" },
    read: { kind: "text", optional: true, describe: "The seq of the history entry you read it at" },
  },
  writes: true,
  async act({ id, title, text, term, meaning, fields = {}, read }, context: NoteToolContext): Promise<VerbAnswer> {
    const { library } = context;
    const record = await library.get(id);
    if (record === null || !NOTE_TYPES.includes(record.type)) throw new VerbRefusal(`no note ${id} in this project to correct`);
    const changes = present({ ...fields, title, text, term, meaning });
    if (Object.keys(changes).length === 0) throw new VerbRefusal("give at least one field to change", { misuse: true });
    await refuseStaleEdit(library, id, context.writer, read);
    await refusing(() => (record.type === "decision" ? correct(library, id, changes, context.writer) : library.editNote(id, changes as never, context.writer)));
    return { text: `Corrected ${record.type} ${id}: ${Object.keys(changes).join(", ")}.`, data: { id } };
  },
});
