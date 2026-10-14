/**
 * Capability 3 · Library (the command line story): read any record whole (several, and the records they link to, in one start), list a kind, search the artifacts,
 * see what links to an artifact and a record's history, all through the library's own reads; write a
 * new record of any kind, edit named fields of one, or retire one with its reason and writer.
 * Long text can come from a file; refusals are the library's own messages.
 *
 * - `new` hands the fields to the one library function that writes that kind, and the library
 *   judges them. A new contract skips the numbers its story package's tests carry, and one whose title runs past
 *   LONG_CONTRACT_TITLE characters gets an advisory quoting CONTRACT_DEFINITION, and its answer names the
 *   capability's other contracts no numbered test carries yet, as plan_contract does. Friction and re-steers are not written here: they go through Session management's
 *   capture functions (capability 9), whose evidence rules a person meets exactly as an agent does.
 * - A field's value is text, except `true`, `false`, a whole number, or one starting with `[` or
 *   `{`, which are read as JSON (a list of links, a number, a switch). `@file` reads the file.
 *   Text given for a field the library wants as a list is read as comma-separated ids (`--links a,b`),
 *   since Windows PowerShell 5.1 strips a JSON list's inner quotes; a shell-joined word is refused.
 * - Run by a session holding an increment, `edit` and `retire` of a story, capability or contract
 *   planned before it hold the change on the increment as a pending change until its branch merges
 *   (ADR-0966 D1), and `read` of the increment lists them as before and after (D3).
 * - Reads use `get`, `list` and `history`. Edits use the kind's public editor; question wording
 *   has no public editor yet, so that edit says what is missing.
 */
import { isDeepStrictEqual } from "node:util";
import { CONTRACT_DEFINITION, LONG_CONTRACT_TITLE, SchemaError, type KnowledgeKind, type Library, type PendingChange, type PhraseKind, type PlanChange, type RecordType, type WriteOptions } from "@storytree/library";

import { labelOf, Refusal, type Answer } from "../answer.js";
import { commaSeparatedIds, type Args } from "../args.js";
import type { Context, Family, Verb } from "../door.js";
import { commandSession } from "../writer.js";

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
function valueOf(text: string): unknown {
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
    (["principle", "guardrail", "pattern", "process", "agent", "techstack", "check"] as const satisfies readonly KnowledgeKind[]).map((kind) => [
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
    // A friction report says where it stands, so a settled one found by meaning reads as settled (ADR-1016 D4).
    const kindOf = (note: (typeof ranked.hits)[number]["note"]): string => note.type === "friction" ? `friction: ${note.fields.state}` : note.type;
    const lines = ranked.hits.map(({ note, score }) => `  ${score === undefined ? "" : `${score.toFixed(2)}  `}${note.id}  [${kindOf(note)}]  ${labelOf(note.fields)}`);
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
    const fields = fieldsOf(args);
    const numbers = kind === "contract" && typeof fields.capability === "string" ? await testedNumbersOf(context.cwd, library, fields.capability) : undefined;
    const options = numbers === undefined ? context.writer() : { ...context.writer(), testedNumbers: numbers.tested };
    const written = await withIdLists(fields, (given) => write(library, given, options));
    const untested = numbers?.untested ?? [];
    const open = untested.length === 0 ? "" : `\nNo numbered test carries ${untested.length === 1 ? "this other contract" : `these ${untested.length} other contracts`} of the capability yet, perhaps planned by a lane that backed off; if this contract repeats one's promise, retire it and build that one:${untested.map((title) => `\n  - ${title}`).join("")}`;
    const long = kind === "contract" && String(fields.title ?? "").length > LONG_CONTRACT_TITLE;
    const advice = long ? `\nIts title runs past ${LONG_CONTRACT_TITLE} characters, which often means more than one promise: ${CONTRACT_DEFINITION} Split it with \`storytree library edit\` and \`storytree library new contract\` if so.` : "";
    return { text: `Wrote ${kind} ${written.id}.${open}${advice}`, next: [{ command: `storytree library read ${written.id}`, why: "read it back" }] };
  },
};

/**
 * The contract numbers `capability`'s story package's numbered tests carry in the checkout `cwd` is in, and the
 * titles of its planned contracts none of them carries yet.
 */
async function testedNumbersOf(cwd: string, library: Library, capability: string): Promise<{ tested: string[]; untested: string[] }> {
  const [{ checkoutOf }, { testedNumbers, untestedContracts }] = await Promise.all([import("@storytree/guardrails"), import("@storytree/map/code-survey")]);
  const tree = await library.projectTree();
  const tested = await testedNumbers(checkoutOf(cwd), tree, capability);
  return { tested, untested: untestedContracts(tree, capability, tested) };
}

/** A record as the library returns it. */
type Stored = NonNullable<Awaited<ReturnType<Library["get"]>>>;

/** A stored record's id: its kind, an underscore and twelve hex digits. */
const RECORD_ID = /^[a-z]+_[0-9a-f]{12}$/;

/** The ids `record`'s list fields name (a note's links, a role's rules and context), in stored order. */
function idsNamedBy(record: Stored): string[] {
  return Object.values(record.fields).flatMap((value) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && RECORD_ID.test(item)) : []));
}

