/**
 * Capability 17 · The library's commands (ADR-1035 D3): the `storytree library` family the library declares in its
 * manifest's `verbs`, first among `storytree`'s families: read any record whole (several, and the records they link to,
 * in one start), list a kind, search the artifacts, see what links to an artifact and a record's history, all through
 * the library's own reads; write a new record of any kind, edit named fields of one, refile an artifact as another
 * kind under its id (ADR-1058 D2), or retire one with its reason and
 * writer. Long text can come from a file; refusals are the library's own messages. No verb is a tool: an agent searches,
 * opens, writes and corrects artifacts with the tools the library declares beside them (notes.ts), which record its reads.
 * Capability 27's fixed data questions (`count`, `changes`, `find`) join the family from data/commands.ts, and `read`
 * takes a decision's number in place of its id. Beside it the list mounts capability 13's `adr` family (adr.ts, ADR-1077 D2), the `fyi` family (fyi.ts, ADR-1184 D3) and the `media` family (media.ts, ADR-1234 D3), whose verbs are tools too.
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
 * - Run by a session holding an increment claimed on a branch, `edit` and `retire` of a story, capability or contract
 *   planned before it hold the change on the increment as a pending change until its branch merges
 *   (ADR-0966 D1), and `read` of the increment lists them as before and after (D3); one claimed on no branch or
 *   the main line has none to merge, so its edits are live (friction_f02365572601).
 * - `exact` sweeps every page of `phrase`'s search for a link sweep: each record holding the phrase, with the fields
 *   that hold it (friction_45f8338e8931); the find_text tool sweeps the same way.
 * - A plugin kind no mounted plugin declares stays out of `list`, `search` and `phrase` (ADR-1178 D3), never in silence:
 *   each says how many of its records the library holds, that they are dormant here, and how to mount the plugin.
 * - Reads use `get`, `list` and `history`. Edits use the kind's public editor; question wording
 *   has no public editor yet, so that edit says what is missing.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { ANCHOR_ID, CONTRACT_DEFINITION, LONG_CONTRACT_TITLE, SchemaError, type KnowledgeKind, type Library, type PendingChange, type PhraseKind, type PlanChange, type RecordType, type SchemaRecord, type WriteOptions } from "../index.js";
import { PR_CUTOVER_ID } from "../work/index.js";
import { editPlanRecord, heldIncrement, heldPending, heldSaid, holdPlanChange, isPlanRecordType, PLAN_TYPES, type PlanEdit } from "../work/plan-hold.js";
import { fieldValue, verb, VerbRefusal, type DoorWords, type VerbContext, type VerbFamily } from "../verbs/verb.js";
import { changes, count, decisionNamed, find } from "../data/commands.js";
import { ADR_FAMILY } from "./adr.js";
import { FYI_FAMILY } from "./fyi.js";
import { MEDIA_FAMILY } from "./media.js";
export { mediaGuidance } from "./media.js";
import { editDecision, recordDecision } from "../librarian/decision-log/index.js";
import { LaterWriterError, StaleRevertError } from "../transactions/index.js";
import { narrowedSaid, rankedSearch } from "./ranked.js";
import { refuseStaleEdit } from "./stale-edit.js";

/** A claim as the door reads it: the session holding it, the increment or capability it is for, and since when. */
export interface HeldClaim {
  readonly session: string;
  readonly increment?: string | undefined;
  readonly capability?: string | undefined;
  readonly since: string;
  readonly branch?: string | undefined;
}

/**
 * The caller, with what the library's verbs need from above the library, which the door hands them: the project's
 * claims, and the contract numbers a capability's story package's numbered tests carry in the caller's checkout, with
 * the titles of its planned contracts none of them carries yet.
 */
export interface LibraryVerbContext extends VerbContext {
  claims(): Promise<readonly HeldClaim[]>;
  testedNumbers(capability: string): Promise<{ readonly tested: readonly string[]; readonly untested: readonly string[] }>;
  /** Whether this computer's factory folder holds the plugin `plugin`, which `settings set part` can mount; unsaid when the door cannot tell. */
  pluginInFactory?(plugin: string): Promise<boolean>;
}

type Fields = Record<string, unknown>;

/** A record's one-line label: its title, term or text, cut at 100 characters. */
function labelOf(fields: Readonly<Fields>): string {
  const title = typeof fields.title === "string" ? fields.title : typeof fields.term === "string" ? fields.term : typeof fields.text === "string" ? fields.text : "";
  const line = title.split(/\r?\n/, 1)[0] ?? "";
  return line.length > 100 ? `${line.slice(0, 99)}…` : line;
}

/** The fields given, each value read as `new` reads it. */
function fieldsOf(given: Readonly<Record<string, string>>): Fields {
  return Object.fromEntries(Object.entries(given).map(([name, text]) => [name, fieldValue(text)]));
}

/** Comma-separated ids: refuse a shell-joined word, never infer its intended ids. */
function commaSeparatedIds(value: string, name: string): string[] {
  const ids = value.split(",").map((one) => one.trim()).filter((one) => one !== "");
  if (ids.some((id) => /\s/.test(id))) {
    throw new VerbRefusal(
      `--${name} contains whitespace inside an id. PowerShell may have converted an unquoted comma list to an array and joined it with spaces. Retry with the whole comma-separated list quoted, for example --${name} "id1,id2" (replace id1 and id2 with your intended ids). No ids were guessed or split on whitespace.`,
      { misuse: true },
    );
  }
  return ids;
}

/**
 * `value`, or the text of the file it names when it is `@file` (relative to the caller's folder), without a leading
 * byte-order mark: PowerShell 5.1's `Set-Content -Encoding utf8` writes one. An `@` value holding whitespace that names
 * no file is prose, kept as written; a one-word one is a path, so a mistyped file is refused.
 */
