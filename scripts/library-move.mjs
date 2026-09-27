// Moving the story text only the files hold into the library (ADR-0641 D2 step 2, choice L1), which
// scripts/move-story-text.mjs runs as `pnpm library:move`. It exists for the flip and goes with the
// seed's file half when the library becomes the one copy (`0-3-library-is-the-one-copy`).
//
// The worklist is the round trip (scripts/library-export.mjs): each block a committed story file
// holds that the library's printout lacks. Each becomes one definition with a term
// starting `Story text: ` and naming its file and section. Its meaning is the block exactly
// as the file writes it, linked to the first front cover of the node it sits under, so the export
// prints it back in its place:
// - a block under the story's `# Story:` title goes behind the story's first cover;
// - a block under `## N · Name` goes behind capability N's first cover (its founding book);
// - a closing `## ` section that is not a capability goes behind the story's first cover as one
//   artifact, heading and all, as the file writes it.
// Artifacts are written in file order, so they print in it. A block whose node has no front cover, or
// whose story or capability the library does not hold, is not written: it comes back as unplaced,
// with the reason, for the owner by name (ADR-0633 D1). A second run finds nothing missing and
// writes nothing. Decision files are not moved: a decision prints back whole.

import { exportLibrary, roundTrip } from "./library-export.mjs";

/**
 * @typedef {{ file: string, section: string, node: string, cover: string, text: string }} Filed
 * @typedef {{ file: string, section: string, text: string, words: number, why: string }} Unplaced
 */

/**
 * File every block the committed story files hold and the library does not as an artifact behind its
 * node's cover. With `dryRun` nothing is written, and the result says what would be.
 * @param {import("@storytree/library").Library} library
 * @param {Map<string, string>} committed repo path (`stories/app.md`) -> markdown
 * @param {{ dryRun?: boolean }} [options]
 * @returns {Promise<{ filed: Filed[], unplaced: Unplaced[] }>}
 */
export async function moveStoryText(library, committed, { dryRun = false } = {}) {
  const tree = await library.projectTree();
  const diffs = roundTrip(committed, await exportLibrary(library));
  /** @type {Filed[]} */
  const filed = [];
  /** @type {Unplaced[]} */
  const unplaced = [];
  /** @type {Map<string, string | undefined>} node id -> its first front cover's id */
  const firstCover = new Map();
  const coverOf = async (nodeId) => {
    if (!firstCover.has(nodeId)) firstCover.set(nodeId, (await library.frontCovers(nodeId))[0]?.id);
    return firstCover.get(nodeId);
  };

  for (const { file, missing } of diffs) {
    if (!file.startsWith("stories/") || missing.length === 0) continue;
    const markdown = committed.get(file);
    const title = /^# Story: (.*)$/m.exec(markdown)?.[1].trim() ?? file;
    const story = tree.stories.find((candidate) => candidate.title.toLowerCase() === title.toLowerCase());
    const skip = (block, why) => unplaced.push({ file, section: block.section, text: block.raw, words: block.words, why });
    if (story === undefined) {
      for (const block of missing) skip(block, `the library has no story "${title}"`);
      continue;
    }

    const closing = new Set(); // closing sections already filed whole
    for (const block of missing) {
      const number = /^## (\d+) · /.exec(block.section)?.[1];
      /** @type {{ id: string, title: string } | undefined} */
      let node;
      let text = block.raw;
      if (block.section.startsWith("# ")) {
        node = story;
      } else if (number !== undefined) {
        node = story.capabilities.find((capability) => capability.title.startsWith(`${number} · `));
        if (node === undefined) {
          skip(block, `the library's "${story.title}" has no capability ${number}`);
          continue;
        }
      } else if (block.section.startsWith("## ")) {
        if (closing.has(block.section)) continue;
        if (!missing.some((other) => other.section === block.section && other.text === block.section)) {
          skip(block, `the library already holds part of the section "${block.section}"; correct that artifact in place`);
          continue;
        }
        closing.add(block.section);
        node = story;
        text = sectionOf(markdown, block.section);
      } else {
        skip(block, "it comes before the story's title");
        continue;
      }

      const cover = await coverOf(node.id);
      if (cover === undefined) {
        skip(block, `${node.title} has no front cover to file it behind`);
        continue;
      }
      if (!dryRun) await library.defineTerm({ term: `Story text: ${file} ${block.section}`, meaning: text, links: [cover] });
      filed.push({ file, section: block.section, node: node.id, cover, text });
    }
  }
  return { filed, unplaced };
}

/** A `## ` section of `markdown` as the file writes it: its heading line to the line before the next heading, rule or the end, trimmed. */
function sectionOf(markdown, heading) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.trim() === heading);
  let end = start + 1;
  while (end < lines.length && !/^(#{1,2} |---+\s*$)/.test(lines[end])) end++;
  return lines.slice(start, end).join("\n").trim();
}