/** `record` whole: its heading, then each field, then an increment's pending changes. */
function wholeRecord(record: Stored): string {
  const { pending, ...rest } = record.fields as Fields & { pending?: PendingChange[] };
  const fields = Object.entries(rest).map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value, null, 2)}`);
  const held = record.type === "increment" && pending !== undefined && pending.length > 0 ? ["", ...pendingSaid(pending)] : [];
  return [`${record.id}  [${record.type}]  schema ${record.version}`, `Created: ${record.createdAt}`, `Updated: ${record.updatedAt}`, "", ...fields, ...held].join("\n");
}

const read: Verb = {
  name: "read",
  usage: "library read <id> [<id>…] [--linked] [--field <name>]",
  summary: "records, whole, in one start (--linked adds the records their id lists name); or one record's field exactly as stored",
  switches: ["linked"],
  async act(args, context) {
    args.word(0, "the record's id", this.usage);
    const ids = [...new Set(args.words)];
    const library = await context.library();
    const records = await Promise.all(ids.map((id) => library.get(id)));
    const missing = ids.filter((_, index) => records[index] === null);
    if (missing.length > 0) throw new Refusal(missing.map((id) => `no record "${id}" in this project`).join("\n"));
    const named = records as Stored[];
    const field = args.text("field");
    if (field !== undefined) {
      if (named.length > 1 || args.has("linked")) throw new Refusal(`--field reads one record's field; give one id\nusage: storytree ${this.usage}`, { code: 2 });
      const record = named[0]!;
      const value = Object.hasOwn(record.fields, field) ? (record.fields as Record<string, unknown>)[field] : undefined;
      if (value === undefined) throw new Refusal(`${record.id} has no field "${field}"; its fields are ${Object.keys(record.fields).join(", ")}`);
      return { text: typeof value === "string" ? value : JSON.stringify(value, null, 2), raw: true };
    }
    const linkedIds = args.has("linked") ? [...new Set(named.flatMap(idsNamedBy))].filter((id) => !ids.includes(id)) : [];
    const linked = await Promise.all(linkedIds.map((id) => library.get(id)));
    const gone = linkedIds.filter((_, index) => linked[index] === null);
    const shown = [...named, ...linked.filter((record): record is Stored => record !== null)];
    const note = gone.length > 0 ? [`Linked but not in this project: ${gone.join(", ")}`] : [];
    return { text: [...shown.map(wholeRecord), ...note].join("\n\n") };
  },
};

/** The kinds whose edits and retirements wait on the caller's increment until its branch merges (ADR-0966 D1). */
const PLAN_TYPES: ReadonlySet<string> = new Set(["story", "capability", "contract"]);

/**
 * Hold `change` on the increment the calling session holds, as a pending change (ADR-0966 D1), and
 * say so; undefined when it holds none, or the increment planned the record itself, and the change
 * is made live. Of several, the one it claimed last.
 */
