/**
 * Capability 3 · Library (the command line story): read any record whole, list a kind, search the artifacts,
 * see what links to an artifact and a record's history, all through the library's own reads; write a
 * new record of any kind, edit named fields of one, or retire one with its reason and writer.
 * Long text can come from a file; refusals are the library's own messages.
 *
 * - `new` hands the fields to the one library function that writes that kind, and the library
 *   judges them. Friction and re-steers are not written here: they go through the agent link's
 *   capture functions (capability 9), whose evidence rules a person meets exactly as an agent does.
 * - A field's value is text, except `true`, `false`, a whole number, or one starting with `[` or
 *   `{`, which are read as JSON (a list of links, a number, a switch). `@file` reads the file.
 *   Text given for a field the library wants as a list is read as comma-separated ids (`--links a,b`),
 *   since Windows PowerShell 5.1 strips a JSON list's inner quotes; a shell-joined word is refused.
 * - Reads use `get`, `list` and `history`. Edits use the kind's public editor; question wording
 *   has no public editor yet, so that edit says what is missing.
 */
import { isDeepStrictEqual } from "node:util";
import { SchemaError, type KnowledgeKind, type Library, type PhraseKind, type RecordType, type WriteOptions } from "@storytree/library";

import { labelOf, Refusal, type Answer } from "../answer.js";
import { commaSeparatedIds, type Args } from "../args.js";
import type { Family, Verb } from "../door.js";

/** The fields a verb was given, keyed by flag name, each value read as `new` reads it. */
export function fieldsOf(args: Args, except: readonly string[] = []): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const name of args.names) {
    if (except.includes(name)) continue;
    fields[name] = valueOf(args.text(name)!);
  }
  return fields;
}

/** A field's value: text, or JSON for `true`, `false`, a whole number, a list or an object. */
export function valueOf(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "true" || trimmed === "false" || /^-?\d+$/.test(trimmed) || trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return text;
    }
  }
  return text;
}

type Fields = Record<string, unknown>;

/**
 * `write(fields)`, and once more with each field the library refused as text for a list read as
 * comma-separated ids. The refused write wrote nothing, so a shell-joined list is refused before any write.
 */
async function withIdLists<T>(fields: Fields, write: (fields: Fields) => Promise<T>): Promise<T> {
  try {
    return await write(fields);
  } catch (error) {
    if (!(error instanceof SchemaError) || error.lists.length === 0) throw error;
    const lists = error.lists.filter((name) => typeof fields[name] === "string");
    if (lists.length === 0) throw error;
    return write({ ...fields, ...Object.fromEntries(lists.map((name) => [name, commaSeparatedIds(fields[name] as string, name)])) });
  }
}
type Writer = (library: Library, fields: Fields, options: WriteOptions) => Promise<{ id: string }>;

/** The library's writer for each kind `new` writes. */
const WRITERS: Readonly<Record<string, Writer>> = {
  story: (library, fields, options) => library.addStory(fields as never, options),
  capability: (library, fields, options) => library.addCapability(fields as never, options),
  contract: (library, fields, options) => library.addContract(fields as never, options),
  arc: (library, fields, options) => library.createArc(fields as never, options),
  increment: (library, fields, options) => library.addIncrement(fields as never, options),
  question: (library, fields, options) => library.raiseQuestion(fields as never, options),
  decision: (library, fields, options) => library.recordDecision(fields as never, options),
  definition: (library, fields, options) => library.defineTerm(fields as never, options),
  ...Object.fromEntries(
    (["principle", "guardrail", "pattern", "process", "agent", "techstack"] as const satisfies readonly KnowledgeKind[]).map((kind) => [
      kind,
      ((library, fields, options) => library.writeKnowledge(kind, fields as never, options)) satisfies Writer,
    ]),
  ),
};

/** Kinds written through another family, which keeps a rule `new` must not skip. */
const ELSEWHERE: Readonly<Record<string, string>> = {
  friction: "storytree friction new",
  resteer: "storytree resteer new",
};

const search: Verb = {
  name: "search",
  usage: "library search <words…> [--limit <n>]",
  summary: "the artifacts, stories, capabilities and contracts closest in meaning to the words, best first (10 unless --limit)",
  async act(args, context) {
    const query = args.words.join(" ").trim();
    if (query === "") throw new Refusal(`this needs the words to search for\nusage: storytree ${this.usage}`, { code: 2 });
    const limit = args.text("limit");
    if (limit !== undefined && !/^[1-9]\d*$/.test(limit)) throw new Refusal(`--limit is how many to show, a whole number above 0; got "${limit}"`, { code: 2 });
    const ranked = await (await context.library()).rankAll(query, limit === undefined ? {} : { limit: Number(limit) });
    const heading = ranked.by === "meaning" ? `closest in meaning to "${query}":` : `ranked by words: ${ranked.why}; the records holding every word of "${query}":`;
    if (ranked.hits.length === 0) return { text: `${heading}\n  none` };
    const lines = ranked.hits.map(({ note, score }) => `  ${score === undefined ? "" : `${score.toFixed(2)}  `}${note.id}  [${note.type}]  ${labelOf(note.fields)}`);
    return {
      text: [heading, ...lines].join("\n"),
      next: [{ command: "storytree library read <id>", why: "read one whole" }],
    };
  },
};

