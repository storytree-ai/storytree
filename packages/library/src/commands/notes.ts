/**
 * Capability 17 · The library's commands (ADR-1035 D3): the artifact tools the library declares for the MCP server, on the
 * library's knowledge entrances (ADR-0627): search artifacts, open a story or capability (its shelf of front covers, as
 * spines) or an artifact (whole, with the titles of what it links to and what links to it), write an artifact, and
 * correct one's wording. They are tools only: a person does this work with `storytree library search`, `read`, `new`
 * and `edit`, which record no reads.
 *
 * - Every artifact a tool shows is a read, which the door records in the agent activity log (ADR-0624 D1, ADR-0627
 *   D7): a spine or title shown is a peek, an opened artifact is read whole. How it was found is how the session last
 *   saw it: in a search, on a shelf, or as a link from another artifact; an artifact opened without having been shown
 *   was found by its id. The record says what was reached, never what helped (ADR-0624 D3).
 * - A contract opens whole too: its promise and the capability it belongs to. So does a question: its arc and state,
 *   its wording and answer, and the open increments held on it. An arc is refused.
 * - An artifact is corrected in place through editNote (ADR-0641 D2 step 3): only the fields given change, and its
 *   old wording stays in its history.
 * - A new artifact with no place named goes onto the shelf of the capability the session claimed most recently
 *   (ADR-0627 D4): a decision becomes one of its front covers; a definition or other artifact kind links to the cover
 *   the session last opened on that shelf, else to the shelf's first book; with an empty shelf nothing is added, and
 *   the agent is told. A session holding no claim gets no default, and a place the agent names always wins.
 */
import type { KnowledgeKind, Library, NewLine, Note, NoteEdit, SchemaRecord, WriteOptions } from "../index.js";
import { verb, VerbRefusal, type VerbAnswer, type VerbContext, type Verb, type VerbInputs } from "../verbs/verb.js";
import type { HeldClaim } from "./index.js";

/** How a session came to an artifact it read. */
export type Found = Extract<NewLine, { kind: "note-read" }>["found"];

/** One artifact read: what was reached, how it was found, and whether it was peeked at or read whole. */
export interface NoteRead {
  readonly note: string;
  readonly found: Found;
  readonly read: "peek" | "whole";
}

/** A live session putting a question to the owner. */
export interface Presenter {
  readonly session: string;
  readonly label: string;
  readonly since: string;
}

/**
 * The caller, with what the artifact tools need from above the library, which the door hands them: the project's
 * claims (with the capability each is on), the calling session's artifact reads and a way to record more, and the
 * live session putting a question to the owner.
 */
export interface NoteToolContext extends VerbContext {
  claims(): Promise<readonly HeldClaim[]>;
  /** The calling session's artifact reads, oldest first. */
  notesRead(): Promise<readonly NoteRead[]>;
  recordReads(reads: readonly NoteRead[]): Promise<void>;
  presenterOf(question: SchemaRecord<"question">): Promise<Presenter | undefined>;
}

/** What a search finds: an artifact, or a story, capability or contract of the plan, found by its own words. */
type Findable = Note | SchemaRecord<"story" | "capability" | "contract">;
type CapabilityNode = Awaited<ReturnType<Library["projectTree"]>>["stories"][number]["capabilities"][number];
type ContractNode = CapabilityNode["contracts"][number];

const NO_COMMAND = (instead: string) => ({ absent: `a person does this with \`storytree library ${instead}\`, which records no reads` });

const searchNotes = verb({
  command: NO_COMMAND("search"),
  tool: {
    name: "search_notes",
    description: "Search the project's artifacts (decisions, definitions and other artifact kinds) and its stories, capabilities and contracts: the ones closest in meaning to your question, best first; you see each one's spine. Ask in plain words. Open one to read it whole.",
  },
  inputs: {
    query: { kind: "text", verbatim: true, blank: true, describe: "What you want to know, in plain words" },
    limit: { kind: "count", optional: true, describe: "How many to give back; 10 unless given" },
  },
  async act({ query, limit }, context: NoteToolContext) {
    const ranked = await context.library.rankAll(query, limit === undefined ? {} : { limit });
    const notes = ranked.hits.map(({ note }) => note);
    await context.recordReads(notes.map((note) => ({ note: note.id, found: "search", read: "peek" })));
    const heading = ranked.by === "meaning"
      ? `closest in meaning to ${quoted(query)}:`
      : `ranked by words: ${ranked.why}; the records holding every word of ${quoted(query)}:`;
    if (notes.length === 0) return { text: `${heading}\n(none)`, data: { by: ranked.by, notes: [] } };
    return {
      text: [heading, ...notes.map(spineLine)].join("\n"),
      data: { by: ranked.by, notes: notes.map(spineData) },
    };
  },
});

