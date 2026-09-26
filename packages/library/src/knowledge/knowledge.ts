/**
 * Capability 6 · Knowledge and memory (stories/library.md): alongside the plan, the library keeps
 * what the project has learned: memory notes, decisions and definitions of terms, together
 * "notes". A note links to the other notes it relates to, and is found again by searching its
 * words.
 *
 * Capability 9 · Knowledge entrances: every story and capability has its own shelf of front-cover
 * decisions, and a decision can be a front cover of one of them at most. Notes link only to other
 * notes, so the only way from the work into the knowledge is through a front cover. A decision
 * names the node it is a cover of in its one `frontCoverOf` field, so no decision can be the cover
 * of two, and nothing has to check for it.
 *
 * ADR-0640 grows it by eight kinds, written with writeKnowledge: principles, guardrails, patterns,
 * processes, agent roles, friction, re-steers and tech stack. They are notes like the first three:
 * searched, linked only to notes, and edited with editNote. An agent role's required reading, rules,
 * anti-patterns and step reading, and a process's branch edges, are links to notes too (6-a).
 *
 * Knowledge is a layer over capability 3's SchemaRecords, so it runs unchanged on the in-memory
 * twin and on Postgres. Every link, and every front cover, is checked BEFORE the write, and a
 * broken one throws with nothing written; the note itself is then checked against its type inside
 * the write, as capability 3 checks every write.
 */
import { byCreation } from "../creation-order.js";
import { checkReference, checkReferences, liveRecord, type Expected } from "../references.js";
import type { SchemaRecord, SchemaRecords } from "../schema/index.js";
import type { FieldsOf, KnowledgeKind } from "../schema/types.js";

/** The kinds of note: memory notes, decisions, definitions, and the eight kinds of ADR-0640. */
export type NoteType = "memory" | "decision" | "definition" | KnowledgeKind;
/** A new note of one of the eight kinds: its fields. Every reference in it must name a live note. */
export type NewKnowledge<K extends KnowledgeKind = KnowledgeKind> = FieldsOf<K>;
/** A stored note of any kind. */
export type Note = SchemaRecord<NoteType>;
/** A new memory note's fields. Every link must name a live note. */
export type NewMemory = FieldsOf<"memory">;
/** A new decision's fields. Every link must name a live note, and `frontCoverOf` a live story or capability. */
export type NewDecision = FieldsOf<"decision">;
/** A new definition's fields. Every link must name a live note. */
export type NewDefinition = FieldsOf<"definition">;
/** An edit of a note: some of its kind's fields. A field set to undefined is removed. */
export type NoteEdit = {
  [K in NoteType]: { [F in keyof FieldsOf<K>]?: FieldsOf<K>[F] | undefined };
}[NoteType];

/** The eight kinds writeKnowledge writes. */
export const KNOWLEDGE_KINDS: readonly KnowledgeKind[] = [
  "principle",
  "guardrail",
  "pattern",
  "process",
  "agent",
  "friction",
  "resteer",
  "techstack",
];

const NOTE_TYPES: readonly NoteType[] = ["memory", "decision", "definition", ...KNOWLEDGE_KINDS];

/**
 * The fields that name other notes rather than hold words: never searched. (`refs` sits inside an
 * agent role's `stepRefs`, `to` inside a process's `branchEdges`.)
 */
const REFERENCE_FIELDS: ReadonlySet<string> = new Set(["links", "frontCoverOf", "context", "rules", "antiPatterns", "refs", "to"]);

/** What a note may link to: another note, never the work (capability 9). */
const NOTE: Expected = {
  name: "note",
  types: NOTE_TYPES,
  why: "notes link only to other notes: a story or capability is reached through its front covers, the decisions whose frontCoverOf names it",
};

/** What a decision may be the front cover of (capability 9). */
const COVERABLE: Expected = { name: "story or capability", types: ["story", "capability"] };

export class Knowledge {
  readonly #records: SchemaRecords;

  constructor(records: SchemaRecords) {
    this.#records = records;
  }

  /**
   * Write a memory note. Every link must name a live note: otherwise a MissingReferenceError names
   * the first that does not, and nothing is written.
   */
  async writeMemory(memory: NewMemory): Promise<SchemaRecord<"memory">> {
    await this.#checkLinks(memory.links);
    return this.#records.create("memory", memory);
  }

  /**
   * Record a decision. Its links are checked as writeMemory checks them, and its `frontCoverOf`,
   * if it has one, must name a live story or capability.
   */
  async recordDecision(decision: NewDecision): Promise<SchemaRecord<"decision">> {
    await this.#checkLinks(decision.links);
    await this.#checkFrontCover(decision.frontCoverOf);
    return this.#records.create("decision", decision);
  }

  /**
   * Write a note of one of the eight kinds (ADR-0640). Its links, and an agent role's or a process's
   * other references, must each name a live note, as writeMemory checks links; its fields are then
   * checked against its kind inside the write. A kind that is not one of the eight is refused.
   */
  async writeKnowledge<K extends KnowledgeKind>(kind: K, fields: NewKnowledge<K>): Promise<SchemaRecord<K>> {
    if (!KNOWLEDGE_KINDS.includes(kind)) {
      throw new RangeError(`writeKnowledge writes ${KNOWLEDGE_KINDS.join(", ")}, not ${JSON.stringify(kind)}`);
    }
    await this.#checkNoteReferences(fields);
    return this.#records.create(kind, fields);
  }

