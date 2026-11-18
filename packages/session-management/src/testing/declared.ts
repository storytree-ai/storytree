// Capability 5 · Claims
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
    const number = /^\/\*\*[^\S\n]*\n\s*\*\s*Capability (\d+) ·/.exec(text)?.[1];
    const capability = story.capabilities.find(({ title }) => /^\s*(\d+)\s*·/.exec(title)?.[1] === number);
    if (number !== undefined && capability !== undefined) placed.set(file, capability.id);
  }
  return placed;
};
