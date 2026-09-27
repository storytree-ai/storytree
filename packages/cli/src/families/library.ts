/**
 * Capability 3 · Library (stories/cli.md): read any record whole, list a kind, search the notes,
 * see what links to a note and a record's history, all through the library's own reads; write a
 * new record of any kind, or edit named fields of one, with long text taken from a file. A bad
 * record is refused with the library's own message.
 *
 * - `new` hands the fields to the one library function that writes that kind, and the library
 *   judges them. Friction and re-steers are not written here: they go through the agent link's
 *   capture functions (capability 9), whose evidence rules a person meets exactly as an agent does.
 * - A field's value is text, except `true`, `false`, a whole number, or one starting with `[` or
 *   `{`, which are read as JSON (a list of links, a number, a switch). `@file` reads the file.
 * - `read`, `edit`, `list` and `history` wait on the library's `get`, `list` and `history`
 *   (0-3-library-writer-and-public-reads).
 */
import type { KnowledgeKind, Library } from "@storytree/library";

import { labelOf, Refusal, type Answer } from "../answer.js";
import type { Args } from "../args.js";
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
type Writer = (library: Library, fields: Fields) => Promise<{ id: string }>;

/** The library's writer for each kind `new` writes. */
const WRITERS: Readonly<Record<string, Writer>> = {
  story: (library, fields) => library.addStory(fields as never),
  capability: (library, fields) => library.addCapability(fields as never),
  contract: (library, fields) => library.addContract(fields as never),
  arc: (library, fields) => library.createArc(fields as never),
  increment: (library, fields) => library.addIncrement(fields as never),
  question: (library, fields) => library.raiseQuestion(fields as never),
  memory: (library, fields) => library.writeMemory(fields as never),
  decision: (library, fields) => library.recordDecision(fields as never),
  definition: (library, fields) => library.defineTerm(fields as never),
  ...Object.fromEntries(
    (["principle", "guardrail", "pattern", "process", "agent", "techstack"] as const satisfies readonly KnowledgeKind[]).map((kind) => [
      kind,
      ((library, fields) => library.writeKnowledge(kind, fields as never)) satisfies Writer,
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
  usage: "library search <words…>",
  summary: "the notes holding every word, ignoring case",
  async act(args, context) {
    const query = args.words.join(" ").trim();
    if (query === "") throw new Refusal(`this needs the words to search for\nusage: storytree ${this.usage}`, { code: 2 });
    const notes = await (await context.library()).search(query);
    if (notes.length === 0) return { text: `No note holds "${query}".` };
    const lines = notes.map((note) => `  ${note.id}  [${note.type}]  ${labelOf(note.fields)}`);
    return {
      text: [`${notes.length} note${notes.length === 1 ? "" : "s"} holding "${query}":`, ...lines].join("\n"),
      next: [{ command: "storytree library links <note>", why: "what links to one of them" }],
    };
  },
};

const links: Verb = {
  name: "links",
  usage: "library links <note>",
  summary: "the notes that link to a note",
  async act(args, context) {
    const id = args.word(0, "the note's id", this.usage);
    const notes = await (await context.library()).relatedNotes(id);
    if (notes.length === 0) return { text: `No note links to ${id}.` };
    const lines = notes.map((note) => `  ${note.id}  [${note.type}]  ${labelOf(note.fields)}`);
    return { text: [`${notes.length} note${notes.length === 1 ? "" : "s"} link${notes.length === 1 ? "s" : ""} to ${id}:`, ...lines].join("\n") };
  },
};

const create: Verb = {
  name: "new",
  usage: "library new <kind> --<field> <value|@file> …",
  summary: "write a new record of any kind, the library judging its fields",
  async act(args, context): Promise<Answer> {
    const kind = args.word(0, "the kind of record", this.usage);
    const elsewhere = ELSEWHERE[kind];
    if (elsewhere !== undefined) throw new Refusal(`a ${kind} is written with \`${elsewhere}\`, under its evidence rules`, { code: 2 });
    const write = WRITERS[kind];
    if (write === undefined) {
      throw new Refusal(`storytree library new writes ${Object.keys(WRITERS).join(", ")}; not "${kind}"`, { code: 2 });
    }
    const written = await write(await context.library(), fieldsOf(args));
    return { text: `Wrote ${kind} ${written.id}.`, next: [{ command: `storytree library links ${written.id}`, why: "what links to it" }] };
  },
};

/** A verb whose library reading has not landed: it says so, naming what it waits on. */
function waiting(name: string, usage: string, summary: string, reading: string): Verb {
  return {
    name,
    usage,
    summary: `${summary} (not yet)`,
    act() {
      throw new Refusal(`storytree library ${name} is not built yet: it waits on the library's ${reading} on its public API (0-3-library-writer-and-public-reads)`);
    },
  };
}

export const library: Family = {
  name: "library",
  summary: "read, search and write the project's records",
  verbs: [
    search,
    links,
    create,
    waiting("read", "library read <id>", "a record, whole", "get(id)"),
    waiting("edit", "library edit <id> --<field> <value|@file> …", "change only the named fields", "get(id)"),
    waiting("list", "library list <kind> [--where <field>=<value>]", "every live record of a kind", "list(kind)"),
    waiting("history", "library history <id>", "every write to a record, with its writer", "history({ id })"),
  ],
};
