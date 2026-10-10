/**
 * Capability 6 · Agent tools (the MCP server). The artifact tools, on the library's knowledge entrances (ADR-0627): search artifacts, open a story or
 * capability (its shelf of front covers, as spines) or an artifact (whole, with the titles of what it
 * links to and what links to it), and write an artifact.
 *
 * - Every artifact a tool shows is a read, recorded in the agent activity log (ADR-0624 D1, ADR-0627
 *   D7): a spine or title shown is a peek, an opened artifact is read whole. How it was found is how
 *   the session last saw it: in a search, on a shelf, or as a link from another artifact; an artifact
 *   opened without having been shown was found by its id. Each read names the agent that made it,
 *   as the harness revealed it (ADR-0629 D2). The record says what was reached, never what helped
 *   (ADR-0624 D3).
 * - A contract opens whole too: its promise and the capability it belongs to. So does a question: its
 *   arc and state, its wording and answer, and the open increments held on it. An arc is refused.
 * - An artifact is corrected in place through the library's editNote (ADR-0641 D2 step 3): only the
 *   fields given change, and its old wording stays in its history.
 * - A new artifact with no place named goes onto the shelf of the capability the session claimed most
 *   recently (ADR-0627 D4): a decision becomes one of its front covers; a definition or other artifact kind
 *   links to the cover the session last opened on that shelf, else to the shelf's first book; with
 *   an empty shelf nothing is added, and the agent is told. A session holding no claim gets no
 *   default, and a place the agent names always wins.
 */
import type { KnowledgeKind, Library, Note, NoteEdit, SchemaRecord, WriteOptions } from "@storytree/library";
import { z } from "zod";

import type { Line, NewLine } from "@storytree/agent-link";
import { readClaims } from "@storytree/agent-link";
import { lineOf, type Answer, type Call, type Define } from "./server.js";
import { firstLineOf, quoted, spineOf, wholeOf, type Findable } from "./text.js";

type Found = Extract<NewLine, { kind: "note-read" }>["found"];
type CapabilityNode = Awaited<ReturnType<Library["projectTree"]>>["stories"][number]["capabilities"][number];
type ContractNode = CapabilityNode["contracts"][number];

