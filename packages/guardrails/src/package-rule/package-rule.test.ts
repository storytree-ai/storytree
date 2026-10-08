/**
 * Capability 1 · The package rule (the Guardrails story): each planted tree below starts from a checkout
 * that keeps the rule and breaks one part of it. The first trees declare storytree's own frame and front
 * door, as its dev loop does; the last declares nothing, as a user's project does.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { packageProblems, type Declarations, type Edge } from "./package-rule.js";

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
const DECLARED: Declarations = {
  stories: ["app", "cli", "forest", "forest-world", "library"],
  frames: [{ story: "app", dirs: ["packages/app", "apps/desktop"] }, { story: "cli", dirs: ["packages/cli"], frontDoor: true }],
  notYetMoved: [],
  edges: { edges: [] },
};

test("the planted trees start from one that keeps the rules", (t: TestContext) => {
  assert.deepEqual(packageProblems(plant(t, {}), DECLARED), []);
});

test("1.1 · a story with no package is refused, and so is a package that belongs to no story", (t: TestContext) => {
  const problems = packageProblems(plant(t, { "packages/helpers/package.json": pkg("helpers") }), {
    ...DECLARED,
    stories: [...(DECLARED.stories ?? []), "knowledge-core"],
  });
  assert.equal(problems.length, 2, problems.join("\n"));
  assert.match(problems.join("\n"), /knowledge-core.*no package/);
  assert.match(problems.join("\n"), /packages\/helpers.*neither/);
});

test("1.1 · a project that declares no stories has one per package under packages/, and a package anywhere else belongs to none", (t: TestContext) => {
  const shop = { "packages/cart/package.json": JSON.stringify({ name: "cart" }), "packages/browsing/package.json": JSON.stringify({ name: "@shop/browsing" }) };
  const kept = mkdtempSync(path.join(tmpdir(), "boundaries-"));
  t.after(() => rmSync(kept, { recursive: true, force: true }));
  for (const [file, text] of Object.entries({ ...shop, "apps/web/package.json": JSON.stringify({ name: "web" }) })) {
    mkdirSync(path.dirname(path.join(kept, file)), { recursive: true });
    writeFileSync(path.join(kept, file), text);
  }
  const problems = packageProblems(kept);
  assert.equal(problems.length, 1, problems.join("\n"));
  assert.match(problems[0]!, /apps\/web.*belongs to a story/);
});

test("1.1 · a package.json saved with a byte-order mark, as Windows editors write it, is read like any other", (t: TestContext) => {
  const at = mkdtempSync(path.join(tmpdir(), "boundaries-"));
  t.after(() => rmSync(at, { recursive: true, force: true }));
  for (const [file, text] of Object.entries({ "packages/cart/package.json": `\uFEFF${JSON.stringify({ name: "cart", devDependencies: { checkout: "*" } })}`, "packages/checkout/package.json": JSON.stringify({ name: "checkout", dependencies: { cart: "*" } }) })) {
    mkdirSync(path.dirname(path.join(at, file)), { recursive: true });
    writeFileSync(path.join(at, file), text);
  }
  const problems = packageProblems(at);
  assert.equal(problems.length, 1, problems.join("\n"));
  assert.match(problems[0]!, /cart → checkout → cart/);
});

test("1.2 · a story's code in the frame or the front door is refused", (t: TestContext) => {
  const problems = packageProblems(
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

// increment_5c95db0bb297: the frame tests its own mounting of a story under that story's name.
test("1.2 · a frame test of mounting a story may carry the story's name, when it reaches the story through its package", (t: TestContext) => {
  const problems = packageProblems(
    plant(t, {
      "apps/desktop/src/forest/forest.test.ts": 'import { forestScene } from "@storytree/forest";\nimport { mount } from "@storytree/app";\n',
      "apps/desktop/src/library/library.test.ts": 'import { mount } from "@storytree/app";\n',
    }),
    DECLARED,
  );
  assert.equal(problems.length, 1, problems.join("\n"));
  assert.match(problems[0]!, /apps\/desktop\/src\/library\/library\.test\.ts.*library/);
});

test("1.2 · a refused file that leans on the frame is never told to move into the story's package, which would make the story depend on the frame", (t: TestContext) => {
  const problems = packageProblems(
    plant(t, {
      "apps/desktop/src/forest/panel.ts": 'import { mount } from "@storytree/app";\n',
      "packages/app/src/forest/glue.ts": 'import { start } from "../lifecycle/start.js";\n',
    }),
    DECLARED,
  );
  assert.equal(problems.length, 2, problems.join("\n"));
  for (const problem of problems) {
    assert.match(problem, /forest/);
    assert.doesNotMatch(problem, /move it into packages\/forest/);
    assert.match(problem, /ADR-0847/);
  }
});

test("1.2 · story code the frame still holds passes only while it is declared, and its declaration only while it is there", (t: TestContext) => {
  const declared: Declarations = { ...DECLARED, notYetMoved: [{ path: "apps/desktop/src/forest", question: "oq-move-it" }] };
  assert.deepEqual(packageProblems(plant(t, { "apps/desktop/src/forest/story-panel.ts": "" }), declared), []);
  const stale = packageProblems(plant(t, {}), declared);
  assert.equal(stale.length, 1, stale.join("\n"));
  assert.match(stale[0]!, /apps\/desktop\/src\/forest.*oq-move-it/);
});

test("1.3 · a package reaching into another story's files is refused, by relative path or by a subpath it does not export", (t: TestContext) => {
  const problems = packageProblems(
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

test("1.4 · packages that depend on each other, even for development only, are refused: pnpm links them into a loop", (t: TestContext) => {
  // On Windows each workspace link is a directory junction, which git walks as a folder, so a
  // cycle makes `git clean` recurse without end and a desktop session's start never finishes.
  const problems = packageProblems(
    plant(t, {
      "packages/forest/package.json": pkg("forest", undefined, { dependencies: { "@storytree/forest-world": "workspace:*" } }),
      "packages/forest-world/package.json": pkg("forest-world", undefined, { devDependencies: { "@storytree/forest": "workspace:*" } }),
      "packages/library/package.json": pkg("library", { ".": "./src/index.ts", "./readings": "./src/readings.ts" }, { dependencies: { "@storytree/forest": "workspace:*" } }),
    }),
    DECLARED,
  );
  assert.equal(problems.length, 1, problems.join("\n"));
  assert.match(problems[0]!, /@storytree\/forest → @storytree\/forest-world → @storytree\/forest/);
});

for (const size of [4, 5, 6]) {
  for (const cyclicTail of [false, true]) {
    test(`1.4 · a ${size}-package forward DAG is checked without enumerating its paths${cyclicTail ? ", even when they lead to a cycle" : ""}`, (t: TestContext) => {
      const names = Array.from({ length: size }, (_, i) => `dag-${i}`);
      const files = Object.fromEntries(names.map((name, i) => [
        `packages/${name}/package.json`,
        pkg(name, undefined, { dependencies: Object.fromEntries(names.slice(i + 1).map((next) => [`@storytree/${next}`, "workspace:*"])) }),
      ]));
      if (cyclicTail) files[`packages/${names.at(-1)}/package.json`] = pkg(names.at(-1)!, undefined, { peerDependencies: { [`@storytree/${names.at(-1)}`]: "workspace:*" } });
      const root = plant(t, files);
      // Count dependency-list reads in the real checker, not elapsed time or a copied walker.
      // Fixture names keep other maps used while reading the checkout out of the count.
      const get = Map.prototype.get;
      let reads = 0;
      const probe = t.mock.method(Map.prototype, "get", function (this: Map<unknown, unknown>, key: unknown): unknown {
        const value = get.call(this, key);
        if (typeof key === "string" && key.startsWith("@storytree/dag-") && Array.isArray(value)) reads++;
        return value;
      });
      let problems: string[];
      try { problems = packageProblems(root, { frames: DECLARED.frames ?? [] }); }
      finally { probe.mock.restore(); }
      assert.equal(problems.length, cyclicTail ? 1 : 0, problems.join("\n"));
      if (cyclicTail) assert.ok(problems[0]!.includes(`@storytree/${names.at(-1)} → @storytree/${names.at(-1)}`));
      const edges = size * (size - 1) / 2 + Number(cyclicTail);
      assert.ok(reads <= 2 * size + edges, `${reads} dependency-list reads for ${size} packages and ${edges} edges`);
    });
  }
}

test("1.4 · a diamond is acyclic and overlapping cycles, downstream cycles and self-loops are each reported once", (t: TestContext) => {
  const graph = (edges: Record<string, string[]>): Record<string, string> => Object.fromEntries(Object.entries(edges).map(([name, tos]) => [
    `packages/${name}/package.json`,
    pkg(name, undefined, { optionalDependencies: Object.fromEntries(tos.map((to) => [`@storytree/${to}`, "workspace:*"])) }),
  ]));
  assert.deepEqual(packageProblems(plant(t, graph({ a: ["b", "c"], b: ["d"], c: ["d"], d: [] })), { frames: DECLARED.frames ?? [] }), []);
  const problems = packageProblems(plant(t, graph({
    a: ["b", "c"], b: ["a", "c"], c: ["a", "b", "d", "f"], d: ["e"], e: ["d"], f: [], loop: ["loop"],
  })), { frames: DECLARED.frames ?? [] });
  assert.deepEqual(problems.map((problem) => problem.match(/in a cycle: (.*); a workspace/)?.[1]).sort(), [
    "a → b → a", "a → b → c → a", "a → c → a", "a → c → b → a", "b → c → b", "d → e → d", "loop → loop",
  ].map((cycle) => cycle.split(" → ").map((name) => `@storytree/${name}`).join(" → ")).sort());
});

test("1.5 · a story depending on the frame or the front door is refused, naming the edge, unless the owner sanctioned it; any other one-way edge needs no listing", (t: TestContext) => {
  const root = plant(t, {
    "packages/forest/package.json": pkg("forest", undefined, { dependencies: { "@storytree/forest-world": "workspace:*" }, devDependencies: { "@storytree/app": "workspace:*" } }),
    "packages/library/package.json": pkg("library", { ".": "./src/index.ts", "./readings": "./src/readings.ts" }, { peerDependencies: { "@storytree/cli": "workspace:*" } }),
    "packages/cli/package.json": pkg("cli", undefined, { dependencies: { "@storytree/app": "workspace:*", "@storytree/forest": "workspace:*" } }),
  });
  const problems = packageProblems(root, { ...DECLARED, edges: { edges: [] } });
  assert.equal(problems.length, 2, problems.join("\n"));
  assert.match(problems.join("\n"), /@storytree\/forest → @storytree\/app.*question/);
  assert.match(problems.join("\n"), /@storytree\/library → @storytree\/cli.*question/);

  const sanctioned = [{ from: "@storytree/forest", to: "@storytree/app", said: "the forest may lean on the frame here", on: "2026-10-02" }];
  const left = packageProblems(root, { ...DECLARED, edges: { edges: sanctioned } });
  assert.equal(left.length, 1, left.join("\n"));
  assert.match(left[0]!, /@storytree\/library → @storytree\/cli/);
});

test("1.5 · an edge-list entry no package.json uses any more is reported", (t: TestContext) => {
  const edges: Edge[] = [{ from: "@storytree/forest", to: "@storytree/library", said: null, on: null }];
  const problems = packageProblems(plant(t, {}), { ...DECLARED, edges: { edges } });
  assert.equal(problems.length, 1, problems.join("\n"));
  assert.match(problems[0]!, /@storytree\/forest → @storytree\/library.*no package\.json/);
});

function pkg(name: string, exports: Record<string, string> | undefined = { ".": "./src/index.ts" }, fields: Record<string, unknown> = {}): string {
  return JSON.stringify({ name: `@storytree/${name}`, exports, ...fields });
}

/** A temporary copy of KEPT with `files` added over it, removed when the test ends. */
function plant(t: TestContext, files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "boundaries-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [file, text] of Object.entries({ ...KEPT, ...files })) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  }
  return dir;
}
