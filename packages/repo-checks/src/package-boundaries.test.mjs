// Each story keeps its code in its own package (ADR-0649 D1-D3, in storytree 0.2's decision log):
// a story has a package, the frame (packages/app, apps/desktop) and the front door (packages/cli)
// hold no story's code, and no package reaches into another story's files. The rule lives in this
// package's capability 9 (src/rules/package-rule), with its planted trees; `pnpm lint` refuses a change to this
// repo that breaks it in the gate and CI; this file is contract 5.1's test, run with this package's tests.
// Contract 5.4: which packages are a story's comes from each package's own package.json ("story": "story_<12 hex>"),
// read from the checkout boundaryProblems is given, not from a hand-kept list.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { removeTemp } from "@storytree/test-waits";

import { boundaryProblems, STORIES } from "./package-boundaries.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));

test("5.1 · this repo keeps every story in its own package, behind a thin frame and front door", () => {
  assert.deepEqual(boundaryProblems(root), []);
});

/** A planted checkout: one packages/<folder>/package.json per entry, each the given manifest; removed after the test. */
function plant(t, manifests) {
  const dir = mkdtempSync(path.join(tmpdir(), "package-boundaries-"));
  t.after(() => removeTemp(dir));
  for (const [folder, manifest] of Object.entries(manifests)) {
    mkdirSync(path.join(dir, "packages", folder), { recursive: true });
    writeFileSync(path.join(dir, "packages", folder, "package.json"), JSON.stringify(manifest));
  }
  return dir;
}

const neither = (folder) => `packages/${folder} is neither a story's package nor the frame: every package belongs to a story (ADR-0805 D5)`;

test("5.4 · packages whose package.json names a story id are that story's: a checkout of two marked packages has no problem at all", (t) => {
  const planted = plant(t, {
    alpha: { name: "@planted/alpha", story: "story_0123456789ab" },
    zeta: { name: "@planted/zeta", story: "story_fedcba987654" },
  });
  assert.deepEqual(boundaryProblems(planted), []);
});

test("5.4 · a package naming no story, or a malformed one, is refused with the neither-a-story's-nor-the-frame sentence, and only it", (t) => {
  const planted = plant(t, {
    alpha: { name: "@planted/alpha", story: "story_0123456789ab" },
    bare: { name: "@planted/bare" },
    folder: { name: "@planted/folder", story: "agent-pool" },
    number: { name: "@planted/number", story: 123456789012 },
    nested: { name: "@planted/nested", storytree: { story: "story_0123456789cd" } },
    short: { name: "@planted/short", story: "story_0123456789a" },
    long: { name: "@planted/long", story: "story_0123456789abc" },
    prefixed: { name: "@planted/prefixed", story: "xstory_0123456789ef" },
    upper: { name: "@planted/upper", story: "story_ABCDEF012345" },
  });
  assert.deepEqual(
    [...boundaryProblems(planted)].sort(),
    ["bare", "folder", "long", "nested", "number", "prefixed", "short", "upper"].map(neither).sort(),
  );
});

test("5.4 · two packages naming the same story id are refused in one sentence naming both folders and the id", (t) => {
  const planted = plant(t, {
    alpha: { name: "@planted/alpha", story: "story_aaaaaaaaaaaa" },
    beta: { name: "@planted/beta", story: "story_aaaaaaaaaaaa" },
    gamma: { name: "@planted/gamma", story: "story_bbbbbbbbbbbb" },
  });
  const problems = boundaryProblems(planted);
  assert.equal(problems.length, 1, `one sentence for the shared story, got: ${JSON.stringify(problems)}`);
  assert.match(problems[0], /packages\/alpha\b/);
  assert.match(problems[0], /packages\/beta\b/);
  assert.match(problems[0], /story_aaaaaaaaaaaa/);
  assert.doesNotMatch(problems[0], /gamma|story_bbbbbbbbbbbb/);
});

test("5.4 · a checkout with no packages/ folder names no story and has no problem", (t) => {
  assert.deepEqual(boundaryProblems(plant(t, {})), []);
});

test("5.4 · STORIES is this repo's marked packages by folder name: every folder under packages/ with a package.json", () => {
  const folders = readdirSync(path.join(root, "packages"))
    .filter((name) => existsSync(path.join(root, "packages", name, "package.json")))
    .sort();
  assert.ok(folders.includes("repo-checks"));
  assert.deepEqual([...STORIES].sort(), folders);
});
