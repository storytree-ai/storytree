/**
 * Capability 6 · Knowledge artifacts (stories/library.md): alongside the plan, the library keeps
 * what the project has learned: decisions, definitions and the other proper artifact kinds. An
 * artifact links to the other artifacts it relates to, and is found again by searching its words.
 *
 * Capability 9 · Knowledge entrances: every story and capability has its own shelf of front-cover
 * decisions, and a decision can be a front cover of one of them at most. Artifacts link only to other
 * artifacts, so the only way from the work into the knowledge is through a front cover. A decision
 * names the node it is a cover of in its one `frontCoverOf` field, so no decision can be the cover
 * of two, and nothing has to check for it.
 *
 * ADR-0640 grows it by eight kinds, written with writeKnowledge: principles, guardrails, patterns,
 * processes, agent roles, friction, re-steers and tech stack. They are artifacts like decisions and definitions:
 * searched, linked only to artifacts, and edited with editNote. An agent role's required reading, rules,
 * anti-patterns and step reading, and a process's branch edges, are links to artifacts too (6-a).
 *
 * Knowledge is a layer over capability 3's SchemaRecords, so it runs unchanged on the in-memory
 * twin and on Postgres. Every link, and every front cover, is checked BEFORE the write, and a
 * broken one throws with nothing written; the artifact itself is then checked against its type inside
 * the write, as capability 3 checks every write.
 */
import { createHash } from "node:crypto";

import { byCreation } from "../creation-order.js";
import { checkReference, checkReferences, liveRecord, type Expected } from "../references.js";
import type { SchemaRecord, SchemaRecords, WriteOptions } from "../schema/index.js";
import type { FieldsOf, KnowledgeKind } from "../schema/types.js";
import { relatedTo, type Related, type RelatedOptions, type SimilarityDoc } from "./similarity.js";

/**
 * The fields that link an artifact to other artifacts (6-a), which the loop check follows: its links,
 * and an agent role's required reading, rules, anti-patterns and step reading, and a process's
 * branch edges.
 */
const LINK_FIELDS = ["links", "context", "rules", "antiPatterns", "stepRefs", "branchEdges"] as const;

/** The kinds of artifact: decisions, definitions, and the eight kinds of ADR-0640. */
export type NoteType = "decision" | "definition" | KnowledgeKind;
/** A new artifact of one of the eight kinds: its fields. Every reference in it must name a live artifact. */
export type NewKnowledge<K extends KnowledgeKind = KnowledgeKind> = FieldsOf<K>;
/** A stored artifact of any kind. */
export type Note = SchemaRecord<NoteType>;
/**
 * A new decision's fields. Every link must name a live artifact, `frontCoverOf` a live story or
 * capability, and each decision it supersedes a live decision. Its number is handed out when it is
 * recorded, unless it is brought in under its own (N1); its composed statement is composeStatement's.
 */
export type NewDecision = Omit<FieldsOf<"decision">, "composed">;
/** A decision's status as a read works it out: its own, or superseded once an accepted decision names it. */
export type DecisionStatus = FieldsOf<"decision">["status"] | "superseded";
/** A decision as the decision log reads it (capability 13). */
export interface DecisionView {
  /** The decision, its full text included, whatever its status. */
  readonly record: SchemaRecord<"decision">;
  readonly status: DecisionStatus;
  /** The accepted decisions that name it in `supersedes`, oldest first. */
  readonly supersededBy: string[];
  /** Its composed statement, marked stale once its text has changed since; absent until one is composed. */
  readonly composed?: { readonly statement: string; readonly composedAt: string; readonly stale: boolean };
}
/** A new definition's fields. Every link must name a live artifact. */
export type NewDefinition = FieldsOf<"definition">;
/** An edit of an artifact: some of its kind's fields. A field set to undefined is removed. */
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

const NOTE_TYPES: readonly NoteType[] = ["decision", "definition", ...KNOWLEDGE_KINDS];

/**
 * The fields that name other artifacts rather than hold words: never searched. (`refs` sits inside an
 * agent role's `stepRefs`, `to` inside a process's `branchEdges`.)
 */
const REFERENCE_FIELDS: ReadonlySet<string> = new Set([
  "links",
  "frontCoverOf",
  "context",
  "rules",
  "antiPatterns",
  "refs",
  "to",
  "supersedes",
  "fingerprint",
]);

/** A decision's fields that change only through their own verbs, never editNote. */
const OWN_VERBS: Readonly<Record<string, string>> = {
  number: "a decision's number never changes",
  composed: "a composed statement is written with composeStatement",
};

