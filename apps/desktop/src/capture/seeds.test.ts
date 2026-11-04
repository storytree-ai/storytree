import assert from "node:assert/strict";
import { test } from "node:test";

import { captureSeed, seedFile } from "./index.js";

test("2.10 · a capture names a seed story's file by the package the seed's own title gives, so a later rename of the live package cannot desync it", () => {
  const frozen = { tree: { stories: [{ id: "story_link", title: "The agent link" }] } };
  const renamed = { tree: { stories: [{ id: "story_link", title: "The agent bridge" }] } };
  // A story's file is named by the package its title gives, in either seed.
  for (const [seed, pkg] of [[frozen, "agent-link"], [renamed, "agent-bridge"]] as const) {
    const title = seed.tree.stories[0]!.title;
    assert.equal(seedFile(seed, "story_link", "src/claims/merges.ts"), `packages/${pkg}/src/claims/merges.ts`);
    assert.equal(seedFile(seed, title, "src/claims/merges.ts"), `packages/${pkg}/src/claims/merges.ts`);
  }
  assert.throws(() => seedFile(frozen, "The forest", "src/a.ts"), /no story The forest.*The agent link/);
  // The shared code-rows seed names a story's file by the package its title gives.
  const { seed } = captureSeed("code-rows");
  assert.equal(seedFile(seed, "The command line", "src/args.ts"), "packages/cli/src/args.ts");
  assert.ok(captureSeed("forest").seed.tree.stories.some(story => story.title === "The forest"));
});
