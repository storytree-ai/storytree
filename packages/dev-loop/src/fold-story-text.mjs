// Capability 5 · Library tools. The one-time fold of ADR-1050 D1: when the library became the one copy of 0.3's stories
// (ADR-0641), each story file's prose was split into paragraph-sized definitions, "Story text: stories/<story>.md ## …",
// pinned behind a front cover by their first link that names one. The fold moves each piece into the `text` of the story
// or capability behind that cover, and retires it; its history keeps it. A piece behind no cover is listed and left;
// one behind the cover of a story or capability since retired is listed and retired with it.
//
// The text is written as the export printed the pieces (packages/dev-loop/src/library-export.mjs reads it so):
// - a story's opening pieces, in the order written, then its closing sections (those starting `## `);
// - a capability's `- **Depends on:**` piece first, its `**Contracts**` header last, and the rest in the order
//   written between; two list items (`- …`, indented or not) one after the other are one list, joined by a line
//   break, and every other pair of pieces by a blank line.
//
// Run it as `node --import tsx packages/dev-loop/src/fold-story-text.mjs [--project <name>] [--dry-run]` against the
// library the storytree `library` setting names; --dry-run says what it would fold and writes nothing.

import { pathToFileURL } from "node:url";

import { connect } from "@storytree/library";
import { readLibrary } from "@storytree/project-and-caller";

import { appHome } from "../../../apps/desktop/src/home.ts";
import { settingLibraryServer } from "@storytree/repo-checks/library-server";

const PREFIX = "Story text: ";
const COMMAND = "fold-story-text";

/**
 * Fold every story-text definition in `library` into its story's or capability's text, and retire it.
 * @param {import("@storytree/library").Library} library
 * @param {{ dryRun?: boolean }} [options]
 * @returns {Promise<{ nodes: { id: string, pieces: number }[], retired: number, uncovered: string[], orphaned: string[] }>}
 */
export async function foldStoryText(library, { dryRun = false } = {}) {
  const notes = await library.search(""); // every live note, in creation order
  /** @type {Map<string, string>} cover id -> the node it is a front cover of */
  const coverOf = new Map();
  for (const note of notes) if (note.type === "decision" && note.fields.frontCoverOf !== undefined) coverOf.set(note.id, note.fields.frontCoverOf);
  // Notes created in the same millisecond tie in creation order, broken by their random ids; the history's sequence is the order they were written.
  /** @type {Map<string, number>} */
  const written = new Map();
  for (const entry of await library.history({ types: ["definition"] })) if (entry.action === "created") written.set(entry.recordId, entry.seq);
  const pieces = notes.filter((note) => note.type === "definition" && note.fields.term.startsWith(PREFIX));
  pieces.sort((a, b) => (written.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (written.get(b.id) ?? Number.MAX_SAFE_INTEGER));

  /** @type {Map<string, typeof pieces>} node id -> its pieces, in the order written */
  const behind = new Map();
  const uncovered = [];
  for (const piece of pieces) {
    const cover = piece.fields.links?.find((id) => coverOf.has(id));
    if (cover === undefined) uncovered.push(piece.id);
    else behind.set(coverOf.get(cover), [...(behind.get(coverOf.get(cover)) ?? []), piece]);
  }

  const nodes = [];
  const orphaned = [];
  let retired = 0;
  for (const [id, own] of behind) {
    const node = await library.get(id);
    if (node === null || (node.type !== "story" && node.type !== "capability")) {
      // Prose of a story or capability since retired, which the export no longer printed: retired with it.
      orphaned.push(...own.map((piece) => piece.id));
      if (dryRun) continue;
      for (const piece of own) {
        await library.retire(piece.id, `The story or capability its cover names, ${id}, is retired; its prose goes with it (ADR-1050 D1).`);
        retired += 1;
      }
      continue;
    }
    const texts = own.map((piece) => piece.fields.meaning);
    const folded = node.type === "story" ? storyText(texts) : capabilityText(texts);
    const text = node.fields.text === undefined ? folded : `${node.fields.text}\n\n${folded}`;
    nodes.push({ id, pieces: own.length });
    if (dryRun) continue;
    if (node.type === "story") await library.editStory(id, { text });
    else await library.editCapability(id, { text });
    for (const piece of own) {
      await library.retire(piece.id, `Folded into the text of ${id} (ADR-1050 D1).`);
      retired += 1;
    }
  }
  return { nodes, retired, uncovered, orphaned };
}

/** A story's text from its pieces: the opening ones, then the closing sections. */
function storyText(texts) {
  const closing = texts.filter((text) => text.startsWith("## "));
  return [...texts.filter((text) => !text.startsWith("## ")), ...closing].join("\n\n");
}

/** A capability's text from its pieces: the depends line first, the contracts header last, list items run together. */
function capabilityText(texts) {
  const depends = texts.find((text) => text.startsWith("- **Depends on:**"));
  const contracts = texts.find((text) => text.startsWith("**Contracts**"));
  const ordered = [depends, ...texts.filter((text) => text !== depends && text !== contracts), contracts].filter((text) => text !== undefined);
  return ordered.reduce((all, text, index) => (index === 0 ? text : `${all}${isListItem(ordered[index - 1]) && isListItem(text) ? "\n" : "\n\n"}${text}`), "");
}

function isListItem(text) {
  return /^\s*- /.test(text);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`\n${COMMAND}: ${error.stack ?? error.message}`);
      process.exitCode = 1;
    },
  );
}

async function main(args) {
  const dryRun = args.includes("--dry-run");
  const project = args.includes("--project") ? args[args.indexOf("--project") + 1] : "storytree";
  const server = await settingLibraryServer(COMMAND, { setting: readLibrary(appHome().dir), writes: !dryRun });
  try {
    const storytree = await connect(server.where);
    try {
      const library = await storytree.openProject(project, { create: false });
      try {
        const { nodes, retired, uncovered, orphaned } = await foldStoryText(library, { dryRun });
        console.log(`${dryRun ? "would fold" : "folded"} ${nodes.reduce((sum, node) => sum + node.pieces, 0)} pieces into ${nodes.length} stories and capabilities of ${project}; retired ${retired}`);
        console.log(uncovered.length === 0 ? "every piece had a cover" : `left, behind no cover: ${uncovered.join(", ")}`);
        if (orphaned.length > 0) console.log(`${dryRun ? "would retire" : "retired"}, behind a retired node's cover: ${orphaned.join(", ")}`);
      } finally {
        await library.close();
      }
    } finally {
      await storytree.close();
    }
  } finally {
    await server.stop();
  }
  return 0;
}
