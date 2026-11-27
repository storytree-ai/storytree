// Capability 17 · The library's commands
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { ANCHOR_ID, CONTRACT_DEFINITION, LONG_CONTRACT_TITLE, SchemaError, type KnowledgeKind, type Library, type PendingChange, type PhraseKind, type PlanChange, type RecordType, type Storytree, type WriteOptions } from "../index.js";
import { PR_CUTOVER_ID } from "../plan/index.js";
import { editPlanRecord, FYI_FAMILY, heldIncrement, heldPending, heldSaid, holdPlanChange, isPlanRecordType, PLAN_TYPES, refuseHeldPlanWrite, type PlanEdit } from "../work/index.js";
import { fieldValue, verb, VerbRefusal, type DoorWords, type VerbContext, type VerbFamily } from "../verbs/verb.js";
import { changes, count, decisionNamed, find } from "../data/commands.js";
import { MEDIA_FAMILY } from "./media.js";
export { mediaGuidance } from "./media.js";
import { ADR_FAMILY, ARTIFACT_KINDS, attachedTo, editDecision, everyHolding, holdingLines, justificationSaid, labelOf, librariesNamed, libraryNamed, narrowedSaid, partsBeside, PROJECT_INPUT, PROJECTS_INPUT, rankedSearch, recordDecision, recordLines, refuseStaleEdit, supersededLines, unopenedSaid, WRITTEN_KINDS, type HeldClaim } from "../knowledge/index.js";
import { LaterWriterError, StaleRevertError } from "../records/index.js";
import { RECORD_SCHEMAS } from "../schema/index.js";
export { contextIn, libraryNamed, librariesNamed, PROJECT_INPUT, PROJECTS_INPUT, unopenedSaid } from "../knowledge/index.js";

export interface LibraryVerbContext extends VerbContext<Library, Pick<Storytree, "ownDatabase">> {
  claims(): Promise<readonly HeldClaim[]>;
  testedNumbers(capability: string): Promise<{ readonly tested: readonly string[]; readonly untested: readonly string[] }>;
  pluginInFactory?(plugin: string): Promise<boolean>;
  levelsBehind?(story: string, parent: string): Promise<string[]>;
}

type Fields = Record<string, unknown>;

function fieldsOf(given: Readonly<Record<string, string>>): Fields {
  return Object.fromEntries(Object.entries(given).map(([name, text]) => [name, fieldValue(name === "title" || name === "term" ? text.replace(/\r?\n$/, "") : text)]));
}

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

function needed<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new VerbRefusal(`this needs ${what}`, { misuse: true });
  return value;
}

function placedOnly(kind: string, fields: Fields): Fields {
  const shape: Record<string, unknown> = RECORD_SCHEMAS[kind as RecordType]?.shape ?? {};
  return Object.fromEntries(Object.entries(fields).filter(([name]) => !(name === "arc" || name === "increment") || name in shape));
}

function countOf(limit: string | undefined): number | undefined {
  if (limit !== undefined && !/^[1-9]\d*$/.test(limit)) throw new VerbRefusal(`--limit is how many to show, a whole number above 0; got "${limit}"`, { misuse: true });
  return limit === undefined ? undefined : Number(limit);
}

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
    WRITTEN_KINDS.map((kind) => [
      kind,
      ((library, fields, options) => library.writeKnowledge(kind, fields as never, options)) satisfies Writer,
    ]),
  ),
};

const ELSEWHERE: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(ARTIFACT_KINDS).flatMap(([kind, { captured }]) => (captured === undefined ? [] : [[kind, captured.command]])),
);

async function dormantSaid(context: LibraryVerbContext, words: DoorWords, kinds?: readonly string[]): Promise<string[]> {
  const dormant = (await context.library.dormantKinds()).filter(({ kind }) => kinds === undefined || kinds.includes(kind));
  return Promise.all(dormant.map(async ({ kind, count }) => {
    const plugin = kind.slice(0, kind.indexOf("."));
    const mount = words.say({ command: `settings set module ${plugin} plugin ${plugin}` });
    const how = await context.pluginInFactory?.(plugin) === false ? `${plugin} is not in this computer's factory, so it cannot be mounted here` : `mount it with ${mount}`;
    return `${count} ${kind} ${count === 1 ? "record is" : "records are"} dormant here: ${count === 1 ? "its" : "their"} plugin, ${plugin}, is not mounted on this computer; ${how}.`;
  }));
}