/** What an artifact may link to: another artifact, never the work (capability 9). */
const NOTE: Expected = {
  name: "artifact",
  types: NOTE_TYPES,
  why: "artifacts link only to other artifacts: a story or capability is reached through its front covers, the decisions whose frontCoverOf names it",
};

/** What a decision may be the front cover of (capability 9). */
const COVERABLE: Expected = { name: "story or capability", types: ["story", "capability"] };

export class Knowledge {
  readonly #records: SchemaRecords;

  constructor(records: SchemaRecords) {
    this.#records = records;
  }

  /**
   * Record a decision. Its links are checked against live artifacts, its `frontCoverOf`, if it
   * has one, must name a live story or capability, and each decision it supersedes must be live.
   * It is numbered inside the write: one past the highest number any decision has ever held, so
   * writers at the same time never share one and a retired decision's is never reused. A decision
   * brought in with its own number keeps it, unless another has held it (NumberTakenError).
   */
  async recordDecision(decision: NewDecision, options?: WriteOptions): Promise<SchemaRecord<"decision">> {
    await this.#checkLinks(decision.links);
    await this.#checkFrontCover(decision.frontCoverOf);
    await checkReferences(this.#records, "supersedes", decision.supersedes, "decision");
    return this.#records.create("decision", decision, { ...options, sequence: "number" });
  }

  /**
   * A decision as the decision log reads it: its record, full text included; its status, which is
   * superseded exactly when an accepted decision names it in `supersedes`; those decisions; and its
   * composed statement, stale once its text has changed since it was composed. Null if `id` is not
   * a live decision.
   */
  async decision(id: string): Promise<DecisionView | null> {
    const record = await liveRecord(this.#records, id, ["decision"]);
    if (record === null) return null;
    const supersededBy = (await this.#records.list("decision"))
      .filter((other) => other.fields.status === "accepted" && other.fields.supersedes?.includes(id) === true)
      .sort(byCreation)
      .map((other) => other.id);
    const composed = record.fields.composed;
    return {
      record,
      status: supersededBy.length > 0 ? "superseded" : record.fields.status,
      supersededBy,
      ...(composed === undefined
        ? {}
        : {
            composed: {
              statement: composed.statement,
              composedAt: composed.composedAt,
              stale: composed.fingerprint !== fingerprintOf(record.fields.text),
            },
          }),
    };
  }

  /**
   * Compose a decision's one statement (C2): a maintained paragraph beside its text, never in its
   * place, replacing any statement before it. It remembers the text it was composed against. Null,
   * with nothing written, if `id` is not a live decision.
   */
  async composeStatement(id: string, statement: string, options?: WriteOptions): Promise<SchemaRecord<"decision"> | null> {
    const record = await liveRecord(this.#records, id, ["decision"]);
    if (record === null) return null;
    const composed = { statement, composedAt: new Date().toISOString(), fingerprint: fingerprintOf(record.fields.text) };
    return (await this.#records.edit(id, { composed }, options)) as SchemaRecord<"decision"> | null;
  }

  /**
   * Write an artifact of one of the eight kinds (ADR-0640). Its links, and an agent role's or a process's
   * other references, must each name a live artifact, like ordinary links; its fields are then
   * checked against its kind inside the write. A kind that is not one of the eight is refused.
   */
  async writeKnowledge<K extends KnowledgeKind>(kind: K, fields: NewKnowledge<K>, options?: WriteOptions): Promise<SchemaRecord<K>> {
    if (!KNOWLEDGE_KINDS.includes(kind)) {
      throw new RangeError(`writeKnowledge writes ${KNOWLEDGE_KINDS.join(", ")}, not ${JSON.stringify(kind)}`);
    }
    await this.#checkNoteReferences(fields);
    return this.#records.create(kind, fields, options);
  }

  /** Define a term. Its links are checked against live artifacts. */
  async defineTerm(definition: NewDefinition, options?: WriteOptions): Promise<SchemaRecord<"definition">> {
    await this.#checkLinks(definition.links);
    return this.#records.create("definition", definition, options);
  }

  /**
   * Change only the named fields of an artifact, as capability 3's edit does; new links, and a new
   * front cover, are checked as they are when the artifact is written. Setting `frontCoverOf` to
   * undefined takes a decision off its node's shelf. The artifact's earlier wording stays in its
   * history. Returns null, and writes nothing, if `id` is not a live artifact.
   */
  async editNote(id: string, fields: NoteEdit, options?: WriteOptions): Promise<Note | null> {
    const own = Object.keys(fields).find((field) => Object.hasOwn(OWN_VERBS, field));
    if (own !== undefined) throw new RangeError(`editNote does not change ${JSON.stringify(own)}: ${OWN_VERBS[own]}`);
    const note = await liveRecord(this.#records, id, NOTE_TYPES);
    if (note === null) return null;
    await this.#checkNoteReferences(fields);
    if (LINK_FIELDS.some((field) => field in fields)) await this.#refuseLinkLoop(id, { ...note.fields, ...fields });
    if ("frontCoverOf" in fields) await this.#checkFrontCover(fields.frontCoverOf);
    if ("supersedes" in fields) {
      await checkReferences(this.#records, "supersedes", fields.supersedes, "decision");
      if (Array.isArray(fields.supersedes)) await this.#refuseSupersessionLoop(id, fields.supersedes);
    }
    return (await this.#records.edit(id, fields, options)) as Note | null;
  }

  /**
   * The live artifacts in which every whitespace-separated word of `query` appears, ignoring case,
   * somewhere in their text: a decision's title or text, a definition's
   * term or meaning. Links are ids, not words, and are not searched. A word is found wherever it
   * appears, part of a longer word included. A query with no words has none for an artifact to miss,
   * so it matches every artifact. In creation order.
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
   * The live artifacts whose links include `noteId`, in creation order. Artifacts link only to artifacts, so a
   * story or capability has none: its knowledge is reached through frontCovers.
   */
  async relatedNotes(noteId: string): Promise<Note[]> {
    return (await this.#notes()).filter((note) => note.fields.links?.includes(noteId) === true);
  }

  /**
   * The other live artifacts ranked by how alike they are to artifact `noteId`, each saying whether a
   * link already joins them, in either direction (ADR-0654; 0.2's `library related`). With
   * `unlinked`, only those no link reaches: the connections nobody has made yet. An artifact sharing
   * no distinguishing word with it is never listed. Null if `noteId` is not a live artifact.
   */
  async related(noteId: string, options: RelatedOptions = {}): Promise<Related | null> {
    const notes = await this.#notes();
    if (!notes.some((note) => note.id === noteId)) return null;
    return relatedTo(notes.map(similarityDocOf), noteId, options);
  }

  /**
   * A story's or capability's shelf (capability 9): the live decisions whose `frontCoverOf` is
   * `nodeId`, founding (oldest) first, except a superseded one, which leaves its shelf for its
   * successor (13-b) and is still read with decision(). Empty for any other id.
   */
  async frontCovers(nodeId: string): Promise<SchemaRecord<"decision">[]> {
    const decisions = await this.#records.list("decision");
    const superseded = new Set(decisions.filter((decision) => decision.fields.status === "accepted").flatMap((decision) => decision.fields.supersedes ?? []));
    return decisions.filter((decision) => decision.fields.frontCoverOf === nodeId && !superseded.has(decision.id)).sort(byCreation);
  }

  /**
   * Throw a SupersessionLoopError if decision `id` superseding `supersedes` would close a loop:
   * a decision may not supersede itself, directly or through others.
   */
  async #refuseSupersessionLoop(id: string, supersedes: readonly unknown[]): Promise<void> {
    const graph = new Map<string, readonly unknown[]>();
    for (const decision of await this.#records.list("decision")) graph.set(decision.id, decision.fields.supersedes ?? []);
    graph.set(id, supersedes);
    const path = loopThrough(graph, id);
    if (path !== null) throw new SupersessionLoopError(path);
  }

  /**
   * Throw a LinkLoopError if artifact `id`, holding `fields`, would close a loop through the artifacts it
   * links to (ADR-0647 D2): the knowledge is a DAG under its covers, so an artifact may not rest on
   * itself, directly or through others.
   */
  async #refuseLinkLoop(id: string, fields: object): Promise<void> {
    const graph = new Map<string, readonly unknown[]>();
    for (const note of await this.#notes()) graph.set(note.id, linksOf(note.fields));
    graph.set(id, linksOf(fields));
    const path = loopThrough(graph, id);
    if (path !== null) throw new LinkLoopError(path);
  }

  /** Every live artifact, of every supported kind, in creation order. */
  async #notes(): Promise<Note[]> {
    const lists = await Promise.all(NOTE_TYPES.map((type) => this.#records.list(type)));
    return lists.flat().sort(byCreation);
  }

  /**
   * Every reference an artifact's fields hold must name a live artifact: its links, and an agent role's
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

  /** An artifact may link to a live artifact, and to nothing else. */
  #checkLinks(links: unknown): Promise<void> {
    return checkReferences(this.#records, "links", links, NOTE);
  }

  /** A decision may be the front cover of a live story or capability, and of nothing else. */
  #checkFrontCover(frontCoverOf: unknown): Promise<void> {
    return checkReference(this.#records, "frontCoverOf", frontCoverOf, COVERABLE);
  }
}

/**
 * The text an artifact is searched by: every piece of text in its fields, inside lists and objects
 * included, except the ones that name other artifacts. A decision is searched by its title and text,
 * a definition by its term and meaning, and friction by its
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

/** An artifact as the related search ranks it: its title (a definition's term) and description apart, weighted. */
function similarityDocOf(note: Note): SimilarityDoc {
  const { title, term, description, ...rest } = note.fields as Record<string, unknown>;
  const heading = typeof title === "string" ? title : typeof term === "string" ? term : note.id;
  return {
    id: note.id,
    type: note.type,
    title: heading,
    ...(typeof description === "string" ? { description } : {}),
    body: textsIn(rest).join("\n"),
    links: linkEdgesOf(note.fields),
  };
}

/** Every link an artifact's fields hold, with the field it is in: LINK_FIELDS, and the decisions it supersedes. */
function linkEdgesOf(fields: object): { field: string; to: string }[] {
  const at = fields as Record<string, unknown>;
  const edges = (field: string, ids: unknown[]): { field: string; to: string }[] =>
    ids.filter((id): id is string => typeof id === "string").map((to) => ({ field, to }));
  return [
    ...["links", "context", "rules", "antiPatterns", "supersedes"].flatMap((field) => edges(field, listOf(at[field]))),
    ...edges("stepRefs", listOf(at["stepRefs"]).flatMap((step) => listOf(fieldOf(step, "refs")))),
    ...edges("branchEdges", listOf(at["branchEdges"]).map((edge) => fieldOf(edge, "to"))),
  ];
}

/** Every artifact id an artifact's fields link it to, through each of LINK_FIELDS. */
function linksOf(fields: object): unknown[] {
  const at = fields as Record<string, unknown>;
  return [
    ...["links", "context", "rules", "antiPatterns"].flatMap((field) => listOf(at[field])),
    ...listOf(at["stepRefs"]).flatMap((step) => listOf(fieldOf(step, "refs"))),
    ...listOf(at["branchEdges"]).map((edge) => fieldOf(edge, "to")),
  ];
}

/**
 * The first loop in `graph` from `id` back round to it, as the ids along it (`[id, …, id]`), or
 * null if there is none. Only ids that are strings are followed.
 */
function loopThrough(graph: ReadonlyMap<string, readonly unknown[]>, id: string): string[] | null {
  const path = [id];
  const seen = new Set([id]);
  const walk = (at: string): boolean => {
    for (const next of graph.get(at) ?? []) {
      if (typeof next !== "string") continue;
      path.push(next);
      if (next === id) return true;
      if (!seen.has(next)) {
        seen.add(next);
        if (walk(next)) return true;
      }
      path.pop();
    }
    return false;
  };
  return walk(id) ? path : null;
}

/** `value` when it is a list, and an empty one otherwise (the schema check refuses it inside the write). */
function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** The field `key` of `value` when it is an object, and undefined otherwise. */
function fieldOf(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

/**
 * A decision would supersede itself, directly or through others. The message names the loop, from
 * the decision being written back round to it: `A → B → A`.
 */
export class SupersessionLoopError extends Error {
  readonly path: readonly string[];

  constructor(path: readonly string[]) {
    super(`supersession loop: ${path.join(" → ")} (a decision may not supersede itself, directly or through others)`);
    this.name = "SupersessionLoopError";
    this.path = [...path];
  }
}

/**
 * An artifact would rest on itself, directly or through others (ADR-0647 D2). The message names the loop
 * from the artifact being written back round to it, `A → B → A`, so the chain it would close,
 * `B → A`, is plain. A loop that seems needed is a discussion with the owner first.
 */
export class LinkLoopError extends Error {
  readonly path: readonly string[];

  constructor(path: readonly string[]) {
    const [from, ...rest] = path;
    const chain = rest.length > 1 ? `the existing chain ${rest.join(" → ")}` : "a link to itself";
    super(`link loop between artifacts: ${path.join(" → ")} (the link from ${from} would close ${chain}; artifacts form a DAG under their covers, so an artifact may not rest on itself, directly or through others)`);
    this.name = "LinkLoopError";
    this.path = [...path];
  }
}

/** A fingerprint of a decision's text: what a composed statement remembers, to tell when it changed. */
function fingerprintOf(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}
