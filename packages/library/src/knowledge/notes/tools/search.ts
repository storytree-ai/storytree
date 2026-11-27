// Capability 17 · The library's commands
import { librariesNamed, PROJECTS_INPUT, refusing, unopenedSaid, verb, VerbRefusal, type VerbAnswer } from "../../../commands/kit/index.js";
import { everyHolding, holdingLines, SEARCHABLE_KINDS, titleOf, type NarrowingDecision, type PhraseKind, type RankOptions } from "../../search/index.js";
import type { NoteToolContext } from "./context.js";

export function searchKinds(kinds: readonly string[] | undefined): RankOptions["kinds"] {
  if (kinds === undefined || kinds.length === 0) return undefined;
  const unknown = kinds.find((kind) => !SEARCHABLE_KINDS.includes(kind));
  if (unknown !== undefined) throw new VerbRefusal(`${unknown} is not a kind a search ranks: name one of ${SEARCHABLE_KINDS.join(", ")}`, { misuse: true });
  return kinds as RankOptions["kinds"];
}

function narrowing(narrowedBy: readonly NarrowingDecision[]): NarrowingDecision[] {
  return narrowedBy.map(({ id, number, clauses }) => ({ id, ...(number === undefined ? {} : { number }), ...(clauses === undefined ? {} : { clauses }) }));
}

export const SEARCH_NOTES = verb({
  command: { absent: "library search ranks the library on the command line" },
  tool: { name: "search_notes", description: "Search the library's notes, decisions and plan by meaning; give history for resteers, friction and superseded decisions, kinds to rank only those kinds, projects to search other libraries of this factory's circle" },
  inputs: {
    query: { kind: "text", describe: "What to search for, in words" },
    limit: { kind: "count", optional: true, describe: "How many results to give at most (10 unless given)" },
    history: { kind: "switch", describe: "Bring back resteers, friction and superseded decisions too" },
    kinds: { kind: "text", many: true, optional: true, describe: "Rank only these kinds" },
    projects: PROJECTS_INPUT,
  },
  async act({ query, limit, history, kinds, projects }, context: NoteToolContext): Promise<VerbAnswer> {
    const named = searchKinds(kinds);
    const across = projects !== undefined && projects.length > 0;
    const notes: Record<string, unknown>[] = [];
    const sections: string[] = [];
    for (const reached of await librariesNamed(context.library, projects)) {
      if (reached.opened === undefined) {
        sections.push(unopenedSaid(reached.project, reached.unopened));
        continue;
      }
      const ranked = await refusing(() => reached.opened.rankAll(query, { limit: limit ?? 10, history, ...(named === undefined ? {} : { kinds: named }) }));
      const lines = ranked.hits.map(({ note }) => `${note.id}  [${note.type}]  ${titleOf(note)}`);
      if (reached.opened === context.library && ranked.hits.length > 0) {
        await context.recordReads(ranked.hits.map(({ note }) => ({ note: note.id, found: "search", read: "peek" })));
      }
      for (const { note, score, narrowedBy } of ranked.hits) {
        notes.push({ id: note.id, type: note.type, title: titleOf(note), ...(score === undefined ? {} : { score }), ...(narrowedBy === undefined ? {} : { narrowedBy: narrowing(narrowedBy) }), ...(across ? { project: reached.project } : {}) });
      }
      const said = [...(ranked.why === undefined ? [] : [ranked.why]), ...(lines.length === 0 ? [`Nothing matches ${JSON.stringify(query)}.`] : lines)].join("\n");
      sections.push(across ? `project ${reached.project}:\n${said}` : said);
    }
    return { text: sections.join("\n\n"), data: { notes } };
  },
});

export const FIND_TEXT = verb({
  command: { absent: "library exact finds a phrase on the command line" },
  tool: { name: "find_text", description: "List every live record holding a phrase exactly, each with its id, kind, title and the fields that hold it" },
  inputs: {
    phrase: { kind: "text", verbatim: true, describe: "The phrase, exactly as it is written" },
    kinds: { kind: "text", many: true, optional: true, describe: "Look only in these kinds" },
    fields: { kind: "text", many: true, optional: true, describe: "Look only in these fields" },
  },
  async act({ phrase, kinds, fields }, context: NoteToolContext): Promise<VerbAnswer> {
    const hits = await refusing(() => everyHolding(context.library, phrase, {
      ...(kinds.length === 0 ? {} : { kinds: kinds as PhraseKind[] }),
      ...(fields.length === 0 ? {} : { fields }),
    }));
    if (hits.length > 0) await context.recordReads(hits.map(({ record }) => ({ note: record.id, found: "search", read: "peek" })));
    return { text: holdingLines(phrase, hits), data: { records: hits.map(({ record, title, fields: holding }) => ({ id: record.id, type: record.type, title, fields: holding })) } };
  },
});
