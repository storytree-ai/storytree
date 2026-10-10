import assert from "node:assert/strict";
import { test } from "node:test";

import { codeKey, codePathKey } from "@storytree/knowledge-core";
import { packageOf } from "@storytree/map";

import { captureSeed, seedFile } from "./index.js";

test("2.10 · a capture names a seed story's file by the package the seed's own title gives, so a later rename of the live package cannot desync it", () => {
  const frozen = { tree: { stories: [{ id: "story_link", title: "The agent link" }] } };
  const renamed = { tree: { stories: [{ id: "story_link", title: "The agent bridge" }] } };
  // The globe keys a story's file by the package its title names; the capture's path must land on that key in either seed.
  for (const [seed, pkg] of [[frozen, "agent-link"], [renamed, "agent-bridge"]] as const) {
    const title = seed.tree.stories[0]!.title;
    assert.equal(seedFile(seed, "story_link", "src/claims/merges.ts"), `packages/${pkg}/src/claims/merges.ts`);
    assert.equal(seedFile(seed, title, "src/claims/merges.ts"), `packages/${pkg}/src/claims/merges.ts`);
    assert.equal(codeKey(seedFile(seed, "story_link", "src/claims/merges.ts")), codePathKey(pkg, "src/claims/merges.ts"));
  }
  assert.throws(() => seedFile(frozen, "The forest", "src/a.ts"), /no story The forest.*The agent link/);
  // The shared code-rows seed: every surveyed file in a story's package resolves to the key the globe draws it under.
  const { seed, survey } = captureSeed("code-rows");
  let checked = 0;
  for (const story of seed.tree.stories) {
    for (const file of (survey?.[story.id]?.files ?? []).filter(one => one.path.startsWith("src/"))) {
      assert.equal(codeKey(seedFile(seed, story.id, file.path)), codePathKey(packageOf(story.title), file.path));
      checked += 1;
    }
  }
  assert.ok(checked > 100, `${checked} surveyed files checked`);
  assert.equal(seedFile(seed, "The command line", "src/args.ts"), "packages/cli/src/args.ts");
  assert.ok(captureSeed("forest").seed.tree.stories.some(story => story.title === "The forest"));
});