function readAt(value: string, folder: string): string {
  if (!value.startsWith("@") || value.length === 1) return value;
  const file = path.resolve(folder, value.slice(1));
  try {
    return readFileSync(file, "utf8").replace(/^﻿/, "");
  } catch (error) {
    const missing = ["ENOENT", "ENOTDIR", "EINVAL"].includes((error as NodeJS.ErrnoException).code ?? "");
    if (missing && /\s/.test(value)) return value;
    throw new VerbRefusal(`cannot read ${file}: ${(error as Error).message}`);
  }
}

/** `value`, or a misuse saying the verb needs `what`. */
function needed<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new VerbRefusal(`this needs ${what}`, { misuse: true });
  return value;
}

/** `limit`, refused unless a whole number above 0. */
function countOf(limit: string | undefined): number | undefined {
  if (limit !== undefined && !/^[1-9]\d*$/.test(limit)) throw new VerbRefusal(`--limit is how many to show, a whole number above 0; got "${limit}"`, { misuse: true });
  return limit === undefined ? undefined : Number(limit);
}

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
  edge: (library, fields, options) => library.addEdge(fields as never, options),
  arc: (library, fields, options) => library.createArc(fields as never, options),
  increment: (library, fields, options) => library.addIncrement(fields as never, options),
  question: (library, fields, options) => library.raiseQuestion(fields as never, options),
  decision: (library, fields, options) => recordDecision(library, fields as never, options),
  definition: (library, fields, options) => library.defineTerm(fields as never, options),
  ...Object.fromEntries(
    (["principle", "guardrail", "pattern", "process", "agent", "techstack", "check", "research", "experiment"] as const satisfies readonly KnowledgeKind[]).map((kind) => [
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

/**
 * A line for each plugin kind among `kinds` (every one, when not given) whose records the library holds but read dormant
 * here (ADR-1178 D3): how many, why, and the command that mounts its plugin, or that this computer's factory has none. A
 * list leaves them out; this says so, never showing them.
 */
async function dormantSaid(context: LibraryVerbContext, words: DoorWords, kinds?: readonly string[]): Promise<string[]> {
  const dormant = (await context.library.dormantKinds()).filter(({ kind }) => kinds === undefined || kinds.includes(kind));
  return Promise.all(dormant.map(async ({ kind, count }) => {
    const plugin = kind.slice(0, kind.indexOf("."));
    const mount = words.say({ command: `settings set part ${plugin} plugin ${plugin}` });
    const how = await context.pluginInFactory?.(plugin) === false ? `${plugin} is not in this computer's factory, so it cannot be mounted here` : `mount it with ${mount}`;
    return `${count} ${kind} ${count === 1 ? "record is" : "records are"} dormant here: ${count === 1 ? "its" : "their"} plugin, ${plugin}, is not mounted on this computer; ${how}.`;
  }));
}

const NOT_A_TOOL = { absent: "an agent's artifact tools are search_notes, find_text, open, write_note and correct_note, which record its reads" } as const;

const search = verb({
  command: {
    family: "library",
    name: "search",
    summary: "the artifacts, stories, capabilities and contracts closest in meaning to the words, best first (10 unless --limit); current state only: resteers, friction and superseded decisions come back with --history, or a resteer or friction with --kind",
    usage: "library search <words…> [--limit <n>] [--history] [--kind <kind>]",
  },
  tool: NOT_A_TOOL,
  inputs: {
    words: { kind: "text", word: 0, many: true, optional: true, blank: true, describe: "the words to search for" },
    limit: { kind: "text", optional: true, describe: "how many to show" },
    history: { kind: "switch", describe: "rank resteers, friction and superseded decisions too" },
    kind: { kind: "text", many: true, optional: true, describe: "only this kind" },
  },
  async act({ words, limit, history, kind }, context: LibraryVerbContext, door) {
    const query = words.join(" ").trim();
    if (query === "") throw new VerbRefusal("this needs the words to search for", { misuse: true });
    const count = countOf(limit);
    const ranked = await rankedSearch(context.library, query, { ...(count === undefined ? {} : { limit: count }), history, kinds: kind });
    const heading = ranked.by === "meaning" ? `closest in meaning to "${query}":` : `ranked by words: ${ranked.why}; the records holding every word of "${query}":`;
    // Records of a plugin kind no mounted plugin declares are never ranked; the answer says so (ADR-1178 D3).
    const dormant = await dormantSaid(context, door);
    if (ranked.hits.length === 0) return { text: [heading, "  none", ...dormant].join("\n") };
    // A friction report says where it stands, so a settled one found by meaning reads as settled (ADR-1016 D4).
    const kindOf = (note: (typeof ranked.hits)[number]["note"]): string => note.type === "friction" ? `friction: ${note.fields.state}` : note.type;
    const lines = ranked.hits.map(({ note, score, narrowedBy }) => `  ${score === undefined ? "" : `${score.toFixed(2)}  `}${note.id}  [${kindOf(note)}]  ${labelOf(note.fields)}${narrowedSaid(narrowedBy)}`);
    return { text: [heading, ...lines, ...dormant].join("\n"), next: [{ command: "library read <id>", why: "read one whole" }] };
  },
});

const phrase = verb({
  command: {
    family: "library",
    name: "phrase",
    summary: "exact case-sensitive substring in stored top-level string fields; JSON records and next cursor, 10 per page; repeat kind/field to select (default: all artifacts, stories, capabilities, contracts, arcs, increments and questions); continue with the same query and selections; each page sees current state",
    usage: "library phrase <text|@file> [--kind <kind>] [--field <name>] [--limit <1-100>] [--after <id>]",
  },
  tool: NOT_A_TOOL,
  inputs: {
    phrase: { kind: "text", word: 0, many: true, optional: true, verbatim: true, describe: "one quoted literal phrase" },
    kind: { kind: "text", many: true, optional: true, describe: "a kind to search" },
    field: { kind: "text", many: true, optional: true, describe: "a field to search" },
    limit: { kind: "text", optional: true, describe: "how many to a page" },
    after: { kind: "text", optional: true, describe: "the cursor to continue from" },
  },
  async act({ phrase: words, kind, field, limit, after }, context: LibraryVerbContext, door) {
    const query = readAt(needed(words[0], "one quoted literal phrase"), context.folder);
    if (words.length !== 1) throw new VerbRefusal("quote the phrase as one argument", { misuse: true });
    const dormant = kind.length === 0 ? [] : await dormantSaid(context, door, kind);
    if (dormant.length > 0) throw new VerbRefusal(dormant.join("\n"));
    const page = await context.library.findPhrase(query, {
      ...(kind.length > 0 ? { kinds: kind as PhraseKind[] } : {}),
      ...(field.length > 0 ? { fields: [...field] } : {}),
      ...(limit === undefined ? {} : { limit: Number(limit) }),
      ...(after === undefined ? {} : { after }),
    });
    return { text: JSON.stringify(page, null, 2) + "\n", raw: true };
  },
});

/** One record holding a phrase, its title's first line, and its stored top-level string fields that hold it, by name. */
export interface PhraseHit {
  readonly record: SchemaRecord<PhraseKind>;
  readonly title: string;
  readonly fields: readonly string[];
}

/** Every live record holding `phrase` exactly, following findPhrase's cursor to the end, in id order. */
export async function everyHolding(library: Library, phrase: string, options: { kinds?: readonly PhraseKind[]; fields?: readonly string[] } = {}): Promise<PhraseHit[]> {
  const hits: PhraseHit[] = [];
  let after: string | undefined;
  do {
    const page = await library.findPhrase(phrase, { ...options, limit: 100, ...(after === undefined ? {} : { after }) });
    for (const record of page.records) {
      const fields = Object.entries(record.fields)
        .filter(([key, value]) => (options.fields === undefined || options.fields.includes(key)) && typeof value === "string" && value.includes(phrase))
        .map(([key]) => key)
        .sort();
      hits.push({ record, title: labelOf(record.fields), fields });
    }
    after = page.next;
  } while (after !== undefined);
  return hits;
}

/** A sweep's answer: how many records hold the phrase, then a line for each. */
export function holdingLines(phrase: string, hits: readonly PhraseHit[]): string {
  if (hits.length === 0) return `No record holds ${JSON.stringify(phrase)} exactly.`;
  const heading = `${hits.length} ${hits.length === 1 ? "record holds" : "records hold"} ${JSON.stringify(phrase)} exactly:`;
  return [heading, ...hits.map(({ record, title, fields }) => `  ${record.id}  [${record.type}]  ${title}  (${fields.join(", ")})`)].join("\n");
}

const exact = verb({
  command: {
    family: "library",
    name: "exact",
    summary: "every live record holding a phrase exactly (case-sensitive, in stored top-level string fields), each with its id, kind, title and the fields that hold it, all pages; repeat kind/field to narrow; for a link sweep",
    usage: "library exact <text|@file> [--kind <kind>] [--field <name>]",
  },
  tool: NOT_A_TOOL,
  inputs: {
    phrase: { kind: "text", word: 0, many: true, optional: true, verbatim: true, describe: "one quoted literal phrase" },
    kind: { kind: "text", many: true, optional: true, describe: "a kind to search" },
    field: { kind: "text", many: true, optional: true, describe: "a field to search" },
  },
  async act({ phrase: words, kind, field }, context: LibraryVerbContext, door) {
    const query = readAt(needed(words[0], "one quoted literal phrase"), context.folder);
    if (words.length !== 1) throw new VerbRefusal("quote the phrase as one argument", { misuse: true });
    const dormant = kind.length === 0 ? [] : await dormantSaid(context, door, kind);
    if (dormant.length > 0) throw new VerbRefusal(dormant.join("\n"));
    const hits = await everyHolding(context.library, query, {
      ...(kind.length > 0 ? { kinds: kind as PhraseKind[] } : {}),
      ...(field.length > 0 ? { fields: [...field] } : {}),
    });
    return { text: holdingLines(query, hits), ...(hits.length === 0 ? {} : { next: [{ command: "library read <id>", why: "read one whole" }] }) };
  },
});

const links = verb({
  command: { family: "library", name: "links", summary: "the artifacts that link to an artifact", usage: "library links <artifact>" },
  tool: NOT_A_TOOL,
  inputs: { artifact: { kind: "text", word: 0, optional: true, describe: "the artifact's id" } },
  async act({ artifact }, context: LibraryVerbContext) {
    const id = needed(artifact, "the artifact's id");
    const notes = await context.library.relatedNotes(id);
    if (notes.length === 0) return { text: `No artifact links to ${id}.` };
    const lines = notes.map((note) => `  ${note.id}  [${note.type}]  ${labelOf(note.fields)}`);
    return { text: [`${notes.length} artifact${notes.length === 1 ? "" : "s"} link${notes.length === 1 ? "s" : ""} to ${id}:`, ...lines].join("\n") };
  },
});

const related = verb({
  command: { family: "library", name: "related", summary: "the artifacts most like one, and whether a link joins them; --unlinked for those none does", usage: "library related <artifact> [--unlinked] [--kind <kind>] [--limit <n>]" },
  tool: NOT_A_TOOL,
  inputs: {
    artifact: { kind: "text", word: 0, optional: true, describe: "the artifact's id" },
    unlinked: { kind: "switch", describe: "only those no link joins" },
    kind: { kind: "text", optional: true, describe: "only this kind" },
    limit: { kind: "text", optional: true, describe: "how many to show" },
  },
  async act({ artifact, unlinked, kind, limit }, context: LibraryVerbContext) {
    const id = needed(artifact, "the artifact's id");
    const count = countOf(limit);
    const answer = await context.library.related(id, {
      unlinked,
      ...(kind === undefined ? {} : { kind }),
      ...(count === undefined ? {} : { limit: count }),
    });
    if (answer === null) throw new VerbRefusal(`no artifact "${id}" in this project`);
    const counts = `${answer.scanned} ranked, ${answer.linkedCount} already linked`;
    if (answer.hits.length === 0) return { text: `No ${unlinked ? "unlinked " : ""}artifact is like ${id} (${counts}).` };
    const lines = answer.hits.map((hit) => `  ${hit.id}  [${hit.type}]  ${hit.title}  (${hit.linked ? `linked via ${hit.linkVia.join(", ")}` : "unlinked"}; ${hit.matched.join(", ")})`);
    return { text: [`Like ${id}, on ${answer.terms.join(", ")} (${counts}):`, ...lines].join("\n"), next: [{ command: "library read <id>", why: "read one whole" }] };
  },
});

const create = verb({
  command: { family: "library", name: "new", summary: "write a new record of any kind, the library judging its fields", usage: "library new <kind> --<field> <value|@file> …" },
  tool: NOT_A_TOOL,
  writes: true,
  inputs: {
    "<kind>": { kind: "text", word: 0, optional: true, describe: "the kind of record" },
    "<fields>": { kind: "fields", describe: "the record's fields" },
  },
  async act({ "<kind>": given, "<fields>": values }, context: LibraryVerbContext) {
    const kind = needed(given, "the kind of record");
    if (kind === "memory") throw new VerbRefusal("memory belongs to the agent harness, not the library (ADR-0650); write an artifact kind such as decision, definition or principle", { misuse: true });
    const elsewhere = ELSEWHERE[kind];
    if (elsewhere !== undefined) throw new VerbRefusal(`a ${kind} is written with \`${elsewhere}\`, under its evidence rules`, { misuse: true });
    const write = WRITERS[kind];
    if (write === undefined) throw new VerbRefusal(`storytree library new writes ${Object.keys(WRITERS).join(", ")}; not "${kind}"`, { misuse: true });
    const fields = fieldsOf(values);
    // An accepted decision says whose call it was (friction_b2b343a7a75e): `adr new` asks for it.
    if (kind === "decision" && fields.status === "accepted" && fields.authority === undefined) {
      throw new VerbRefusal("an accepted decision carries its authority, whose call it was: record it with `storytree adr new … --basis <owner-directed|owner-ratified|agent-derived|agent-flipped> [--owner-said …]`, or give --authority @file holding its JSON", { misuse: true });
    }
    const numbers = kind === "contract" && typeof fields.capability === "string" ? await context.testedNumbers(fields.capability) : undefined;
    const pending = kind === "capability" ? { pending: await heldPending(context.library, await context.claims(), context.session) } : {};
    const options = numbers === undefined ? { ...context.writer!, ...pending } : { ...context.writer!, testedNumbers: [...numbers.tested] };
    const written = await withIdLists(fields, (fields) => write(context.library, fields, options));
    const untested = numbers?.untested ?? [];
    const open = untested.length === 0 ? "" : `\nNo numbered test carries ${untested.length === 1 ? "this other contract" : `these ${untested.length} other contracts`} of the capability yet, planned but not built; if this contract repeats one of them, retire it and build that one:${untested.map((title) => `\n  - ${title}`).join("")}`;
    const long = kind === "contract" && String(fields.title ?? "").length > LONG_CONTRACT_TITLE;
    const advice = long ? `\nIts title runs past ${LONG_CONTRACT_TITLE} characters, which often means more than one contract: ${CONTRACT_DEFINITION} Split it with \`storytree library edit\` and \`storytree library new contract\` if so.` : "";
    return { text: `Wrote ${kind} ${written.id}.${open}${advice}`, next: [{ command: `library read ${written.id}`, why: "read it back" }] };
  },
});

/** A record as the library returns it. */
type Stored = NonNullable<Awaited<ReturnType<Library["get"]>>>;

/** `record`, and for a capability with links its dependsOn as the plan's tree gives it (ADR-1282 D1). */
async function withDependsOn(library: Library, record: Stored): Promise<Stored> {
  if (record.type !== "capability") return record;
  const dependsOn = (await library.dependsOn(record.id)) ?? [];
  const fields = record.fields as { dependsOn?: string[] };
  return dependsOn.length === 0 && fields.dependsOn === undefined ? record : { ...record, fields: { ...record.fields, dependsOn } } as Stored;
}

const moveToEdges = verb({
  command: { family: "library", name: "move-to-edges", summary: "move every capability's stored dependsOn ids of its own story onto edges, each capability's dependsOn reading the same (ADR-1282 D2)", usage: "library move-to-edges" },
  tool: NOT_A_TOOL,
  writes: true,
  inputs: {},
  async act(_inputs, context: LibraryVerbContext) {
    const moved = await context.library.moveDependsOnToEdges(context.writer!);
    if (moved.edges.length === 0 && moved.capabilities.length === 0) return { text: "No capability stores an id of its own story in its dependsOn: nothing to move." };
    return { text: `Moved ${moved.edges.length} ${moved.edges.length === 1 ? "link" : "links"} onto edges, from ${moved.capabilities.length} ${moved.capabilities.length === 1 ? "capability" : "capabilities"}: ${moved.capabilities.join(", ")}.` };
  },
});

/** A stored record's id: its kind, an underscore and twelve hex digits. */
const RECORD_ID = /^[a-z]+_[0-9a-f]{12}$/;

/** The ids `record`'s list fields name (a note's links, a role's rules and context), in stored order. */
function idsNamedBy(record: Stored): string[] {
  return Object.values(record.fields).flatMap((value) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && RECORD_ID.test(item)) : []));
}

/** `record` whole: its heading, then each field, then an increment's pending changes. */
export function wholeRecord(record: Stored): string {
  const { pending, ...rest } = record.fields as Fields & { pending?: PendingChange[] };
  const fields = Object.entries(rest).map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value, null, 2)}`);
  const held = record.type === "increment" && pending !== undefined && pending.length > 0 ? pendingSaid(pending) : [];
  // A plugin's kind no mounted plugin declares reads as stored, said dormant (ADR-1178 D3).
  const dormant = record.dormant === true ? "  dormant: its plugin is not mounted on this computer" : "";
  return [`${record.id}  [${record.type}]  schema ${record.version}${dormant}`, `Created: ${record.createdAt}`, `Updated: ${record.updatedAt}`, "", ...fields, ...held].join("\n");
}

const read = verb({
  command: { family: "library", name: "read", summary: "records, whole, in one start (--linked adds the records their id lists name); or one record's field exactly as stored", usage: "library read <id|decision number> [<id>…] [--linked] [--field <name> [--out <file>]]" },
  tool: NOT_A_TOOL,
  inputs: {
    ids: { kind: "text", word: 0, many: true, optional: true, describe: "the records' ids" },
    linked: { kind: "switch", describe: "add the records their id lists name" },
    field: { kind: "text", optional: true, describe: "one field to read exactly as stored" },
    out: { kind: "text", optional: true, describe: "a file to write the field to instead of printing it (relative to the caller's folder), so pnpm's script banner cannot reach it" },
  },
  async act({ ids: given, linked: withLinked, field, out }, context: LibraryVerbContext) {
    needed(given[0], "the record's id");
    if (out !== undefined && field === undefined) throw new VerbRefusal("--out writes one field; give --field <name> with it", { misuse: true });
    // A decision may be named by its number (1103 or ADR-1103), capability 27's lookup.
    const ids = [...new Set(await Promise.all(given.map(async (id) => (await decisionNamed(context.library, id)) ?? id)))];
    const library = context.library;
    const records = await Promise.all(ids.map((id) => library.get(id)));
    const missing = ids.filter((_, index) => records[index] === null);
    if (missing.length > 0) throw new VerbRefusal(missing.map((id) => `no record "${id}" in this project`).join("\n"));
    // A capability's dependsOn reads as the plan's tree gives it, its story's edges included (ADR-1282 D1).
    const named = await Promise.all((records as Stored[]).map((record) => withDependsOn(library, record)));
    if (field !== undefined) {
      if (named.length > 1 || withLinked) throw new VerbRefusal("--field reads one record's field; give one id", { misuse: true });
      const record = named[0]!;
      const value = Object.hasOwn(record.fields, field) ? (record.fields as Fields)[field] : undefined;
      if (value === undefined) throw new VerbRefusal(`${record.id} has no field "${field}"; its fields are ${Object.keys(record.fields).join(", ")}`);
      const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
      if (out === undefined) return { text, raw: true };
      const file = path.resolve(context.folder, out);
      writeFileSync(file, text, "utf8");
      return { text: `Wrote ${record.id}'s ${field} to ${file}.` };
    }
    const linkedIds = withLinked ? [...new Set(named.flatMap(idsNamedBy))].filter((id) => !ids.includes(id)) : [];
    const linked = await Promise.all(linkedIds.map((id) => library.get(id)));
    const gone = linkedIds.filter((_, index) => linked[index] === null);
    const shown = [...named, ...linked.filter((record): record is Stored => record !== null)];
    const note = gone.length > 0 ? [`Linked but not in this project: ${gone.join(", ")}`] : [];
    return { text: [...shown.map(wholeRecord), ...note].join("\n\n") };
  },
});