const phrase: Verb = {
  name: "phrase",
  usage: 'library phrase <text|@file> [--kind <kind>] [--field <name>] [--limit <1-100>] [--after <id>]',
  summary: "exact case-sensitive substring in stored top-level string fields; JSON records and next cursor, 10 per page; repeat kind/field to select (default: all artifacts, stories, capabilities, contracts, arcs, increments and questions); continue with the same query and selections; each page sees current state",
  async act(args, context) {
    const query = args.read(args.word(0, "one quoted literal phrase", this.usage));
    if (args.words.length !== 1) throw new Refusal(`quote the phrase as one argument\nusage: storytree ${this.usage}`, { code: 2 });
    const limit = args.text("limit");
    const after = args.text("after");
    const page = await (await context.library()).findPhrase(query, {
      ...(args.has("kind") ? { kinds: args.texts("kind") as PhraseKind[] } : {}),
      ...(args.has("field") ? { fields: args.texts("field") } : {}),
      ...(limit === undefined ? {} : { limit: Number(limit) }),
      ...(after === undefined ? {} : { after }),
    });
    return { text: JSON.stringify(page, null, 2) + "\n", raw: true };
  },
};

const links: Verb = {
  name: "links",
  usage: "library links <artifact>",
  summary: "the artifacts that link to an artifact",
  async act(args, context) {
    const id = args.word(0, "the artifact's id", this.usage);
    const notes = await (await context.library()).relatedNotes(id);
    if (notes.length === 0) return { text: `No artifact links to ${id}.` };
    const lines = notes.map((note) => `  ${note.id}  [${note.type}]  ${labelOf(note.fields)}`);
    return { text: [`${notes.length} artifact${notes.length === 1 ? "" : "s"} link${notes.length === 1 ? "s" : ""} to ${id}:`, ...lines].join("\n") };
  },
};

const related: Verb = {
  name: "related",
  usage: "library related <artifact> [--unlinked] [--kind <kind>] [--limit <n>]",
  summary: "the artifacts most like one, and whether a link joins them; --unlinked for those none does",
  switches: ["unlinked"],
  async act(args, context) {
    const id = args.word(0, "the artifact's id", this.usage);
    const limit = args.text("limit");
    if (limit !== undefined && !/^[1-9]\d*$/.test(limit)) throw new Refusal(`--limit is how many to show, a whole number above 0; got "${limit}"`, { code: 2 });
    const kind = args.text("kind");
    const unlinked = args.has("unlinked");
    const answer = await (await context.library()).related(id, {
      unlinked,
      ...(kind === undefined ? {} : { kind }),
      ...(limit === undefined ? {} : { limit: Number(limit) }),
    });
    if (answer === null) throw new Refusal(`no artifact "${id}" in this project`);
    const counts = `${answer.scanned} ranked, ${answer.linkedCount} already linked`;
    if (answer.hits.length === 0) {
      return { text: `No ${unlinked ? "unlinked " : ""}artifact is like ${id} (${counts}).` };
    }
    const lines = answer.hits.map((hit) => `  ${hit.id}  [${hit.type}]  ${hit.title}  (${hit.linked ? `linked via ${hit.linkVia.join(", ")}` : "unlinked"}; ${hit.matched.join(", ")})`);
    return {
      text: [`Like ${id}, on ${answer.terms.join(", ")} (${counts}):`, ...lines].join("\n"),
      next: [{ command: "storytree library read <id>", why: "read one whole" }],
    };
  },
};

const create: Verb = {
  name: "new",
  usage: "library new <kind> --<field> <value|@file> …",
  summary: "write a new record of any kind, the library judging its fields",
  async act(args, context): Promise<Answer> {
    const kind = args.word(0, "the kind of record", this.usage);
    if (kind === "memory") throw new Refusal("memory belongs to the agent harness, not the library (ADR-0650); write an artifact kind such as decision, definition or principle", { code: 2 });
    const elsewhere = ELSEWHERE[kind];
    if (elsewhere !== undefined) throw new Refusal(`a ${kind} is written with \`${elsewhere}\`, under its evidence rules`, { code: 2 });
    const write = WRITERS[kind];
    if (write === undefined) {
      throw new Refusal(`storytree library new writes ${Object.keys(WRITERS).join(", ")}; not "${kind}"`, { code: 2 });
    }
    const library = await context.library();
    const written = await withIdLists(fieldsOf(args), (fields) => write(library, fields, context.writer()));
    return { text: `Wrote ${kind} ${written.id}.`, next: [{ command: `storytree library read ${written.id}`, why: "read it back" }] };
  },
};