const NOT_A_TOOL = { absent: "an agent's artifact tools are search_notes, find_text, open, write_note and correct_note, which record its reads" } as const;

const search = verb({
  command: {
    family: "library",
    name: "search",
    summary: "the artifacts, stories, capabilities, contracts, arcs and increments closest in meaning to the words, best first, closed arcs and increments after the open ones (10 unless --limit); current state only: resteers, friction and superseded decisions come back with --history, or a resteer or friction with --kind; --project searches its factory's library or a project it builds (all for every one), each under its project",
    usage: "library search <words…> [--limit <n>] [--history] [--kind <kind>] [--project <project|all>]",
  },
  tool: NOT_A_TOOL,
  inputs: {
    words: { kind: "text", word: 0, many: true, optional: true, blank: true, describe: "the words to search for" },
    limit: { kind: "text", optional: true, describe: "how many to show" },
    history: { kind: "switch", describe: "rank resteers, friction and superseded decisions too" },
    kind: { kind: "text", many: true, optional: true, describe: "only this kind" },
    project: PROJECTS_INPUT,
  },
  async act({ words, limit, history, kind, project }, context: LibraryVerbContext, door) {
    const query = words.join(" ").trim();
    if (query === "") throw new VerbRefusal("this needs the words to search for", { misuse: true });
    const count = countOf(limit);
    const named = project === undefined || project.length === 0 ? undefined : project;
    const sections: string[] = [];
    for (const reached of await librariesNamed(context.library, named)) {
      if (reached.opened === undefined) {
        sections.push(unopenedSaid(reached.project, reached.unopened));
        continue;
      }
      const ranked = await rankedSearch(reached.opened, query, { ...(count === undefined ? {} : { limit: count }), history, kinds: kind });
      const heading = ranked.by === "meaning" ? `closest in meaning to "${query}":` : `ranked by words: ${ranked.why}; the records holding every word of "${query}":`;
      const dormant = await dormantSaid({ ...context, library: reached.opened }, door);
      const kindOf = (note: (typeof ranked.hits)[number]["note"]): string => note.type === "friction" ? `friction: ${note.fields.state}` : note.type;
      const lines = ranked.hits.length === 0 ? ["  none"] : ranked.hits.map(({ note, score, narrowedBy }) => `  ${score === undefined ? "" : `${score.toFixed(2)}  `}${note.id}  [${kindOf(note)}]  ${labelOf(note.fields)}${narrowedSaid(narrowedBy)}`);
      sections.push([...(named === undefined ? [] : [`project ${reached.project}:`]), heading, ...lines, ...dormant].join("\n"));
    }
    return { text: sections.join("\n\n"), next: [{ command: `library read <id>${named === undefined ? "" : " --project <project>"}`, why: "read one whole" }] };
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
    const linking = await context.library.linkingIn(id);
    if (linking.length === 0) return { text: `No artifact links to ${id}.` };
    return { text: [`${linking.length} artifact${linking.length === 1 ? "" : "s"} link${linking.length === 1 ? "s" : ""} to ${id}:`, ...linkingLines(linking, id)].join("\n") };
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
    const fields = placedOnly(kind, fieldsOf(values));
    if (kind === "decision" && fields.status === "accepted" && fields.authority === undefined) {
      throw new VerbRefusal("an accepted decision carries its authority, whose call it was: record it with `storytree adr new … --basis <owner-directed|owner-ratified|agent-derived|agent-flipped> [--owner-said …]`, or give --authority @file holding its JSON", { misuse: true });
    }
    const target = kind !== "contract" ? undefined : typeof fields.capability === "string" ? fields.capability : typeof fields.edge === "string" ? fields.edge : undefined;
    const refused = target === undefined ? undefined : await refuseHeldPlanWrite(context.library, await context.claims(), context.session, target);
    if (refused !== undefined) throw new VerbRefusal(refused);
    const numbers = kind === "contract" && typeof fields.capability === "string" ? await context.testedNumbers(fields.capability) : undefined;
    const pending = kind === "capability" || kind === "edge" ? { pending: await heldPending(context.library, await context.claims(), context.session) } : {};
    const options = numbers === undefined ? { ...context.writer!, ...pending } : { ...context.writer!, testedNumbers: [...numbers.tested] };
    const written = await withIdLists(fields, (fields) => write(context.library, fields, options));
    const untested = numbers?.untested ?? [];
    const one = untested.length === 1;
    const open = untested.length === 0 ? "" : `\n${untested.length} other ${one ? "contract" : "contracts"} of this capability ${one ? "has" : "have"} no test yet. If this one repeats ${one ? "it" : "any of them"}, retire it and build that one (list ${one ? "it" : "them"} with \`storytree map --select cap:${String(fields.capability)} --down 1 --kind contract --show\`).`;
    const long = kind === "contract" && String(fields.title ?? "").length > LONG_CONTRACT_TITLE;
    const advice = long ? `\nIts title runs past ${LONG_CONTRACT_TITLE} characters, which often means more than one contract: ${CONTRACT_DEFINITION} Split it with \`storytree library edit\` and \`storytree library new contract\` if so.` : "";
    const beside = kind === "decision" && typeof fields.frontCoverOf === "string" ? await partsBeside(context.library, fields.frontCoverOf, "`storytree library edit`") : undefined;
    return { text: `Wrote ${kind} ${written.id}.${open}${advice}${beside === undefined ? "" : `\n${beside}`}`, next: [{ command: `library read ${written.id}`, why: "read it back" }] };
  },
});