/** Hold `change` on the increment the calling session holds (ADR-0966 D1), and say so; undefined when the change is made live. */
async function heldOnIncrement(context: LibraryVerbContext, change: PlanChange): Promise<string | undefined> {
  const increment = await holdPlanChange(context.library, await context.claims(), context.session, change, context.writer!);
  return increment === undefined ? undefined : heldSaid(increment);
}

/**
 * An increment's pending changes (ADR-0966 D3), under the field's own name as every other field is, so a reader
 * looking for `pending` finds them: each record, then each field as before -> after, or its retirement.
 */
function pendingSaid(pending: readonly PendingChange[]): string[] {
  const said = (value: unknown): string => (value === null || value === undefined ? "(none)" : typeof value === "string" ? value : JSON.stringify(value));
  return [
    `pending: ${pending.length} ${pending.length === 1 ? "change" : "changes"}, applied when its branch merges:`,
    ...pending.flatMap((change) => [
      `  ${change.record}  [${change.type}]  read at history entry ${change.base}`,
      ...("retire" in change ? [`    retire: ${change.retire}`] : Object.entries(change.after).map(([field, value]) => `    ${field}: ${said(change.before[field])} -> ${said(value)}`)),
    ]),
  ];
}

const edit = verb({
  command: { family: "library", name: "edit", summary: "change only the named fields, through the kind's editor", usage: "library edit <id> --<field> <value|@file> … [--remove <field>]… [--read <seq>] [--live]" },
  tool: NOT_A_TOOL,
  writes: true,
  inputs: {
    "<id>": { kind: "text", word: 0, optional: true, describe: "the record's id" },
    "<fields>": { kind: "fields", describe: "the fields to change" },
    remove: { kind: "text", many: true, optional: true, describe: "an optional field to remove" },
    read: { kind: "text", optional: true, describe: "the seq of the record's newest history entry when you read it: the edit is refused if it has changed since" },
    live: { kind: "switch", describe: "edit a story, capability or contract live while you hold an increment, keeping its claim" },
  },
  async act({ "<id>": given, "<fields>": values, remove = [], read: readGiven, live }, context: LibraryVerbContext) {
    const id = needed(given, "the record's id");
    const library = context.library;
    if (id === ANCHOR_ID) return editAnchor(fieldsOf(values), context);
    if (id === PR_CUTOVER_ID) return editCutover(fieldsOf(values), context);
    const record = await library.get(id);
    if (record === null) throw new VerbRefusal(`no record "${id}" in this project`);
    // A settled question keeps its words, answered as they were, but still gains the evidence it cites (12.17).
    if (record.type === "question" && record.fields.lifecycle === "settled" && (remove.length > 0 || Object.keys(values).some((field) => field !== "links"))) {
      throw new VerbRefusal(`question ${id} is settled, so its wording cannot change: its answer stands (it may only gain --links)`);
    }
    const both = remove.find((field) => Object.hasOwn(values, field));
    if (both !== undefined) throw new VerbRefusal(`--${both} and --remove ${both} are both given: change the field or remove it`, { misuse: true });
    // A planned record's held change is stored as JSON, which would drop a removal, so it is refused (ADR-0966 D1).
    if (remove.length > 0 && PLAN_TYPES.has(record.type)) throw new VerbRefusal(`a field of a ${record.type} is not removed with --remove: its edits can wait on an increment, which keeps no removal`);
    // The store removes a field given as undefined, and the kind's schema refuses removing one it requires.
    const fields: Fields = { ...fieldsOf(values), ...Object.fromEntries(remove.map((field) => [field, undefined])) };
    if (Object.keys(fields).length === 0) return { text: `No fields given: ${id} is unchanged.` };
    const writer = context.writer!;
    // A note, decision or question is written whole-field and live, so one built on a stale read is refused (friction_90ff039d8cce); a planned record's edit is held with the entry it read (ADR-0966 D1).
    if (!isPlanRecordType(record.type)) await refuseStaleEdit(library, id, writer, readGiven);
    // --live names a correction the increment does not change, made live with its claim kept (ADR-0966 D1's note).
    const done = await withIdLists(fields, async (fields): Promise<PlanEdit | null> => {
      if (isPlanRecordType(record.type)) return editPlanRecord(library, await context.claims(), context.session, { type: record.type, id, fields, live }, writer);
      const edited =
        record.type === "question"
          ? await library.editQuestion(id, fields as never, writer)
          : record.type === "decision"
            ? await editDecision(library, id, fields as never, writer)
            : await library.editNote(id, fields as never, writer);
      return edited === null ? null : { edited };
    });
    if (done === null) throw new VerbRefusal(`no live ${record.type} "${id}" in this project`);
    if ("held" in done) {
      // An increment that will have no branch (a library-only redo) never merges, so the way out is said (friction_f02365572601).
      const drop = `arc increment drop-pending ${done.held} ${id} --reason <why>`;
      return {
        text: `Your edit of ${record.type} ${id} (${Object.keys(fields).join(", ")}) is ${heldSaid(done.held)} If ${done.held} will have no branch, run ${drop}, then this edit again with --live.`,
        next: [
          { command: `library read ${done.held}`, why: "see its pending changes" },
          { command: drop, why: "drop it, when the increment will have no branch to merge" },
          { command: `library edit ${id} … --live`, why: "then make the edit live, keeping the increment's claim" },
        ],
      };
    }
    const changed = Object.keys(values).join(", ");
    const removed = remove.length === 0 ? "" : `${changed === "" ? "" : ", "}removed ${remove.join(", ")}`;
    const from = record.type === "contract" && Object.hasOwn(values, "edge") ? (record.fields as { capability?: string }).capability : undefined;
    const bare = await bareSaid(library, from, `library new contract --capability ${from} --title <title>`);
    return { text: `Edited ${record.type} ${id}: ${changed}${removed}.${bare}`, next: [{ command: `library read ${id}`, why: "read it back" }] };
  },
});