const read: Verb = {
  name: "read",
  usage: "library read <id> [--field <name>]",
  summary: "a record, whole; or one field exactly as stored, nothing else",
  async act(args, context) {
    const id = args.word(0, "the record's id", this.usage);
    const record = await (await context.library()).get(id);
    if (record === null) throw new Refusal(`no record "${id}" in this project`);
    const field = args.text("field");
    if (field !== undefined) {
      const value = Object.hasOwn(record.fields, field) ? (record.fields as Record<string, unknown>)[field] : undefined;
      if (value === undefined) throw new Refusal(`${id} has no field "${field}"; its fields are ${Object.keys(record.fields).join(", ")}`);
      return { text: typeof value === "string" ? value : JSON.stringify(value, null, 2), raw: true };
    }
    const fields = Object.entries(record.fields).map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value, null, 2)}`);
    return {
      text: [`${record.id}  [${record.type}]  schema ${record.version}`, `Created: ${record.createdAt}`, `Updated: ${record.updatedAt}`, "", ...fields].join("\n"),
    };
  },
};

const edit: Verb = {
  name: "edit",
  usage: "library edit <id> --<field> <value|@file> …",
  summary: "change only the named fields, through the kind's editor",
  async act(args, context) {
    const id = args.word(0, "the record's id", this.usage);
    const library = await context.library();
    const record = await library.get(id);
    if (record === null) throw new Refusal(`no record "${id}" in this project`);
    if (record.type === "question" && record.fields.lifecycle === "settled") {
      throw new Refusal(`question ${id} is settled, so its wording cannot change: its answer stands`);
    }
    const fields = fieldsOf(args);
    if (Object.keys(fields).length === 0) return { text: `No fields given: ${id} is unchanged.` };
    const writer = context.writer();
    const edited = await withIdLists(fields, async (fields) => {
      switch (record.type) {
        case "story": return library.editStory(id, fields as never, writer);
        case "capability": return library.editCapability(id, fields as never, writer);
        case "contract": return library.editContract(id, fields as never, writer);
        case "arc": return library.editArc(id, fields as never, writer);
        case "increment": return library.editIncrement(id, fields as never, writer);
        case "question": return library.editQuestion(id, fields as never, writer);
        default: return library.editNote(id, fields as never, writer);
      }
    });
    if (edited === null) throw new Refusal(`no live ${record.type} "${id}" in this project`);
    return { text: `Edited ${record.type} ${id}: ${Object.keys(fields).join(", ")}.`, next: [{ command: `storytree library read ${id}`, why: "read it back" }] };
  },
};

const retire: Verb = {
  name: "retire",
  usage: "library retire <id> --reason <why>",
  summary: "retire a record, keeping its reason and writer in history",
  async act(args, context) {
    const id = args.word(0, "the record's id", this.usage);
    const reason = args.need("reason", this.usage);
    await (await context.library()).retire(id, reason, context.writer());
    return { text: `Retired ${id}.` };
  },
};

const list: Verb = {
  name: "list",
  usage: "library list <kind> [--where <field>=<value>]…",
  summary: "every live record of a kind, optionally filtered by fields",
  async act(args, context) {
    const kind = args.word(0, "the kind of record", this.usage);
    const filters = args.texts("where").map((where) => {
      const equals = where.indexOf("=");
      if (equals < 1) throw new Refusal(`--where needs <field>=<value>, not ${JSON.stringify(where)}`, { code: 2 });
      return { field: where.slice(0, equals), value: valueOf(where.slice(equals + 1)) };
    });
    const records = (await (await context.library()).list(kind as RecordType))
      .filter((record) => filters.every(({ field, value }) => isDeepStrictEqual((record.fields as Fields)[field], value)));
    return {
      text: records.length === 0 ? `No ${kind} records match.` : [`${records.length} ${kind} records:`, ...records.map((record) => `  ${record.id}  ${labelOf(record.fields)}`)].join("\n"),
      next: [{ command: "storytree library read <id>", why: "read one whole" }],
    };
  },
};

const history: Verb = {
  name: "history",
  usage: "library history <id> [--fields]",
  summary: "every write with its writer; --fields includes stored fields after each write (last state for retirement)",
  switches: ["fields"],
  async act(args, context) {
    const id = args.word(0, "the record's id", this.usage);
    const entries = await (await context.library()).history({ id });
    if (entries.length === 0) return { text: `No history for ${id}.` };
    return { text: [`History of ${id}:`, ...entries.flatMap((entry) => [
      `  ${entry.seq}  ${entry.at}  ${entry.action}  ${entry.actor ?? "writer not recorded"}${entry.reason === undefined ? "" : `  ${entry.reason}`}`,
      ...(args.has("fields") ? [`    fields: ${JSON.stringify(entry.record.fields)}`] : []),
    ],
    )].join("\n") };
  },
};

export const library: Family = {
  name: "library",
  summary: "read, search and write the project's records",
  guesses: { show: "library read <id>", get: "library read <id>", open: "library read <id>", view: "library read <id>", pull: "library read <id>", artifact: "library read <id>" },
  verbs: [
    search,
    phrase,
    links,
    related,
    create,
    read,
    edit,
    retire,
    list,
    history,
  ],
};