type Stored = NonNullable<Awaited<ReturnType<Library["get"]>>>;

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

async function decisionLinks(library: Library, record: Stored): Promise<string[]> {
  if (record.type !== "decision") return [];
  const fields = record.fields as Fields;
  const edges = (["links", "supersedes", "supersedesClauses", "narrows"] as const).flatMap((field) =>
    (Array.isArray(fields[field]) ? (fields[field] as unknown[]) : []).map((entry) => ({ field, to: field === "supersedesClauses" ? String((entry as { decision: unknown }).decision) : String(entry) })));
  const kinds = await Promise.all(edges.map(async ({ to }) => (await library.get(to))?.type));
  const lines = edges.filter((_, index) => kinds[index] === "decision").map(({ field, to }) => `  ${field} ${to}  ${justificationSaid(fields, to, "") || "(old shape: no justification)"}`);
  return lines.length === 0 ? [] : ["decision links:", ...lines];
}

function linkingLines(linking: readonly Stored[], id: string): string[] {
  return linking.map((record) => `  ${record.id}  [${record.type}]  ${labelOf(record.fields)}${justificationSaid(record.fields, id, "  ")}`);
}

async function linkedFromLines(library: Library, record: Stored): Promise<string[]> {
  const linking = await library.linkingIn(record.id);
  return [...(await supersededLines(library, record)), ...(linking.length === 0 ? [] : ["Linked from:", ...linkingLines(linking, record.id)])];
}

const RECORD_ID = /^[a-z]+_[0-9a-f]{12}$/;

function idsNamedBy(record: Stored): string[] {
  return Object.values(record.fields).flatMap((value) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && RECORD_ID.test(item)) : []));
}

export function wholeRecord(record: Stored): string {
  const { pending } = record.fields as Fields & { pending?: PendingChange[] };
  const held = record.type === "increment" && pending !== undefined && pending.length > 0 ? pendingSaid(pending) : [];
  return [recordLines(record), ...held].join("\n");
}