/**
 * The project's anchor, written a half at a time (ADR-1085 D1): it is made on its first write, so `library edit`
 * reaches it before it exists. Only its two halves are fields; anything else is refused with nothing written.
 */
async function editAnchor(fields: Fields, context: LibraryVerbContext): Promise<{ text: string; next: { command: string; why: string }[] }> {
  const wrong = Object.keys(fields).filter((field) => field !== "what" && field !== "audience");
  if (wrong.length > 0) throw new VerbRefusal(`the project's anchor has no ${wrong.join(" or ")}: it has what (what the project is) and audience (who it is for)`, { misuse: true });
  if (Object.keys(fields).length === 0) return { text: `No fields given: ${ANCHOR_ID} is unchanged.`, next: [] };
  await context.library.setAnchor(fields as never, context.writer!);
  return { text: `Edited the project's anchor ${ANCHOR_ID}: ${Object.keys(fields).join(", ")}.`, next: [{ command: `library read ${ANCHOR_ID}`, why: "read it back" }] };
}

/**
 * The project's repository cut-over (increment_7f7599b35fe4), made on its first write as the anchor is: `--at` the
 * time, `--repository` the owner/name that holds the name from then, and `--before` the one that held pull request
 * numbers until then (by default that repository renamed `<name>-history`), or "none" when it was deleted.
 */
