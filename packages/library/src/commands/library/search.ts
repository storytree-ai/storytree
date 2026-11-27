// Capability 17 · The library's commands
import { readFileSync } from "node:fs";
import path from "node:path";

import { searchKinds } from "../../knowledge/notes/index.js";
import { everyHolding, holdingLines, titleOf, type PhraseKind } from "../../knowledge/search/index.js";
import type { LibraryVerbContext } from "../context.js";
import { librariesNamed, PROJECTS_INPUT, refusing, unopenedSaid, verb, VerbRefusal, type VerbAnswer } from "../kit/index.js";
import { narrowedSaid } from "../ranked.js";
import { dormantSaid } from "./dormant.js";

export function countOf(name: string, text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(text.trim())) throw new VerbRefusal(`--${name} is a whole number above 0, not ${JSON.stringify(text)}`, { misuse: true });
  return Number(text);
}

function phraseFrom(context: LibraryVerbContext, words: readonly string[]): string {
  const phrase = words.join(" ");
  if (!phrase.startsWith("@") || phrase.length === 1) return phrase;
  const file = path.resolve(context.folder, phrase.slice(1));
  try {
    return readFileSync(file, "utf8").replace(/^﻿/, "");
  } catch (error) {
    throw new VerbRefusal(`cannot read the phrase from ${file}: ${(error as Error).message}`);
  }
}

async function refuseDormant(context: LibraryVerbContext, kinds: readonly string[]): Promise<void> {
  if (kinds.length === 0) return;
  const said = await dormantSaid(context, kinds);
  if (said.length > 0) throw new VerbRefusal(said.join("\n"));
}

function kindSaid(note: { readonly type: string; readonly fields: object }): string {
  const state = note.type === "friction" ? (note.fields as { readonly state?: string }).state : undefined;
  return state === undefined ? note.type : `${note.type}: ${state}`;
}

export const SEARCH = verb({
  command: { family: "library", name: "search", summary: "rank the library's records by meaning", usage: "library search <words…> [--limit <n>] [--history] [--kind <kind> …] [--project <project|all> …]" },
  tool: { absent: "search_notes is the search on the tool door", twin: "search_notes" },
  inputs: {
    words: { kind: "text", word: 0, many: true, describe: "What to search for" },
    limit: { kind: "text", optional: true, describe: "How many results to give at most (10 unless given)" },
    history: { kind: "switch", describe: "Bring back resteers, friction and superseded decisions too" },
    kind: { kind: "text", many: true, optional: true, describe: "Rank only these kinds" },
    project: PROJECTS_INPUT,
  },
  async act({ words, limit, history, kind, project }, context: LibraryVerbContext): Promise<VerbAnswer> {
    const kinds = searchKinds(kind);
    const count = countOf("limit", limit) ?? 10;
    const query = words.join(" ");
    const across = project !== undefined && project.length > 0;
    const sections: string[] = [];
    let first: string | undefined;
    for (const reached of await librariesNamed(context.library, project)) {
      if (reached.opened === undefined) {
        sections.push(unopenedSaid(reached.project, reached.unopened));
        continue;
      }
      const ranked = await refusing(() => reached.opened.rankAll(query, { limit: count, ...(history ? { history: true } : {}), ...(kinds === undefined ? {} : { kinds }) }));
      first ??= ranked.hits[0]?.note.id;
      const lines = ranked.hits.map(({ note, score, narrowedBy }) => `  ${score === undefined || ranked.by === "words" ? "" : `${score.toFixed(2)}  `}${note.id}  [${kindSaid(note)}]  ${titleOf(note)}${narrowedSaid(narrowedBy ?? [])}`);
      const heading = ranked.why ?? `closest in meaning to ${JSON.stringify(query)}:`;
      const said = lines.length === 0 ? [...(ranked.why === undefined ? [] : [ranked.why]), `Nothing matches ${JSON.stringify(query)}.`].join("\n") : [heading, ...lines].join("\n");
      sections.push(across ? `project ${reached.project}:\n${said}` : said);
    }
    const dormant = await dormantSaid(context);
    return { text: [sections.join("\n\n"), ...dormant].join("\n"), ...(first === undefined ? {} : { next: [{ command: `library read ${first}`, why: "read the best hit whole" }] }) };
  },
});

export const PHRASE = verb({
  command: { family: "library", name: "phrase", summary: "the records holding a phrase exactly, as JSON, a page at a time", usage: "library phrase <phrase|@file> [--kind <kind> …] [--field <field> …] [--limit <n>] [--after <id>]" },
  tool: { absent: "find_text finds a phrase on the tool door", twin: "find_text" },
  inputs: {
    phrase: { kind: "text", word: 0, many: true, verbatim: true, describe: "The phrase, or @file to read it from a file in this folder" },
    kind: { kind: "text", many: true, optional: true, describe: "Look only in these kinds" },
    field: { kind: "text", many: true, optional: true, describe: "Look only in these fields" },
    limit: { kind: "text", optional: true, describe: "How many records a page holds (10 unless given, at most 100)" },
    after: { kind: "text", optional: true, describe: "The next id the page before gave" },
  },
  async act({ phrase, kind, field, limit, after }, context: LibraryVerbContext): Promise<VerbAnswer> {
    await refuseDormant(context, kind);
    const count = countOf("limit", limit);
    const page = await refusing(() => context.library.findPhrase(phraseFrom(context, phrase), {
      ...(kind.length === 0 ? {} : { kinds: kind as PhraseKind[] }),
      ...(field.length === 0 ? {} : { fields: field }),
      ...(count === undefined ? {} : { limit: count }),
      ...(after === undefined ? {} : { after }),
    }));
    return { text: JSON.stringify(page), raw: true };
  },
});

export const EXACT = verb({
  command: { family: "library", name: "exact", summary: "list every live record holding a phrase exactly, with the fields that hold it", usage: "library exact <phrase> [--kind <kind> …] [--field <field> …]" },
  tool: { absent: "find_text finds a phrase on the tool door", twin: "find_text" },
  inputs: {
    phrase: { kind: "text", word: 0, many: true, verbatim: true, describe: "The phrase, as one argument" },
    kind: { kind: "text", many: true, optional: true, describe: "Look only in these kinds" },
    field: { kind: "text", many: true, optional: true, describe: "Look only in these fields" },
  },
  async act({ phrase, kind, field }, context: LibraryVerbContext): Promise<VerbAnswer> {
    if (phrase.length !== 1) throw new VerbRefusal(`the phrase reached this as ${phrase.length} words: give it as one argument, in quotes`, { misuse: true });
    await refuseDormant(context, kind);
    const hits = await refusing(() => everyHolding(context.library, phrase[0]!, {
      ...(kind.length === 0 ? {} : { kinds: kind as PhraseKind[] }),
      ...(field.length === 0 ? {} : { fields: field }),
    }));
    return { text: holdingLines(phrase[0]!, hits) };
  },
});