export function registerNoteTools(define: Define): void {
  define(
    "search_notes",
    "Search the project's artifacts (decisions, definitions and other artifact kinds) and its stories, capabilities and contracts: the ones closest in meaning to your question, best first; you see each one's spine. Ask in plain words. Open one to read it whole.",
    z.object({
      query: z.string().min(1).describe("What you want to know, in plain words"),
      limit: z.number().int().min(1).optional().describe("How many to give back; 10 unless given"),
    }),
    async ({ query, limit }, call) => {
      const ranked = await call.library.rankAll(query, limit === undefined ? {} : { limit });
      const notes = ranked.hits.map(({ note }) => note);
      await recordReads(call, notes.map((note) => ({ note: note.id, found: "search", read: "peek" })));
      const heading = ranked.by === "meaning"
        ? `closest in meaning to ${quoted(query)}:`
        : `ranked by words: ${ranked.why}; the records holding every word of ${quoted(query)}:`;
      if (notes.length === 0) return { text: `${heading}\n(none)`, data: { by: ranked.by, notes: [] } };
      return {
        text: [heading, ...notes.map(spineLine)].join("\n"),
        data: { by: ranked.by, notes: notes.map(spineData) },
      };
    },
  );

  define(
    "open",
    "Open a story or a capability to see its shelf of front-cover decisions as spines, founding book first; open a contract to read its promise and the capability it belongs to; open a question to read it whole with the work held on it; or open an artifact to read it whole, with the titles of what it links to and what links to it. Start at the shelf, open what matches your task, and stop when you can act.",
    z.object({ id: z.string().min(1).describe("The id of a story, a capability, a contract, a question or an artifact") }),
    async ({ id }, call) => openRecord(id, call),
  );

  define(
    "write_note",
    "Write an artifact: a decision (title and text), definition (term and meaning), or principle, guardrail, pattern, process, agent, techstack or check (required fields in fields). Use record_friction and record_resteer for their evidence rules. With no place named, it goes onto the shelf of the capability you claimed most recently.",
    z.object({
      kind: z.string().min(1).describe("decision, definition, principle, guardrail, pattern, process, agent, techstack or check; friction and resteer have capture tools"),
      fields: z.record(z.string(), z.unknown()).optional().describe("Required fields of a principle, guardrail, pattern, process, agent, techstack or check"),
      text: z.string().min(1).optional().describe("A decision's text"),
      title: z.string().min(1).optional().describe("A decision's title"),
      term: z.string().min(1).optional().describe("A definition's term"),
      meaning: z.string().min(1).optional().describe("A definition's meaning"),
      links: z.array(z.string().min(1)).optional().describe("The ids of artifacts this one links to"),
      front_cover_of: z.string().min(1).optional().describe("A decision only: the story or capability it is a front cover of"),
    }),
    async (args, call) => writeNote(args, call),
  );

  define(
    "correct_note",
    "Correct an artifact's wording in place: change only the fields you give (a decision's text, a decision's title, a definition's term or meaning). It keeps its id, and its old wording stays in its history.",
    z.object({
      id: z.string().min(1).describe("The id of the artifact to correct"),
      text: z.string().min(1).optional().describe("A decision's text"),
      title: z.string().min(1).optional().describe("A decision's title"),
      term: z.string().min(1).optional().describe("A definition's term"),
      meaning: z.string().min(1).optional().describe("A definition's meaning"),
    }),
    async ({ id, ...wording }, { library, writer }) => {
      const fields = Object.fromEntries(Object.entries(wording).filter(([, value]) => value !== undefined));
      if (Object.keys(fields).length === 0) return { text: "Give the words to change: text, title, term or meaning.", refused: true };
      const note = await library.editNote(id, fields as NoteEdit, writer);
      if (note === null) return { text: `There is no artifact ${id} in this project.`, refused: true };
      return { text: `Corrected ${quoted(spineOf(note))} (${id}).`, data: { id } };
    },
  );
}