async function editCutover(fields: Fields, context: LibraryVerbContext): Promise<{ text: string; next: { command: string; why: string }[] }> {
  const wrong = Object.keys(fields).filter((field) => field !== "at" && field !== "repository" && field !== "before");
  if (wrong.length > 0) throw new VerbRefusal(`the repository cut-over has no ${wrong.join(" or ")}: it has at (when), repository (the owner/name that holds the name from then) and before (the one that held pull requests until then, or none)`, { misuse: true });
  if (Object.keys(fields).length === 0) return { text: `No fields given: ${PR_CUTOVER_ID} is unchanged.`, next: [] };
  const given: Fields = { ...fields, ...(fields.before === "none" ? { before: null } : {}) };
  if ((await context.library.prCutover()) === undefined && (given.at === undefined || given.repository === undefined)) {
    throw new VerbRefusal(`the repository cut-over is made with --at <time> and --repository <owner/name>`, { misuse: true });
  }
  const cutover = (await context.library.setPrCutover(given as never, context.writer!)).fields;
  return {
    text: `Pull requests recorded before ${cutover.at} are ${cutover.before ?? "a deleted repository"}'s; later ones are ${cutover.repository}'s.`,
    next: [{ command: `library read ${PR_CUTOVER_ID}`, why: "read it back" }],
  };
}