const read = verb({
  command: { family: "library", name: "read", summary: "records, whole, in one start (--linked adds the records their id lists name); or one record's field exactly as stored; --project reads its factory's library or a project it builds", usage: "library read <id|decision number> [<id>…] [--linked] [--field <name> [--out <file>]] [--project <project>]" },
  tool: NOT_A_TOOL,
  inputs: {
    ids: { kind: "text", word: 0, many: true, optional: true, describe: "the records' ids" },
    project: PROJECT_INPUT,
    linked: { kind: "switch", describe: "add the records their id lists name" },
    field: { kind: "text", optional: true, describe: "one field to read exactly as stored" },
    out: { kind: "text", optional: true, describe: "a file to write the field to instead of printing it (relative to the caller's folder), so pnpm's script banner cannot reach it" },
  },
  async act({ ids: given, linked: withLinked, field, out, project }, context: LibraryVerbContext) {
    needed(given[0], "the record's id");
    if (out !== undefined && field === undefined) throw new VerbRefusal("--out writes one field; give --field <name> with it", { misuse: true });
    const library = await libraryNamed(context.library, project);
    const where = library === context.library ? "this project" : `project ${library.name}`;
    const ids = [...new Set(await Promise.all(given.map(async (id) => (await decisionNamed(library, id)) ?? id)))];
    const records = await Promise.all(ids.map((id) => library.get(id)));
    const missing = ids.filter((_, index) => records[index] === null);
    if (missing.length > 0) throw new VerbRefusal(missing.map((id) => `no record "${id}" in ${where}`).join("\n"));
    const named = await Promise.all((records as Stored[]).map((record) => withDependsOn(library, record)));
    const parts = await Promise.all(named.map(async (record) => [...(record.type === "story" || record.type === "capability" ? (await attachedTo(library, record.id, record.type === "story")).lines : await decisionLinks(library, record)), ...(await linkedFromLines(library, record))]));
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
    const shown = [...named.map((record, index) => [wholeRecord(record), ...parts[index]!].join("\n")), ...linked.filter((record): record is Stored => record !== null).map(wholeRecord)];
    const note = gone.length > 0 ? [`Linked but not in ${where}: ${gone.join(", ")}`] : [];
    return { text: [...(library === context.library ? [] : [`project ${library.name}:`]), ...shown, ...note].join("\n\n") };
  },
});

async function heldOnIncrement(context: LibraryVerbContext, change: PlanChange): Promise<string | undefined> {
  const increment = await holdPlanChange(context.library, await context.claims(), context.session, change, context.writer!);
  return increment === undefined ? undefined : heldSaid(increment);
}

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
  async act({ "<id>": given, "<fields>": named, remove = [], read: readGiven, live }, context: LibraryVerbContext) {
    const id = needed(given, "the record's id");
    const library = context.library;
    if (id === ANCHOR_ID) return editAnchor(fieldsOf(named), context);
    if (id === PR_CUTOVER_ID) return editCutover(fieldsOf(named), context);
    const record = await library.get(id);
    if (record === null) throw new VerbRefusal(`no record "${id}" in this project`);
    const values = PLAN_TYPES.has(record.type) ? Object.fromEntries(Object.entries(named).filter(([field]) => field !== "increment")) : named;
    if (record.type === "question" && record.fields.lifecycle === "settled" && (remove.length > 0 || Object.keys(values).some((field) => field !== "links" && field !== "unbuilt"))) {
      throw new VerbRefusal(`question ${id} is settled, so its wording cannot change: its answer stands (it may only gain --links, and record --unbuilt)`);
    }
    const both = remove.find((field) => Object.hasOwn(values, field));
    if (both !== undefined) throw new VerbRefusal(`--${both} and --remove ${both} are both given: change the field or remove it`, { misuse: true });
    if (remove.length > 0 && PLAN_TYPES.has(record.type)) throw new VerbRefusal(`a field of a ${record.type} is not removed with --remove: its edits can wait on an increment, which keeps no removal`);
    const fields: Fields = { ...fieldsOf(values), ...Object.fromEntries(remove.map((field) => [field, undefined])) };
    if (Object.keys(fields).length === 0) return { text: `No fields given: ${id} is unchanged.` };
    const writer = context.writer!;
    if (!isPlanRecordType(record.type)) await refuseStaleEdit(library, id, writer, readGiven);
    const nesting = record.type === "capability" && typeof fields.parent === "string";
    if (nesting && fields.parent === "none") fields.parent = undefined;
    const story = typeof fields.story === "string" ? fields.story : String((record.fields as { story?: string }).story);
    const levels = nesting && fields.parent !== undefined ? { levels: (await context.levelsBehind?.(story, fields.parent as string)) ?? [] } : {};
    const done = await withIdLists(fields, async (fields): Promise<PlanEdit | null> => {
      if (isPlanRecordType(record.type)) return editPlanRecord(library, await context.claims(), context.session, { type: record.type, id, fields, live: live || nesting }, { ...writer, ...levels });
      const edited =
        record.type === "question"
          ? await library.editQuestion(id, fields as never, writer)
          : record.type === "decision"
            ? await editDecision(library, id, fields as never, writer)
            : await library.editNote(id, fields as never, writer);
      return edited === null ? null : { edited };
    });
    if (done === null) throw new VerbRefusal(`no live ${record.type} "${id}" in this project`);
    if ("refused" in done) throw new VerbRefusal(done.refused);
    if ("held" in done) {
      const drop = `arc increment drop-pending ${done.held} ${id} --reason <why>`;
      return {
        text: `Your edit of ${record.type} ${id} (${Object.keys(fields).join(", ")}) is ${heldSaid(done.held)} If ${done.held} will have no branch, run ${drop}, then this edit again with --live.`,
        next: [{ command: `library read ${done.held}`, why: "see its pending changes" }],
      };
    }
    const changed = Object.keys(values).join(", ");
    const removed = remove.length === 0 ? "" : `${changed === "" ? "" : ", "}removed ${remove.join(", ")}`;
    const from = record.type === "contract" && Object.hasOwn(values, "edge") ? (record.fields as { capability?: string }).capability : undefined;
    const bare = await bareSaid(library, from, `library new contract --capability ${from} --title <title>`);
    const nested = !nesting ? "" : fields.parent === undefined ? " Its parent was cleared on the live plan at once: it is a top capability again." : " Its parent went to the live plan at once, since the levels behind it were read from the code as it stands now.";
    return { text: `Edited ${record.type} ${id}: ${changed}${removed}.${bare}${nested}`, next: [{ command: `library read ${id}`, why: "read it back" }] };
  },
});