const open = verb({
  command: NO_COMMAND("read"),
  tool: {
    name: "open",
    description: "Open a story or a capability to see its shelf of front-cover decisions as spines, founding book first; open a contract to read its promise and the capability it belongs to; open a question to read it whole with the work held on it; or open an artifact to read it whole, with the titles of what it links to and what links to it. Start at the shelf, open what matches your task, and stop when you can act.",
  },
  inputs: { id: { kind: "text", describe: "The id of a story, a capability, a contract, a question or an artifact" } },
  async act({ id }, context: NoteToolContext) {
    return openRecord(id, context);
  },
});

const writeNote = verb({
  command: NO_COMMAND("new"),
  tool: {
    name: "write_note",
    description: "Write an artifact: a decision (title and text), definition (term and meaning), or principle, guardrail, pattern, process, agent, techstack, check or research (required fields in fields). Use record_friction and record_resteer for their evidence rules. With no place named, it goes onto the shelf of the capability you claimed most recently.",
  },
  writes: true,
  inputs: {
    kind: { kind: "text", describe: "decision, definition, principle, guardrail, pattern, process, agent, techstack, check or research; friction and resteer have capture tools" },
    fields: { kind: "fields", json: true, describe: "Required fields of a principle, guardrail, pattern, process, agent, techstack, check or research" },
    text: { kind: "text", optional: true, verbatim: true, blank: true, describe: "A decision's text" },
    title: { kind: "text", optional: true, verbatim: true, blank: true, describe: "A decision's title" },
    term: { kind: "text", optional: true, verbatim: true, blank: true, describe: "A definition's term" },
    meaning: { kind: "text", optional: true, verbatim: true, blank: true, describe: "A definition's meaning" },
    links: { kind: "text", many: true, optional: true, describe: "The ids of artifacts this one links to" },
    front_cover_of: { kind: "text", optional: true, describe: "A decision only: the story or capability it is a front cover of" },
  },
  async act(input, context: NoteToolContext) {
    return writeArtifact(input, context);
  },
});

const correctNote = verb({
  command: NO_COMMAND("edit"),
  tool: {
    name: "correct_note",
    description: "Correct an artifact's wording in place: change only the fields you give (a decision's text, a decision's title, a definition's term or meaning). It keeps its id, and its old wording stays in its history.",
  },
  writes: true,
  inputs: {
    id: { kind: "text", describe: "The id of the artifact to correct" },
    text: { kind: "text", optional: true, verbatim: true, blank: true, describe: "A decision's text" },
    title: { kind: "text", optional: true, verbatim: true, blank: true, describe: "A decision's title" },
    term: { kind: "text", optional: true, verbatim: true, blank: true, describe: "A definition's term" },
    meaning: { kind: "text", optional: true, verbatim: true, blank: true, describe: "A definition's meaning" },
  },
  async act({ id, ...wording }, { library, writer }: NoteToolContext) {
    const fields = Object.fromEntries(Object.entries(wording).filter(([, value]) => value !== undefined));
    if (Object.keys(fields).length === 0) throw new VerbRefusal("Give the words to change: text, title, term or meaning.");
    const note = await library.editNote(id, fields as NoteEdit, writer!);
    if (note === null) throw new VerbRefusal(`There is no artifact ${id} in this project.`);
    return { text: `Corrected ${quoted(spineOf(note))} (${id}).`, data: { id } };
  },
});

/** The artifact tools the library declares for the MCP server, in the order it serves them. */
export const NOTE_TOOLS: readonly Verb<VerbInputs, NoteToolContext>[] = [searchNotes, open, writeNote, correctNote];