const refile = verb({
  command: { family: "library", name: "refile", summary: "rewrite an artifact as another kind under the same id, its links and history kept (ADR-1058 D2)", usage: "library refile <id> <kind> --<field> <value|@file> …" },
  tool: NOT_A_TOOL,
  writes: true,
  inputs: {
    "<id>": { kind: "text", word: 0, optional: true, describe: "the artifact's id" },
    "<kind>": { kind: "text", word: 1, optional: true, describe: "the kind it becomes" },
    "<fields>": { kind: "fields", describe: "the new kind's whole set of fields" },
  },
  async act({ "<id>": given, "<kind>": kind, "<fields>": values }, context: LibraryVerbContext) {
    const id = needed(given, "the artifact's id");
    const to = needed(kind, "the kind it becomes");
    let refiled;
    try {
      refiled = await withIdLists(fieldsOf(values), (fields) => context.library.refile(id, to as KnowledgeKind, fields as never, context.writer!));
    } catch (error) {
      if (error instanceof RangeError) throw new VerbRefusal(error.message, { misuse: true });
      throw error;
    }
    if (refiled === null) throw new VerbRefusal(`no live artifact "${id}" in this project`);
    return { text: `Refiled ${id} as ${to}.`, next: [{ command: `library read ${id}`, why: "read it back" }] };
  },
});

