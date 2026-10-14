// Capability 3 · Package boundaries. A type-only import ends only at the library (ADR-1017 D2): the library is the
// registry of the shapes stories share (D1), so a story's source file may import a name type-only from The
// library's package and from no other story's. Imports by value between stories are not this check's business.
//
// It reads the code as the map's code survey does (storyEdges in packages/map/src/code-survey), so the two
// never disagree about what counts: an edge between two stories' capabilities is type-only when every import
// behind it is, and tests and test helpers make no edge. The survey takes each capability from the library; this
// check reads only the code, so CI can run it too, and groups files by the capability numbers their numbered
// tests carry, which is how the survey matches a file to a capability. `pnpm gate` runs it as check:type-imports,
// and CI runs it on every system.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { codeSurveyReader } from "@storytree/map/code-survey";

import { STORIES } from "./package-boundaries.mjs";

/** Capability numbers a story's tests may carry: each stands for the capability the library numbers so. */
const NUMBERS = Array.from({ length: 99 }, (_, at) => at + 1);

/**
 * Each type-only import in the checkout at `root` that ends at a story other than the library, one sentence each,
 * naming the importing file and the file that defines the name; empty when there is none. `stories` are the ids
 * of the stories, each the folder of its package under packages/.
 */
export async function typeImportProblems(root, stories = STORIES) {
  const tree = { stories: stories.map((id) => ({ id, title: id, capabilities: NUMBERS.map((number) => ({ id: `${id}:${number}`, title: `${number} · ${number}` })) })) };
  const survey = await codeSurveyReader({ checkout: "current" }).read(root, tree);
  const problems = [];
  for (const [story, { edges = [] }] of Object.entries(survey)) {
    for (const edge of edges) {
      if (!edge.typeOnly || edge.story === "library") continue;
      for (const file of edge.files) {
        const from = path.posix.join("packages", story, file.from);
        const to = file.to === undefined ? `packages/${edge.story}` : path.posix.join("packages", edge.story, file.to);
        problems.push(`${from} imports, type-only, a name ${to} defines: declare the fields you read in ${story}'s own package or, for a shape several stories read, move it into the library (ADR-1017 D2)`);
      }
    }
  }
  return problems.sort();
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = await typeImportProblems(fileURLToPath(new URL("../../..", import.meta.url)));
  if (problems.length > 0) {
    console.error(`A type-only import ends at a story other than the library:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
    process.exitCode = 1;
  } else console.log("every type-only import between stories ends at the library");
}