async function openRecord(id: string, call: Call): Promise<Answer> {
  const { library } = call;
  const tree = await library.projectTree();
  for (const story of tree.stories) {
    if (story.id === id) return openShelf("Story", story.title, id, call);
    for (const capability of story.capabilities) {
      if (capability.id === id) return openShelf("Capability", capability.title, id, call);
      const contract = capability.contracts.find((node) => node.id === id);
      if (contract !== undefined) return openContract(contract, capability);
    }
  }
  const record = await library.get(id);
  if (record?.type === "question") return openQuestion(record as SchemaRecord<"question">, call);
  const notes = await library.search("");
  const note = notes.find((candidate) => candidate.id === id);
  if (note === undefined) {
    const arc = tree.arcs.some((node) => node.id === id);
    return {
      text: arc ? `${id} is an arc: open a story, a capability, a contract, a question or an artifact.` : `Nothing in this project has the id ${id}.`,
      refused: true,
    };
  }
  const found = await howFound(call, id);
  const linksTo = (note.fields.links ?? []).flatMap((target) => notes.filter((candidate) => candidate.id === target));
  const linkedFrom = await library.relatedNotes(id);
  await recordReads(call, [
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
async function openQuestion(question: SchemaRecord<"question">, { library }: Call): Promise<Answer> {
  const fields = question.fields as Readonly<Record<string, unknown>>;
  const settled = typeof fields.settledAt === "string" ? `, settled ${fields.settledAt}${typeof fields.settledBy === "string" ? ` by ${fields.settledBy}` : ""}` : "";
  const holding = Object.entries((await library.holds()).heldOn).flatMap(([increment, on]) => (on.includes(question.id) ? [increment] : []));
  const out = [`Question ${quoted(String(fields.title))} (${question.id}):`, `On ${String(fields.arc)}, ${String(fields.lifecycle)}${settled}.`];
  for (const name of QUESTION_WORDS) {
    if (typeof fields[name] === "string") out.push(`${name[0]?.toUpperCase()}${name.slice(1)}: ${fields[name]}`);
  }
  if (holding.length > 0) out.push(`Holding: ${holding.join(", ")}`);
  return { text: out.join("\n"), data: { question: { id: question.id, ...fields, holding } } };
}

/** A contract whole: its title, its description, and the capability it belongs to. */
function openContract(contract: ContractNode, capability: CapabilityNode): Answer {
  const out = [`Contract ${quoted(contract.title)} (${contract.id}):`];
  if (contract.description !== undefined) out.push(contract.description);
  out.push(`It belongs to Capability ${quoted(capability.title)} (${capability.id}).`);
  return {
    text: out.join("\n"),
    data: { contract: { id: contract.id, title: contract.title, ...(contract.description === undefined ? {} : { description: contract.description }), capability: { id: capability.id, title: capability.title } } },
  };
}

async function openShelf(kind: "Story" | "Capability", title: string, id: string, call: Call): Promise<Answer> {
  const shelf = await call.library.frontCovers(id);
  await recordReads(call, shelf.map((cover) => ({ note: cover.id, found: "shelf", read: "peek" })));
  if (shelf.length === 0) {
    return { text: `${kind} ${quoted(title)} (${id}) has no front covers yet. Record its founding decision with write_note.`, data: { shelf: [] } };
  }
  return {
    text: [`${kind} ${quoted(title)} (${id}). Its shelf, founding book first:`, ...shelf.map(spineLine)].join("\n"),
    data: { shelf: shelf.map(spineData) },
  };
}

interface NoteArgs {
  kind: string;
  fields?: Record<string, unknown> | undefined;
  text?: string | undefined;
  title?: string | undefined;
  term?: string | undefined;
  meaning?: string | undefined;
  links?: string[] | undefined;
  front_cover_of?: string | undefined;
}

/** What each kind of artifact is written with. */
const FIELDS = { decision: ["title", "text"], definition: ["term", "meaning"] } as const;

async function writeNote(args: NoteArgs, call: Call): Promise<Answer> {
  if (args.kind === "memory") return { text: "memory belongs to the agent harness, not the library (ADR-0650); write a proper artifact kind such as decision, definition or principle.", refused: true };
  if (args.kind === "friction" || args.kind === "resteer") return { text: `Use record_${args.kind} to write this artifact under its evidence rules.`, refused: true };
  const further = ["principle", "guardrail", "pattern", "process", "agent", "techstack", "check"].includes(args.kind);
  if (!further && args.kind !== "decision" && args.kind !== "definition") return { text: `Unknown artifact kind ${quoted(args.kind)}; use decision, definition, principle, guardrail, pattern, process, agent, techstack or check.`, refused: true };
  const needs: readonly string[] = further ? [] : FIELDS[args.kind as keyof typeof FIELDS];
  if (further && args.fields === undefined) return { text: `Give the required fields for a ${args.kind} in fields.`, refused: true };
  if (!further && args.fields !== undefined) return { text: `A ${args.kind} takes ${needs.join(" and ")} directly.`, refused: true };
  if (args.fields && ["links", "frontCoverOf"].some((key) => key in args.fields!)) return { text: "Give links or front_cover_of directly to name the artifact's place.", refused: true };
  const given = (["text", "title", "term", "meaning"] as const).filter((field) => args[field] !== undefined);
  const missing = needs.filter((field) => args[field as keyof NoteArgs] === undefined);
  const extra = given.filter((field) => !needs.includes(field));
  if (missing.length > 0 || extra.length > 0) return { text: `A ${args.kind} is written with ${needs.join(" and ")}${extra.length > 0 ? `, not ${extra.join(" or ")}` : ""}.`, refused: true };
  if (args.front_cover_of !== undefined && args.kind !== "decision") return { text: "Only a decision can be a front cover.", refused: true };

  let place: { links?: string[]; frontCoverOf?: string } = {
    ...(args.links === undefined ? {} : { links: args.links }),
    ...(args.front_cover_of === undefined ? {} : { frontCoverOf: args.front_cover_of }),
  };
  let placed = "where you named";
  let emptyShelf: string | undefined;
  if (args.links === undefined && args.front_cover_of === undefined) {
    const held = await latestClaim(call);
    if (held === undefined) placed = "with no place: you hold no claim, so name its links (or, for a decision, the node it is a front cover of) to file it";
    else if (args.kind === "decision") {
      place = { frontCoverOf: held };
      placed = `as a front cover of ${held}, the capability you hold`;
    } else {
      const shelf = await call.library.frontCovers(held);
      const cover = (await lastOpened(call, shelf)) ?? shelf[0];
      if (cover === undefined) {
        emptyShelf = held;
        placed = `with no place: the shelf of ${held}, the capability you hold, is empty. Record its founding decision with write_note (kind decision), then link artifacts inside it`;
      } else {
        place = { links: [cover.id] };
        placed = `inside ${quoted(cover.fields.title)} (${cover.id}), on the shelf of the capability you hold`;
      }
    }
  }
  const note = await write(call.library, args, place, call.writer);
  return { text: `Wrote a ${args.kind} (${note.id}) ${placed}.`, data: { id: note.id, ...(emptyShelf === undefined ? {} : { shelf: "empty" }) } };
}

function write(library: Library, args: NoteArgs, place: { links?: string[]; frontCoverOf?: string }, writer: WriteOptions): Promise<Note> {
  switch (args.kind) {
    case "decision":
      return library.recordDecision({ status: "accepted", title: args.title!, text: args.text!, ...place }, writer);
    case "definition":
      return library.defineTerm({ term: args.term!, meaning: args.meaning!, ...(place.links === undefined ? {} : { links: place.links }) }, writer);
    default:
      return library.writeKnowledge(args.kind as KnowledgeKind, { ...args.fields, ...place } as never, writer);
  }
}

/** The capability the calling session claimed most recently of those it still holds. */
async function latestClaim(call: Call): Promise<string | undefined> {
  const mine = (await readClaims(call.log, call.project, { quietMs: call.quietMs })).filter((held) => held.session === call.caller.session && held.capability !== undefined);
  return mine.sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : 0)).at(-1)?.capability;
}

/** The cover on `shelf` the calling session opened most recently, if it opened any. */
async function lastOpened(call: Call, shelf: readonly SchemaRecord<"decision">[]): Promise<SchemaRecord<"decision"> | undefined> {
  const opened = (await readsOf(call)).filter((line) => line.read === "whole").map((line) => line.note);
  for (const note of opened.reverse()) {
    const cover = shelf.find((candidate) => candidate.id === note);
    if (cover !== undefined) return cover;
  }
  return undefined;
}

/** How the calling session came to artifact `id`: where it last saw it shown, or by its id if it never was. */
async function howFound(call: Call, id: string): Promise<Found> {
  return (await readsOf(call)).filter((line) => line.note === id && line.read === "peek").at(-1)?.found ?? "id";
}

/** The calling session's artifact reads, oldest first: its own note-read lines alone (contract 2.7). */
async function readsOf(call: Call): Promise<Extract<Line, { kind: "note-read" }>[]> {
  const lines = await call.log.lines(call.project, { kinds: ["note-read"], sessions: [call.caller.session], omit: ["transcript"] });
  return lines.filter((line): line is Extract<Line, { kind: "note-read" }> => line.kind === "note-read");
}

async function recordReads(call: Call, reads: readonly { note: string; found: Found; read: "peek" | "whole" }[]): Promise<void> {
  for (const read of reads) {
    await call.log.append(call.project, { ...lineOf(call.caller), source: "tool", folder: call.folder, kind: "note-read", ...read, agent: call.agent, ...(call.request === undefined ? {} : { causedBy: call.request }) });
  }
}

function spineLine(note: Findable): string {
  const first = firstLineOf(note);
  return `- ${quoted(spineOf(note))} (${note.id})${first === "" ? "" : `: ${first}`}`;
}

function spineData(note: Findable): { id: string; kind: string; spine: string; firstLine: string } {
  return { id: note.id, kind: note.type, spine: spineOf(note), firstLine: firstLineOf(note) };
}
