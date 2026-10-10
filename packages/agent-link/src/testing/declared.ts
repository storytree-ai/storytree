/**
 * Capability 5 · Claims. A stand-in for the map's file-to-capability lookup (its declared half), for the agent
 * link's own tests of the gate before each edit: a file in a story's package (`packages/<the story's title,
 * lower-cased and hyphenated>/`) is placed by an opening "Capability N · …" alone. The rule itself is the
 * map's (packages/map/src/code-survey), which the release hook is given by the app setup story.
 */
import type { DeclaredCapabilities } from "../claims/edit-gate.js";

export const declaredInTests: DeclaredCapabilities = async (_checkout, files, tree, readText) => {
  const placed = new Map<string, string>();
  for (const file of files) {
    const story = tree.stories.find(({ title }) => file.startsWith(`packages/${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}/`));
    if (story === undefined) continue;
    let text: string;
    try {
      text = readText(file);
    } catch {
      continue;
    }
    const number = /^\/\*\*\s*\n\s*\*\s*Capability (\d+) ·/.exec(text)?.[1];
    const capability = story.capabilities.find(({ title }) => /^\s*(\d+)\s*·/.exec(title)?.[1] === number);
    if (number !== undefined && capability !== undefined) placed.set(file, capability.id);
  }
  return placed;
};