  /** Define a term. Its links are checked as writeMemory checks them. */
  async defineTerm(definition: NewDefinition): Promise<SchemaRecord<"definition">> {
    await this.#checkLinks(definition.links);
    return this.#records.create("definition", definition);
  }

  /**
   * Change only the named fields of a note, as capability 3's edit does; new links, and a new
   * front cover, are checked as they are when the note is written. Setting `frontCoverOf` to
   * undefined takes a decision off its node's shelf. The note's earlier wording stays in its
   * history. Returns null, and writes nothing, if `id` is not a live note.
   */
  async editNote(id: string, fields: NoteEdit): Promise<Note | null> {
    if ((await liveRecord(this.#records, id, NOTE_TYPES)) === null) return null;
    await this.#checkNoteReferences(fields);
    if ("frontCoverOf" in fields) await this.#checkFrontCover(fields.frontCoverOf);
    return (await this.#records.edit(id, fields)) as Note | null;
  }

  /**
   * The live notes in which every whitespace-separated word of `query` appears, ignoring case,
   * somewhere in their text: a memory note's text, a decision's title or text, a definition's
   * term or meaning. Links are ids, not words, and are not searched. A word is found wherever it
   * appears, part of a longer word included. A query with no words has none for a note to miss,
   * so it matches every note. In creation order.
   */
  async search(query: string): Promise<Note[]> {
    const words = query.toLowerCase().split(/\s+/).filter((word) => word !== "");
    return (await this.#notes()).filter((note) => {
      const texts = textsOf(note).map((text) => text.toLowerCase());
      return words.every((word) => texts.some((text) => text.includes(word)));
    });
  }

  /**
   * Every live definition, in creation order: what a reader that looks terms up by name (the agent
   * link's prompt-time lookup, ADR-0636 D1) matches against.
   */
  async definitions(): Promise<SchemaRecord<"definition">[]> {
    return (await this.#records.list("definition")).sort(byCreation);
  }

  /**
   * The live notes whose links include `noteId`, in creation order. Notes link only to notes, so a
   * story or capability has none: its knowledge is reached through frontCovers.
   */
  async relatedNotes(noteId: string): Promise<Note[]> {
    return (await this.#notes()).filter((note) => note.fields.links?.includes(noteId) === true);
  }

  /**
   * A story's or capability's shelf (capability 9): the live decisions whose `frontCoverOf` is
   * `nodeId`, founding (oldest) first. Empty for any other id.
   */
  async frontCovers(nodeId: string): Promise<SchemaRecord<"decision">[]> {
    const decisions = await this.#records.list("decision");
    return decisions.filter((decision) => decision.fields.frontCoverOf === nodeId).sort(byCreation);
  }

  /** Every live note, of all three kinds, in creation order. */
  async #notes(): Promise<Note[]> {
    const lists = await Promise.all(NOTE_TYPES.map((type) => this.#records.list(type)));
    return lists.flat().sort(byCreation);
  }

  /**
   * Every reference a note's fields hold must name a live note: its links, and an agent role's
   * required reading, rules, anti-patterns and step reading, and a process's branch edges.
   */
  async #checkNoteReferences(fields: object): Promise<void> {
    const at = fields as Record<string, unknown>;
    for (const field of ["links", "context", "rules", "antiPatterns"]) {
      await checkReferences(this.#records, field, at[field], NOTE);
    }
    for (const step of listOf(at["stepRefs"])) await checkReferences(this.#records, "stepRefs", fieldOf(step, "refs"), NOTE);
    for (const edge of listOf(at["branchEdges"])) await checkReference(this.#records, "branchEdges", fieldOf(edge, "to"), NOTE);
  }

  /** A note may link to a live note, and to nothing else. */
  #checkLinks(links: unknown): Promise<void> {
    return checkReferences(this.#records, "links", links, NOTE);
  }

  /** A decision may be the front cover of a live story or capability, and of nothing else. */
  #checkFrontCover(frontCoverOf: unknown): Promise<void> {
    return checkReference(this.#records, "frontCoverOf", frontCoverOf, COVERABLE);
  }
}

/**
 * The text a note is searched by: every piece of text in its fields, inside lists and objects
 * included, except the ones that name other notes. So a memory note is searched by its text, a
 * decision by its title and text, a definition by its term and meaning, and a friction by its
 * statement, evidence and impact among the rest.
 */
function textsOf(note: Note): string[] {
  return textsIn(note.fields);
}

function textsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(textsIn);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => (REFERENCE_FIELDS.has(key) ? [] : textsIn(item)));
  }
  return [];
}

/** `value` when it is a list, and an empty one otherwise (the schema check refuses it inside the write). */
function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** The field `key` of `value` when it is an object, and undefined otherwise. */
function fieldOf(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}
