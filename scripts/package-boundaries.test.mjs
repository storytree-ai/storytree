// Each story keeps its code in its own package (ADR-0649 D1-D3, in storytree 0.2's decision log):
// a story has a package, the frame (packages/app, apps/desktop) and the front door (packages/cli)
// hold no story's code, and no package reaches into another story's files. The rules live in
// scripts/package-boundaries.mjs; this file is how `pnpm test` and CI refuse a change that breaks
// them. Each planted tree below starts from a repo that keeps the rules and breaks one.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { boundaryProblems } from "./package-boundaries.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

test("this repo keeps every story in its own package, behind a thin frame and front door", () => {
  assert.deepEqual(boundaryProblems(root), []);
});

// Five stories (declared: the stories live in the library, which CI cannot read), their packages, the frame and the front door, all within bounds.
const KEPT = {
  "packages/app/package.json": pkg("app"),
  "packages/app/src/lifecycle/start.ts": 'import { connect } from "@storytree/library";\n',
  "apps/desktop/package.json": pkg("desktop"),
  "apps/desktop/src/renderer/renderer.ts": 'import { forestScene } from "@storytree/forest";\n',
  "packages/cli/package.json": pkg("cli"),
  "packages/cli/src/families/library.ts": 'import { connect } from "@storytree/library";\n',
  "packages/forest/package.json": pkg("forest"),
  "packages/forest/src/index.ts": 'import { arc } from "@storytree/library/readings";\nimport { coast } from "@storytree/forest-world";\n',
  "packages/library/package.json": pkg("library", { ".": "./src/index.ts", "./readings": "./src/readings.ts" }),
  "packages/library/src/index.ts": "",
  "packages/forest-world/package.json": pkg("forest-world"),
  "packages/forest-world/src/coast.ts": "",
};
const DECLARED = { stories: ["app", "cli", "forest", "forest-world", "library"], notYetMoved: [] };

test("the planted trees start from one that keeps the rules", (t) => {
  assert.deepEqual(boundaryProblems(plant(t, {}), DECLARED), []);
});

test("a story with no package is refused, and so is a package that belongs to no story", (t) => {
  const problems = boundaryProblems(plant(t, { "packages/helpers/package.json": pkg("helpers") }), {
    ...DECLARED,
    stories: [...DECLARED.stories, "knowledge-core"],
  });
  assert.equal(problems.length, 2, problems.join("\n"));
  assert.match(problems.join("\n"), /knowledge-core.*no package/);
  assert.match(problems.join("\n"), /packages\/helpers.*neither/);
});

test("a story's code in the frame or the front door is refused", (t) => {
  const problems = boundaryProblems(
    plant(t, {
      "apps/desktop/src/forest/story-panel.ts": "",
      "packages/app/src/surfaces/libraryShelves.ts": "",
      "packages/cli/src/forest/scene.ts": "",
    }),
    DECLARED,
  );
  assert.equal(problems.length, 3, problems.join("\n"));
  assert.match(problems.join("\n"), /apps\/desktop\/src\/forest\/story-panel\.ts.*forest/);
  assert.match(problems.join("\n"), /packages\/app\/src\/surfaces\/libraryShelves\.ts.*library/);
  assert.match(problems.join("\n"), /packages\/cli\/src\/forest\/scene\.ts.*forest/);
});

test("story code the frame still holds passes only while it is declared, and its declaration only while it is there", (t) => {
  const declared = { ...DECLARED, notYetMoved: [{ path: "apps/desktop/src/forest", question: "oq-move-it" }] };
  assert.deepEqual(boundaryProblems(plant(t, { "apps/desktop/src/forest/story-panel.ts": "" }), declared), []);
  const stale = boundaryProblems(plant(t, {}), declared);
  assert.equal(stale.length, 1, stale.join("\n"));
  assert.match(stale[0], /apps\/desktop\/src\/forest.*oq-move-it/);
});

test("a package reaching into another story's files is refused, by relative path or by a subpath it does not export", (t) => {
  const problems = boundaryProblems(
    plant(t, {
      "packages/forest/src/drawn.ts": 'import { schema } from "../../library/src/schema.js";\n',
      "packages/cli/src/families/forest.ts": 'const { inner } = await import("@storytree/library/src/inner.ts");\n',
    }),
    DECLARED,
  );
  assert.equal(problems.length, 2, problems.join("\n"));
  assert.match(problems.join("\n"), /packages\/forest\/src\/drawn\.ts.*\.\.\/\.\.\/library\/src\/schema\.js/);
  assert.match(problems.join("\n"), /packages\/cli\/src\/families\/forest\.ts.*@storytree\/library\/src\/inner\.ts/);
});

test("packages that depend on each other, even for development only, are refused: pnpm links them into a loop", (t) => {
  // On Windows each workspace link is a directory junction, which git walks as a folder, so a
  // cycle makes `git clean` recurse without end and a desktop session's start never finishes.
  const problems = boundaryProblems(
    plant(t, {
      "packages/forest/package.json": pkg("forest", undefined, { dependencies: { "@storytree/forest-world": "workspace:*" } }),
      "packages/forest-world/package.json": pkg("forest-world", undefined, { devDependencies: { "@storytree/forest": "workspace:*" } }),
      "packages/library/package.json": pkg("library", { ".": "./src/index.ts", "./readings": "./src/readings.ts" }, { dependencies: { "@storytree/forest": "workspace:*" } }),
    }),
    DECLARED,
  );
  assert.equal(problems.length, 1, problems.join("\n"));
  assert.match(problems[0], /@storytree\/forest → @storytree\/forest-world → @storytree\/forest/);
});

function pkg(name, exports = { ".": "./src/index.ts" }, fields = {}) {
  return JSON.stringify({ name: `@storytree/${name}`, exports, ...fields });
}

/** A temporary copy of KEPT with `files` added over it, removed when the test ends. */
function plant(t, files) {
  const dir = mkdtempSync(path.join(tmpdir(), "boundaries-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [file, text] of Object.entries({ ...KEPT, ...files })) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  }
  return dir;
}