async function editAnchor(fields: Fields, context: LibraryVerbContext): Promise<{ text: string; next: { command: string; why: string }[] }> {
  const wrong = Object.keys(fields).filter((field) => field !== "what" && field !== "audience");
  if (wrong.length > 0) throw new VerbRefusal(`the project's anchor has no ${wrong.join(" or ")}: it has what (what the project is) and audience (who it is for)`, { misuse: true });
  if (Object.keys(fields).length === 0) return { text: `No fields given: ${ANCHOR_ID} is unchanged.`, next: [] };
  await context.library.setAnchor(fields as never, context.writer!);
  return { text: `Edited the project's anchor ${ANCHOR_ID}: ${Object.keys(fields).join(", ")}.`, next: [{ command: `library read ${ANCHOR_ID}`, why: "read it back" }] };
}

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
    const type = (await context.library.get(id))?.type ?? "";
    const refused = type === "contract" ? await refuseHeldPlanWrite(context.library, await context.claims(), context.session, id) : undefined;
    if (refused !== undefined) throw new VerbRefusal(refused);
    if (PLAN_TYPES.has(type)) {
      const held = await heldOnIncrement(context, { record: id, retire: reason });
      if (held !== undefined) return { text: `Retiring ${id} is ${held}` };
    }
    await context.library.retire(id, reason, context.writer!);
    return { text: `Retired ${id}.` };
  },
});

const OPEN: ReadonlySet<string> = new Set(["proposal", "active"]);

function matches(stored: unknown, value: unknown): boolean {
  return isDeepStrictEqual(stored, value) || (Array.isArray(stored) && stored.some((one) => isDeepStrictEqual(one, value)));
}

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

export { everyHolding, holdingLines, NOTE_TOOLS, type Found, type HeldClaim, type NoteRead, type NoteToolContext, type PhraseHit, type Presenter } from "../knowledge/index.js";
export { justificationSaid, supersededLines } from "../knowledge/index.js";
export { editPlanRecord, heldPending, heldSaid, holdPlanChange, refuseHeldPlanWrite } from "../work/index.js";

export async function bareSaid(library: Library, capability: string | undefined, plan: string): Promise<string> {
  const part = capability === undefined ? undefined : (await library.projectTree()).stories.flatMap((story) => story.capabilities).find((node) => node.id === capability);
  if (part === undefined || part.contracts.length > 0) return "";
  return ` "${part.title}" (${part.id}) now has no contracts of its own: plan its own behaviour contract (${plan}), or leave it bare knowingly.`;
}

export const LIBRARY_FAMILIES: readonly VerbFamily<LibraryVerbContext>[] = [{
  name: "library",
  summary: "read, search and write the project's records",
  order: 1,
  guesses: { show: "library read <id>", get: "library read <id>", open: "library read <id>", view: "library read <id>", pull: "library read <id>", artifact: "library read <id>" },
  verbs: [search, phrase, exact, links, related, create, read, edit, refile, retire, list, history, revert, undo, count, changes, find, moveToEdges],
}, ADR_FAMILY, FYI_FAMILY, MEDIA_FAMILY];