async function heldOnIncrement(context: Context, library: Library, change: PlanChange): Promise<string | undefined> {
  const session = commandSession()?.session;
  if (session === undefined) return undefined;
  const increment = (await context.claims())
    .filter((claim) => claim.session === session && claim.increment !== undefined)
    .sort((one, other) => one.since.localeCompare(other.since))
    .at(-1)?.increment;
  if (increment === undefined) return undefined;
  const pended = await library.pendChange(increment, change, context.writer());
  if (pended === null || !("pending" in pended)) return undefined;
  return `pending on increment ${increment} until its branch merges; the live plan is unchanged.`;
}

/** An increment's pending changes (ADR-0966 D3): each record, then each field as before -> after, or its retirement. */
function pendingSaid(pending: readonly PendingChange[]): string[] {
  const said = (value: unknown): string => (value === null || value === undefined ? "(none)" : typeof value === "string" ? value : JSON.stringify(value));
  return [
    `Pending changes (${pending.length}), applied when its branch merges:`,
    ...pending.flatMap((change) => [
      `  ${change.record}  [${change.type}]  read at history entry ${change.base}`,
      ...("retire" in change ? [`    retire: ${change.retire}`] : Object.entries(change.after).map(([field, value]) => `    ${field}: ${said(change.before[field])} -> ${said(value)}`)),
    ]),
  ];
}

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
    if (PLAN_TYPES.has(record.type)) {
      const held = await withIdLists(fields, (fields) => heldOnIncrement(context, library, { record: id, fields }));
      if (held !== undefined) return { text: `Your edit of ${record.type} ${id} (${Object.keys(fields).join(", ")}) is ${held}`, next: [{ command: "storytree library read <increment>", why: "see its pending changes" }] };
    }
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
    const library = await context.library();
    if (PLAN_TYPES.has((await library.get(id))?.type ?? "")) {
      const held = await heldOnIncrement(context, library, { record: id, retire: reason });
      if (held !== undefined) return { text: `Retiring ${id} is ${held}` };
    }
    await library.retire(id, reason, context.writer());
    return { text: `Retired ${id}.` };
  },
};

const list: Verb = {
  name: "list",
  usage: "library list <kind> [--where <field>=<value>]… [--all]",
  summary: "every live record of a kind, optionally filtered by fields; settled friction (resolved or dismissed) only with --all or a --where on its state",
  switches: ["all"],
  async act(args, context) {
    const kind = args.word(0, "the kind of record", this.usage);
    const unsupported = args.names.filter((name) => name !== "where" && name !== "all");
    if (unsupported.length > 0) {
      throw new Refusal(`unsupported option${unsupported.length === 1 ? "" : "s"}: ${unsupported.map((name) => `--${name}`).join(", ")}; filter with --where <field>=<value>\nusage: storytree ${this.usage}`, { code: 2 });
    }
    const filters = args.texts("where").map((where) => {
      const equals = where.indexOf("=");
      if (equals < 1) throw new Refusal(`--where needs <field>=<value>, not ${JSON.stringify(where)}`, { code: 2 });
      return { field: where.slice(0, equals), value: valueOf(where.slice(equals + 1)) };
    });
    const matching = (await (await context.library()).list(kind as RecordType))
      .filter((record) => filters.every(({ field, value }) => isDeepStrictEqual((record.fields as Fields)[field], value)));
    // Settled friction stays live but out of the default list (ADR-1016 D4).
    const hideSettled = kind === "friction" && !args.has("all") && !filters.some(({ field }) => field === "state");
    const records = hideSettled ? matching.filter((record) => !SETTLED.has(String((record.fields as Fields)["state"]))) : matching;
    const left = matching.length - records.length;
    const leftOut = left === 0 ? [] : [`${left} settled (resolved or dismissed) left out; --all lists them.`];
    return {
      text: records.length === 0
        ? [`No ${kind} records match.`, ...leftOut].join("\n")
        : [`${records.length} ${kind} records:`, ...records.map((record) => `  ${record.id}  ${labelOf(record.fields)}`), ...leftOut].join("\n"),
      next: [{ command: "storytree library read <id>", why: "read one whole" }],
    };
  },
};

/** The friction states that leave the default list (ADR-1016 D4). */
const SETTLED: ReadonlySet<string> = new Set(["resolved", "dismissed"]);

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