async function openRecord(id: string, context: NoteToolContext): Promise<VerbAnswer> {
  const { library } = context;
  const tree = await library.projectTree();
  for (const story of tree.stories) {
    if (story.id === id) return openShelf("Story", story.title, id, context);
    for (const capability of story.capabilities) {
      if (capability.id === id) return openShelf("Capability", capability.title, id, context);
      const contract = capability.contracts.find((node) => node.id === id);
      if (contract !== undefined) return openContract(contract, capability);
    }
  }
  const record = await library.get(id);
  if (record?.type === "question") return openQuestion(record as SchemaRecord<"question">, context);
  const notes = await library.search("");
  const note = notes.find((candidate) => candidate.id === id);
  if (note === undefined) {
    const arc = tree.arcs.some((node) => node.id === id);
    throw new VerbRefusal(arc ? `${id} is an arc: open a story, a capability, a contract, a question or an artifact.` : `Nothing in this project has the id ${id}.`);
  }
  const found = await howFound(context, id);
  const linksTo = (note.fields.links ?? []).flatMap((target) => notes.filter((candidate) => candidate.id === target));
  const linkedFrom = await library.relatedNotes(id);
  await context.recordReads([
    { note: id, found, read: "whole" },
    ...[...linksTo, ...linkedFrom].map((shown) => ({ note: shown.id, found: "link" as const, read: "peek" as const })),
  ]);
  const out = [wholeOf(note)];
  if (linksTo.length > 0) out.push("It links to:", ...linksTo.map(spineLine));
  if (linkedFrom.length > 0) out.push("Linked from:", ...linkedFrom.map(spineLine));
  return { text: out.join("\n"), data: { note: { id, kind: note.type, ...note.fields }, linksTo: linksTo.map(spineData), linkedFrom: linkedFrom.map(spineData) } };
}

/** The words of a question shown whole, in the order the owner reads them. */
const QUESTION_WORDS = ["stakes", "statement", "context", "options", "analogy", "diagram", "recommendation", "answer"] as const;

/** A question whole: its arc and state, every field of its wording and answer, and the open increments held on it. */
async function openQuestion(question: SchemaRecord<"question">, { library, presenterOf }: NoteToolContext): Promise<VerbAnswer> {
  const fields = question.fields as Readonly<Record<string, unknown>>;
  // A question another live session is putting to the owner says so, so he is not asked twice (Session management 5.36).
  const presenter = await presenterOf(question);
  const settled = typeof fields.settledAt === "string" ? `, settled ${fields.settledAt}${typeof fields.settledBy === "string" ? ` by ${fields.settledBy}` : ""}` : "";
  const holding = Object.entries((await library.holds()).heldOn).flatMap(([increment, on]) => (on.includes(question.id) ? [increment] : []));
  const out = [`Question ${quoted(String(fields.title))} (${question.id}):`, `On ${String(fields.arc)}, ${String(fields.lifecycle)}${settled}.`];
  for (const name of QUESTION_WORDS) {
    if (typeof fields[name] === "string") out.push(`${name[0]?.toUpperCase()}${name.slice(1)}: ${fields[name]}`);
  }
  if (holding.length > 0) out.push(`Holding: ${holding.join(", ")}`);
  if (presenter !== undefined) out.push(`Being put to the owner by ${presenter.label} session ${presenter.session} since ${presenter.since}: do not ask him again.`);
  return { text: out.join("\n"), data: { question: { id: question.id, ...fields, holding, ...(presenter === undefined ? {} : { presenter }) } } };
}

/** A contract whole: its title, its description, and the capability it belongs to. */
function openContract(contract: ContractNode, capability: CapabilityNode): VerbAnswer {
  const out = [`Contract ${quoted(contract.title)} (${contract.id}):`];
  if (contract.description !== undefined) out.push(contract.description);
  out.push(`It belongs to Capability ${quoted(capability.title)} (${capability.id}).`);
  return {
    text: out.join("\n"),
    data: { contract: { id: contract.id, title: contract.title, ...(contract.description === undefined ? {} : { description: contract.description }), capability: { id: capability.id, title: capability.title } } },
  };
}

async function openShelf(kind: "Story" | "Capability", title: string, id: string, context: NoteToolContext): Promise<VerbAnswer> {
  const shelf = await context.library.frontCovers(id);
  await context.recordReads(shelf.map((cover) => ({ note: cover.id, found: "shelf", read: "peek" })));
  if (shelf.length === 0) {
    return { text: `${kind} ${quoted(title)} (${id}) has no front covers yet. Record its founding decision with write_note.`, data: { shelf: [] } };
  }
  return {
    text: [`${kind} ${quoted(title)} (${id}). Its shelf, founding book first:`, ...shelf.map(spineLine)].join("\n"),
    data: { shelf: shelf.map(spineData) },
  };
}

