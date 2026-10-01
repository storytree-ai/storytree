// Whether the plan's edges between stories follow the code (ADR-0840 D2): a capability of story X may
// depend on a capability of story Y only when X's package depends on Y's, directly or through other
// workspace dependencies (every field of package.json counts, as in package-boundaries.mjs). The
// library holds the plan and CI cannot read it, so `pnpm gate` runs this as check:plan-edges.
//
// A story's package is named after its title, as the forest's code survey names it (packageOf in
// packages/forest/src/code-survey/code-survey.ts); the app story's code is the frame, packages/app and
// apps/desktop. A story with no package has no code edges, so nothing it plans is checked.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const NAMED_OTHERWISE = { "command-line": "cli", world: "forest-world", "local-database": "local-postgres", "process-ledger": "processes" };
const FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

/** The repo-relative folders holding a story's code, by its title. */
function packagesOf(title) {
  const name = title.replace(/^the\s+/i, "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const id = NAMED_OTHERWISE[name] ?? name;
  return id === "app" ? ["packages/app", "apps/desktop"] : [`packages/${id}`];
}

/** A package.json's name and what it depends on, or undefined when the folder has none. */
function manifestAt(root, dir) {
  const file = path.join(root, dir, "package.json");
  if (!existsSync(file)) return undefined;
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  return { name: manifest.name, deps: FIELDS.flatMap((field) => Object.keys(manifest[field] ?? {})) };
}

/**
 * What in `tree` (the library's projectTree(): stories, each with capabilities and their dependsOn)
 * runs against the code at `root`, one sentence each; empty when every edge follows it.
 */
export function planEdgeProblems(root, tree) {
  const manifests = new Map();
  for (const story of tree.stories) {
    const found = packagesOf(story.title).map((dir) => ({ dir, ...manifestAt(root, dir) })).filter((at) => at.name !== undefined);
    if (found.length > 0) manifests.set(story.id, found);
  }
  // Every story package by name; every workspace package is a story's (ADR-0805 D5), so following them reaches all.
  const byName = new Map();
  for (const found of manifests.values()) for (const at of found) byName.set(at.name, at);
  const reachFrom = (names) => {
    const seen = new Set();
    for (const stack = [...names]; stack.length > 0;) {
      const next = stack.pop();
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(...(byName.get(next)?.deps ?? []));
    }
    return seen;
  };

  const owner = new Map(tree.stories.flatMap((story) => story.capabilities.map((capability) => [capability.id, { story, capability }])));
  const problems = [];
  for (const story of tree.stories) {
    const own = manifests.get(story.id);
    if (own === undefined) continue;
    const reach = reachFrom(own.flatMap((at) => at.deps));
    for (const capability of story.capabilities) {
      for (const on of capability.dependsOn) {
        const other = owner.get(on);
        if (other === undefined || other.story.id === story.id) continue;
        const theirs = manifests.get(other.story.id);
        if (theirs === undefined || theirs.some((at) => reach.has(at.name))) continue;
        problems.push(
          `${story.title}'s "${capability.title}" depends on ${other.story.title}'s "${other.capability.title}", but ${own.map((at) => at.name).join(" and ")} does not depend on ${theirs.map((at) => at.name).join(" or ")}, directly or not: drop the plan edge, or raise a question for the code edge (ADR-0840 D2)`,
        );
      }
    }
  }
  return problems;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  const { withLibrary } = await import("./build-guidance.mjs");
  const problems = await withLibrary((library) => library.projectTree().then((tree) => planEdgeProblems(root, tree)), "pnpm check:plan-edges");
  if (problems === undefined) process.exitCode = 1;
  else if (problems.length > 0) {
    console.error(`The plan has edges between stories that run against the code:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
    process.exitCode = 1;
  } else console.log("every edge between stories in the plan follows the code");
}