const retire = verb({
  command: { family: "library", name: "retire", summary: "retire a record, keeping its reason and writer in history", usage: "library retire <id> --reason <why>" },
  tool: NOT_A_TOOL,
  writes: true,
  inputs: {
    id: { kind: "text", word: 0, optional: true, describe: "the record's id" },
    reason: { kind: "text", optional: true, describe: "why it is retired" },
  },
  async act({ id: given, reason: why }, context: LibraryVerbContext) {
    const id = needed(given, "the record's id");
    const reason = needed(why, "--reason");
    if (PLAN_TYPES.has((await context.library.get(id))?.type ?? "")) {
      const held = await heldOnIncrement(context, { record: id, retire: reason });
      if (held !== undefined) return { text: `Retiring ${id} is ${held}` };
    }
    await context.library.retire(id, reason, context.writer!);
    return { text: `Retired ${id}.` };
  },
});

/** An increment's statuses while it is open work. */
const OPEN: ReadonlySet<string> = new Set(["proposal", "active"]);

/** A `--where` value matches a field it equals, or a list field holding it: an array never answers a silent empty. */
function matches(stored: unknown, value: unknown): boolean {
  return isDeepStrictEqual(stored, value) || (Array.isArray(stored) && stored.some((one) => isDeepStrictEqual(one, value)));
}

/** The friction states that leave the default list (ADR-1016 D4). */
const SETTLED: ReadonlySet<string> = new Set(["resolved", "dismissed"]);

const list = verb({
  command: { family: "library", name: "list", summary: "every live record of a kind, optionally filtered by fields (a list field matches when its list holds the value, or equals a whole list given as JSON); settled friction (resolved or dismissed) only with --all or a --where on its state; --open keeps only open increments", usage: "library list <kind> [--where <field>=<value>]… [--all] [--open]" },
  tool: NOT_A_TOOL,
  inputs: {
    kind: { kind: "text", word: 0, optional: true, describe: "the kind of record" },
    where: { kind: "text", many: true, optional: true, describe: "<field>=<value> to filter by" },
    all: { kind: "switch", describe: "settled friction too" },
    open: { kind: "switch", describe: "only open increments (proposal or active)" },
  },
  async act({ kind: given, where, all, open }, context: LibraryVerbContext, door) {
    const kind = needed(given, "the kind of record");
    if (open && kind !== "increment") throw new VerbRefusal(`--open keeps only open increments, so it lists no ${kind}`, { misuse: true });
    // A plugin's kind no mounted plugin declares lists nothing; the answer names it instead (ADR-1178 D3).
    const dormant = await dormantSaid(context, door, [kind]);
    if (dormant.length > 0) return { text: dormant.join("\n") };
    const filters = where.map((one) => {
      const equals = one.indexOf("=");
      if (equals < 1) throw new VerbRefusal(`--where needs <field>=<value>, not ${JSON.stringify(one)}`, { misuse: true });
      return { field: one.slice(0, equals), value: fieldValue(one.slice(equals + 1)) };
    });
    const matching = (await context.library.list(kind as RecordType))
      .filter((record) => filters.every(({ field, value }) => matches((record.fields as Fields)[field], value)))
      .filter((record) => !open || OPEN.has(String((record.fields as Fields)["status"])));
    // Settled friction stays live but out of the default list (ADR-1016 D4).
    const hideSettled = kind === "friction" && !all && !filters.some(({ field }) => field === "state");
    const records = hideSettled ? matching.filter((record) => !SETTLED.has(String((record.fields as Fields)["state"]))) : matching;
    const left = matching.length - records.length;
    const leftOut = left === 0 ? [] : [`${left} settled (resolved or dismissed) left out; --all lists them.`];
    return {
      text: records.length === 0
        ? [`No ${kind} records match.`, ...leftOut].join("\n")
        : [`${records.length} ${kind} records:`, ...records.map((record) => `  ${record.id}  ${labelOf(record.fields)}`), ...leftOut].join("\n"),
      next: [{ command: "library read <id>", why: "read one whole" }],
    };
  },
});

const history = verb({
  command: { family: "library", name: "history", summary: "every write with its writer; --fields includes stored fields after each write (last state for retirement)", usage: "library history <id> [--fields]" },
  tool: NOT_A_TOOL,
  inputs: {
    id: { kind: "text", word: 0, optional: true, describe: "the record's id" },
    fields: { kind: "switch", describe: "the stored fields after each write" },
  },
  async act({ id: given, fields }, context: LibraryVerbContext) {
    const id = needed(given, "the record's id");
    const entries = await context.library.history({ id });
    if (entries.length === 0) return { text: `No history for ${id}.` };
    return { text: [`History of ${id}:`, ...entries.flatMap((entry) => [
      `  ${entry.seq}  ${entry.at}  ${entry.action}  ${entry.actor ?? "writer not recorded"}${entry.reason === undefined ? "" : `  ${entry.reason}`}`,
      // The mark a write carries when its session had read outside text before it (capability 2's 2.20): observed, never refused.
      ...(entry.outsideRead === undefined ? [] : [`    read outside text first: ${entry.outsideRead.join("; ")}`]),
      ...(fields ? [`    fields: ${JSON.stringify(entry.record.fields)}`] : []),
    ])].join("\n") };
  },
});