interface NoteArgs {
  readonly kind: string;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly text?: string | undefined;
  readonly title?: string | undefined;
  readonly term?: string | undefined;
  readonly meaning?: string | undefined;
  readonly links: readonly string[];
  readonly front_cover_of?: string | undefined;
}

/** What each kind of artifact is written with. */
const FIELDS = { decision: ["title", "text"], definition: ["term", "meaning"] } as const;

async function writeArtifact(args: NoteArgs, context: NoteToolContext): Promise<VerbAnswer> {
  // A tool call that leaves out fields or links reads as none of either: the door hands an empty object and list.
  const fields = Object.keys(args.fields).length === 0 ? undefined : args.fields;
  const links = args.links.length === 0 ? undefined : [...args.links];
  if (args.kind === "memory") throw new VerbRefusal("memory belongs to the agent harness, not the library (ADR-0650); write a proper artifact kind such as decision, definition or principle.");
  if (args.kind === "friction" || args.kind === "resteer") throw new VerbRefusal(`Use record_${args.kind} to write this artifact under its evidence rules.`);
  const further = ["principle", "guardrail", "pattern", "process", "agent", "techstack", "check", "research"].includes(args.kind);
  if (!further && args.kind !== "decision" && args.kind !== "definition") throw new VerbRefusal(`Unknown artifact kind ${quoted(args.kind)}; use decision, definition, principle, guardrail, pattern, process, agent, techstack, check or research.`);
  const needs: readonly string[] = further ? [] : FIELDS[args.kind as keyof typeof FIELDS];
  if (further && fields === undefined) throw new VerbRefusal(`Give the required fields for a ${args.kind} in fields.`);
  if (!further && fields !== undefined) throw new VerbRefusal(`A ${args.kind} takes ${needs.join(" and ")} directly.`);
  if (fields && ["links", "frontCoverOf"].some((key) => key in fields)) throw new VerbRefusal("Give links or front_cover_of directly to name the artifact's place.");
  const given = (["text", "title", "term", "meaning"] as const).filter((field) => args[field] !== undefined);
  const missing = needs.filter((field) => args[field as keyof NoteArgs] === undefined);
  const extra = given.filter((field) => !needs.includes(field));
  if (missing.length > 0 || extra.length > 0) throw new VerbRefusal(`A ${args.kind} is written with ${needs.join(" and ")}${extra.length > 0 ? `, not ${extra.join(" or ")}` : ""}.`);
  if (args.front_cover_of !== undefined && args.kind !== "decision") throw new VerbRefusal("Only a decision can be a front cover.");

  let place: { links?: string[]; frontCoverOf?: string } = {
    ...(links === undefined ? {} : { links }),
    ...(args.front_cover_of === undefined ? {} : { frontCoverOf: args.front_cover_of }),
  };
  let placed = "where you named";
  let emptyShelf: string | undefined;
  if (links === undefined && args.front_cover_of === undefined) {
    const held = await latestClaim(context);
    if (held === undefined) placed = "with no place: you hold no claim, so name its links (or, for a decision, the node it is a front cover of) to file it";
    else if (args.kind === "decision") {
      place = { frontCoverOf: held };
      placed = `as a front cover of ${held}, the capability you hold`;
    } else {
      const shelf = await context.library.frontCovers(held);
      const cover = (await lastOpened(context, shelf)) ?? shelf[0];
      if (cover === undefined) {
        emptyShelf = held;
        placed = `with no place: the shelf of ${held}, the capability you hold, is empty. Record its founding decision with write_note (kind decision), then link artifacts inside it`;
      } else {
        place = { links: [cover.id] };
        placed = `inside ${quoted(cover.fields.title)} (${cover.id}), on the shelf of the capability you hold`;
      }
    }
  }
  const note = await write(context.library, args, fields, place, context.writer!);
  return { text: `Wrote a ${args.kind} (${note.id}) ${placed}.`, data: { id: note.id, ...(emptyShelf === undefined ? {} : { shelf: "empty" }) } };
}