const revert = verb({
  command: { family: "library", name: "revert", summary: "write a record back, whole and under its id, to the state one of its history entries kept; a retired one comes back", usage: "library revert <id> --to <seq> --read <seq> [--reason <why>]" },
  tool: NOT_A_TOOL,
  writes: true,
  inputs: {
    id: { kind: "text", word: 0, optional: true, describe: "the record's id" },
    to: { kind: "text", optional: true, describe: "the seq of the history entry to go back to" },
    read: { kind: "text", optional: true, describe: "the seq of its newest history entry when you read it" },
    reason: { kind: "text", optional: true, describe: "why" },
  },
  async act({ id: given, to: toGiven, read: readGiven, reason }, context: LibraryVerbContext) {
    const id = needed(given, "the record's id");
    const [to, read] = ([["--to", toGiven], ["--read", readGiven]] as const).map(([name, value]) => {
      const seq = Number(needed(value, name));
      if (!(Number.isSafeInteger(seq) && seq > 0)) throw new VerbRefusal(`${name} is a history entry's seq, as library history ${id} shows it, not ${JSON.stringify(value)}`, { misuse: true });
      return seq;
    }) as [number, number];
    const type = (await context.library.history({ id, newest: 1 })).at(0)?.type;
    const increment = PLAN_TYPES.has(type ?? "") ? heldIncrement(await context.claims(), context.session) : undefined;
    if (increment !== undefined) {
      throw new VerbRefusal(`${id} is a planned ${type}, and a revert cannot wait on increment ${increment} as an edit does: edit its fields to hold the change there, or revert it from a session holding no increment on a branch`);
    }
    try {
      await context.library.revert(id, to, read, { ...context.writer!, ...(reason === undefined ? {} : { reason }) });
    } catch (error) {
      if (error instanceof RangeError || error instanceof StaleRevertError) throw new VerbRefusal(error.message);
      throw error;
    }
    return { text: `Reverted ${id} to history entry ${to}.`, next: [{ command: `library read ${id}`, why: "read it back" }, { command: `library history ${id}`, why: "see the revert in its history" }] };
  },
});

const undo = verb({
  command: { family: "library", name: "undo", summary: "write every record one writer wrote back to before their first write to it, retiring what they made; refused, writing nothing, where another writer wrote since", usage: "library undo <writer> [--reason <why>]" },
  tool: NOT_A_TOOL,
  writes: true,
  inputs: {
    actor: { kind: "text", word: 0, optional: true, describe: "the writer, as library changes --actor names them (session:<id> or person:<name>)" },
    reason: { kind: "text", optional: true, describe: "why" },
  },
  async act({ actor: given, reason }, context: LibraryVerbContext) {
    const actor = needed(given, "the writer");
    const increment = heldIncrement(await context.claims(), context.session);
    const planned = increment === undefined ? undefined : (await context.library.writtenBy(actor)).find(({ type }) => PLAN_TYPES.has(type));
    if (planned !== undefined) {
      throw new VerbRefusal(`${actor} wrote ${planned.id}, a planned ${planned.type}, and an undo cannot wait on increment ${increment} as an edit does: undo from a session holding no increment on a branch`);
    }
    let reverted;
    try {
      reverted = await context.library.revertWrites(actor, { ...context.writer!, ...(reason === undefined ? {} : { reason }) });
    } catch (error) {
      if (error instanceof LaterWriterError) throw new VerbRefusal(error.message);
      throw error;
    }
    if (reverted.length === 0) return { text: `${actor} wrote nothing to revert (health left out).` };
    const lines = reverted.map(({ id, action, to }) => `  ${id}  ${action === "retired" ? "retired" : `back to history entry ${to}`}`);
    return { text: [`Reverted ${reverted.length} record${reverted.length === 1 ? "" : "s"} ${actor} wrote:`, ...lines].join("\n"), next: [{ command: "library history <id>", why: "see the revert in a record's history" }] };
  },
});

export { NOTE_TOOLS, type Found, type NoteRead, type NoteToolContext, type Presenter } from "./notes.js";
// The plan-edit rule both front doors call (ADR-0966 D1, ADR-0793).
export { editPlanRecord, heldPending, heldSaid, holdPlanChange } from "../work/plan-hold.js";

/**
 * What a contract's move onto a link left its part, `capability`, as both front doors say it (question_db632f671942's
 * option D): a sentence naming the part when it now has no live contracts of its own, with the step its own work needs,
 * `plan` naming how this door plans a contract; nothing while it keeps one (ADR-1282 D2 moves them as work touches them).
 */
export async function bareSaid(library: Library, capability: string | undefined, plan: string): Promise<string> {
  const part = capability === undefined ? undefined : (await library.projectTree()).stories.flatMap((story) => story.capabilities).find((node) => node.id === capability);
  if (part === undefined || part.contracts.length > 0) return "";
  return ` "${part.title}" (${part.id}) now has no contracts of its own: plan its own behaviour contract (${plan}), or leave it bare knowingly.`;
}

/** The library's command family, which the package's manifest names under `verbs` (ADR-1033), first among `storytree`'s. */
export const LIBRARY_FAMILIES: readonly VerbFamily<LibraryVerbContext>[] = [{
  name: "library",
  summary: "read, search and write the project's records",
  order: 1,
  guesses: { show: "library read <id>", get: "library read <id>", open: "library read <id>", view: "library read <id>", pull: "library read <id>", artifact: "library read <id>" },
  verbs: [search, phrase, exact, links, related, create, read, edit, refile, retire, list, history, revert, undo, count, changes, find, moveToEdges],
}, ADR_FAMILY, FYI_FAMILY, MEDIA_FAMILY];