function write(library: Library, args: NoteArgs, fields: NoteArgs["fields"] | undefined, place: { links?: string[]; frontCoverOf?: string }, writer: WriteOptions): Promise<Note> {
  switch (args.kind) {
    case "decision":
      return library.recordDecision({ status: "accepted", title: args.title!, text: args.text!, ...place }, writer);
    case "definition":
      return library.defineTerm({ term: args.term!, meaning: args.meaning!, ...(place.links === undefined ? {} : { links: place.links }) }, writer);
    default:
      return library.writeKnowledge(args.kind as KnowledgeKind, { ...fields, ...place } as never, writer);
  }
}

/** The capability the calling session claimed most recently of those it still holds. */
async function latestClaim(context: NoteToolContext): Promise<string | undefined> {
  const mine = (await context.claims()).filter((held) => held.session === context.session && held.capability !== undefined);
  return mine.sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : 0)).at(-1)?.capability;
}

/** The cover on `shelf` the calling session opened most recently, if it opened any. */
async function lastOpened(context: NoteToolContext, shelf: readonly SchemaRecord<"decision">[]): Promise<SchemaRecord<"decision"> | undefined> {
  const opened = (await context.notesRead()).filter((read) => read.read === "whole").map((read) => read.note);
  for (const note of opened.reverse()) {
    const cover = shelf.find((candidate) => candidate.id === note);
    if (cover !== undefined) return cover;
  }
  return undefined;
}

/** How the calling session came to artifact `id`: where it last saw it shown, or by its id if it never was. */
async function howFound(context: NoteToolContext, id: string): Promise<Found> {
  return (await context.notesRead()).filter((read) => read.note === id && read.read === "peek").at(-1)?.found ?? "id";
}

/** A title, quoted as the tools quote names. */
function quoted(title: string): string {
  return `"${title}"`;
}

/** A record's spine: what it is called, the way a shelf or a search result shows it. */
function spineOf(note: Findable): string {
  return note.type === "definition" ? note.fields.term : note.fields.title;
}

/** A record's first line, below its spine: the decision's text, the definition's meaning, or the description, begun. */
function firstLineOf(note: Findable): string {
  const text = note.type === "decision" ? note.fields.text : note.type === "definition" ? note.fields.meaning : note.fields.description ?? "";
  const line = text.split(/\r?\n/, 1)[0] ?? "";
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}

/** What the eight further kinds, a check and research are called in a sentence. */
const KIND_NAMES: Readonly<Record<string, string>> = {
  principle: "Principle",
  guardrail: "Guardrail",
  pattern: "Pattern",
  process: "Process",
  agent: "Agent role",
  friction: "Friction",
  resteer: "Re-steer",
  techstack: "Tech stack",
  check: "Quality control check",
  research: "Research",
};

/** An artifact in full, as opening it shows it. */
function wholeOf(note: Note): string {
  switch (note.type) {
    case "decision":
      return `Decision ${quoted(note.fields.title)} (${note.id}):\n${note.fields.text}`;
    case "definition":
      return `Definition of ${quoted(note.fields.term)} (${note.id}):\n${note.fields.meaning}`;
    default: {
      // One of the library's eight further kinds (ADR-0640): its title, its one-line description,
      // and each other field that holds words, by name.
      const { title, description, ...rest } = note.fields as Record<string, unknown>;
      const fields = Object.entries(rest).flatMap(([name, value]) => (typeof value === "string" ? [`${name}: ${value}`] : []));
      return [`${KIND_NAMES[note.type] ?? note.type} ${quoted(String(title))} (${note.id}):`, String(description), ...fields].join("\n");
    }
  }
}

function spineLine(note: Findable): string {
  const first = firstLineOf(note);
  // A friction report says where it stands, so a settled one found by meaning reads as settled (ADR-1016 D4).
  const state = note.type === "friction" ? `, ${note.fields.state}` : "";
  return `- ${quoted(spineOf(note))} (${note.id}${state})${first === "" ? "" : `: ${first}`}`;
}

function spineData(note: Findable): { id: string; kind: string; spine: string; firstLine: string; state?: string } {
  return { id: note.id, kind: note.type, spine: spineOf(note), firstLine: firstLineOf(note), ...(note.type === "friction" ? { state: note.fields.state } : {}) };
}
