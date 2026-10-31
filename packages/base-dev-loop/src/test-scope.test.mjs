// What `pnpm test` runs by default (test-scope.mjs, ADR-0649 D4): only the packages a
// branch's changes can reach. The changes are the branch against where it left main
// (merge-base(origin/main, HEAD)) plus the working tree, untracked files included. Each changed file
// maps to the workspace package that holds it, and every package that depends on one of those is
// added, by a declared dependency or by a path in its code that reaches into the other package. Any
// file the workspace graph cannot account for runs everything: root files, any package.json, the
// lockfile, a file in no package, a package the test harness itself runs on (the dev loop among them), and an
// origin/main that cannot be read. The decision is printed as one `scope:` line, CI takes the same
// one, and a run reports each package as PASS or FAIL and can rerun only the failures.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { removeTemp } from "@storytree/test-waits";

import {
  changedFiles,
  classify,
  parseTestArgs,
  planRun,
  readWorkspace,
  resultsTable,
  scopeFor,
  scopeLine,
  unitGlobs,
} from "./test-scope.mjs";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

/** A workspace on disk: `packages` maps a dir to its manifest and any files it holds. */
function workspace(t, { rootDeps = {}, packages }) {
  const root = mkdtempSync(path.join(tmpdir(), "test-scope-"));
  t.after(() => removeTemp(root));
  write(root, "package.json", JSON.stringify({ name: "root", private: true, devDependencies: rootDeps }));
  for (const [dir, { name, deps = [], files = {} }] of Object.entries(packages)) {
    const dependencies = Object.fromEntries(deps.map((dep) => [dep, "workspace:*"]));
    write(root, `${dir}/package.json`, JSON.stringify({ name, dependencies }));
    for (const [file, text] of Object.entries(files)) write(root, `${dir}/${file}`, text);
  }
  return root;
}

function write(root, file, text) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
}

function git(root, ...args) {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

/** library <- agent-link <- cli, library <- forest, and a package the root harness runs on. */
function fixture(t) {
  return workspace(t, {
    rootDeps: { "@x/pg": "workspace:*" },
    packages: {
      "packages/library": { name: "@x/library", files: { "src/a.test.ts": "" } },
      "packages/agent-link": { name: "@x/agent-link", deps: ["@x/library"], files: { "src/b.test.ts": "" } },
      "packages/cli": { name: "@x/cli", deps: ["@x/agent-link"], files: { "src/c.test.ts": "" } },
      "packages/forest": { name: "@x/forest", deps: ["@x/library"], files: { "src/d.test.ts": "" } },
      "packages/pg": { name: "@x/pg", files: { "src/e.test.ts": "" } },
      "apps/desktop": { name: "@x/desktop", deps: ["@x/forest"], files: { "src/f.test.ts": "" } },
    },
  });
}

test("2.1 a change inside a package runs that package and every package that depends on it, and no other", (t) => {
  const ws = readWorkspace(fixture(t));
  const decision = classify(["packages/agent-link/src/x.ts"], ws);
  assert.equal(decision.mode, "affected");
  assert.deepEqual(decision.dirs, ["packages/agent-link", "packages/cli"]);

  const deeper = classify(["packages/forest/src/y.ts", "packages/cli/src/z.ts"], ws);
  assert.deepEqual(deeper.dirs, ["apps/desktop", "packages/cli", "packages/forest"], "dependents are followed all the way up");
});

test("a package whose code reaches into another by a relative path depends on it, declared or not", (t) => {
  const root = workspace(t, {
    packages: {
      "packages/world": { name: "@x/world", files: { "src/coast.ts": "" } },
      "packages/forest": {
        name: "@x/forest",
        files: { "src/places.test.ts": 'import { coast } from "../../world/src/coast.js";\n' },
      },
      "packages/other": { name: "@x/other", files: { "src/o.ts": 'const up = "../src/o.ts";\n' } },
    },
  });
  const decision = classify(["packages/world/src/coast.ts"], readWorkspace(root));
  assert.deepEqual(decision.dirs, ["packages/forest", "packages/world"]);
});

test("2.1 an evidence script no test runs reaches no package; one a test names, or one it imports, still does", (t) => {
  const root = workspace(t, {
    packages: {
      "packages/website": { name: "@x/website", files: { "src/site.ts": "" } },
      "packages/world": {
        name: "@x/world",
        files: {
          "src/w.test.ts": '/** A comment\'s ** names nothing. */\nrun(globSync("evidence/*/build.mjs"));\n',
          "evidence/tour/unrun-tour.mjs": 'const site = "../../../website/src/site.ts";\n',
        },
      },
      "packages/forest": {
        name: "@x/forest",
        files: {
          "src/f.test.ts": 'run("packages/forest/evidence/look/build.mjs");\n',
          "evidence/look/build.mjs": 'import "./page.js";\n',
          "evidence/look/page.tsx": 'import "../../../website/src/site.ts";\n',
        },
      },
      "packages/shop": {
        name: "@x/shop",
        files: {
          "src/s.test.ts": 'const folder = "./evidence/named-folder";\n',
          "src/evidence/named-folder/probe.mjs": 'const site = "../../../../website/src/site.ts";\n',
        },
      },
    },
  });
  const decision = classify(["packages/website/src/site.ts"], readWorkspace(root));
  assert.deepEqual(decision.dirs, ["packages/forest", "packages/shop", "packages/website"]);
});

test("2.1 a path named only in a comment is no read: rewording the comment moves no package in or out of scope", (t) => {
  const root = workspace(t, {
    packages: {
      "packages/website": { name: "@x/website", files: { "src/site.ts": "" } },
      "packages/arc": {
        name: "@x/arc",
        files: {
          "src/in/a.test.ts": '// Measured in Chromium (evidence/drawer).\n/* or "../../../website/src/site.ts" */\nconst url = "https://x.test/a"; // "../../../website/src/site.ts"\nconst glob = "src/**/*.ts";\n',
          "evidence/drawer/capture.mjs": 'import "../../../website/src/site.ts";\n',
        },
      },
      "packages/shop": { name: "@x/shop", files: { "src/s.test.ts": 'run("evidence/look/build.mjs"); // nothing more\n', "evidence/look/build.mjs": 'import "../../../website/src/site.ts";\n' } },
    },
  });
  const ws = readWorkspace(root);
  assert.deepEqual(ws.find((p) => p.dir === "packages/arc").reaches, []);
  assert.deepEqual(classify(["packages/website/src/site.ts"], ws).dirs, ["packages/shop", "packages/website"]);
});

test("2.1 a comment is told from what only looks like one: a // in a string or template is code, a comment after a regular expression or a template's ${} is not", (t) => {
  const site = (name) => `"../../../website/src/${name}.ts"`;
  const reads = ["a", "b", "c"];
  const root = workspace(t, {
    packages: {
      "packages/website": { name: "@x/website", files: Object.fromEntries(reads.map((name) => [`src/${name}.ts`, ""])) },
      "packages/arc": {
        name: "@x/arc",
        files: {
          "src/in/a.test.ts": [
            `const t = \`a\${b /* ${site("a")} */}c\`;`,
            `const r = /a/; // ${site("a")}`,
            String.raw`const w = /a\/\/b/; // ` + site("a"),
            `const k = /[/]x/; // ${site("a")}`,
            `const s = /[/]/// ${site("a")}`,
            "if (t) {}",
            `// ${site("a")}`,
          ].join("\n"),
        },
      },
      "packages/kit": {
        name: "@x/kit",
        files: {
          "src/in/a.test.ts": `const u = \`http://x\`, at = ${site("a")};\n`,
          "src/in/b.test.ts": String.raw`const e = ` + "`a\\`//b`" + `, at = ${site("b")};\n`,
          "src/in/c.test.ts": `const v = "http://x", at = ${site("c")};\n`,
        },
      },
    },
  });
  const ws = readWorkspace(root);
  assert.deepEqual(ws.find((p) => p.dir === "packages/arc").reaches, []);
  assert.deepEqual(ws.find((p) => p.dir === "packages/kit").through.files, reads.map((name) => `packages/website/src/${name}.ts`));
});

test("2.1 a glob naming no script, such as a git pathspec over every evidence folder, keeps no evidence script", (t) => {
  const root = workspace(t, {
    packages: {
      "packages/site": { name: "@x/site", files: { "src/site.ts": "" } },
      "packages/world": {
        name: "@x/world",
        files: {
          "src/sweep.mjs": 'git("ls-files", "--", ".", ":(exclude,glob)**/evidence/**");\nconst all = "evidence/*";\n',
          "evidence/tour/unrun-tour.mjs": 'const site = "../../../site/src/site.ts";\n',
          "evidence/top.mjs": 'const site = "../../site/src/site.ts";\n',
        },
      },
    },
  });
  const decision = classify(["packages/site/src/site.ts"], readWorkspace(root));
  assert.deepEqual(decision.dirs, ["packages/site"]);
});

test("2.1 a path into another package's file depends only on that file and what it imports; a folder or a file not in the checkout, on the whole package", (t) => {
  const root = workspace(t, {
    packages: {
      "packages/website": { name: "@x/website", files: { "src/site.ts": "" } },
      "packages/library": { name: "@x/library", files: { "src/l.ts": "" } },
      "apps/frame": {
        name: "@x/frame",
        deps: ["@x/website"],
        files: {
          "src/main.ts": 'import "@x/website";\n',
          "src/capture/index.ts": 'export * from "./output.js";\n',
          "src/capture/output.ts": 'import { read } from "@x/library/read";\n',
        },
      },
      "packages/forest": { name: "@x/forest", files: { "evidence/look/build.mjs": 'import "../../../../apps/frame/src/capture/index.ts";\n', "src/f.test.ts": 'run("evidence/look/build.mjs");\n' } },
      "packages/arc": { name: "@x/arc", files: { "src/a.test.ts": 'const dist = "../../../apps/frame/dist/renderer";\n' } },
      "packages/shop": { name: "@x/shop", files: { "src/s.test.ts": 'const folder = "../../../apps/frame/src";\n' } },
    },
  });
  const ws = readWorkspace(root);
  assert.deepEqual(classify(["packages/website/src/site.ts"], ws).dirs, ["apps/frame", "packages/arc", "packages/shop", "packages/website"]);
  assert.deepEqual(classify(["apps/frame/src/main.ts"], ws).dirs, ["apps/frame", "packages/arc", "packages/shop"]);
  assert.deepEqual(classify(["apps/frame/src/capture/output.ts"], ws).dirs, ["apps/frame", "packages/arc", "packages/forest", "packages/shop"]);
  assert.deepEqual(classify(["packages/library/src/l.ts"], ws).dirs, ["packages/forest", "packages/library", "packages/shop"], "a package the reached file imports by name is followed");
});

test("2.1 a path into desktop's renderer, or its build output, depends on desktop's files it imports by path, not on the stories it mounts; a folder, on what under it something runs", (t) => {
  // Each test file sits a folder deep, so its paths climb out of this checkout when this file itself is scoped.
  const root = workspace(t, {
    packages: {
      "packages/site": { name: "@x/site", files: { "src/site.ts": "" } },
      "apps/desktop": {
        name: "@x/desktop",
        deps: ["@x/site"],
        files: {
          "src/renderer/renderer.ts": 'import "@x/site";\nimport "./views.js";\n',
          "src/renderer/views.ts": "await import(url);\n",
          "src/capture/build.ts": 'const entry = path.join(root, "apps/desktop/src/renderer/renderer.ts");\n',
        },
      },
      "packages/forest": { name: "@x/forest", files: { "src/in/f.test.ts": 'const entry = "../../../../apps/desktop/src/renderer/renderer.ts";\n' } },
      "packages/arc": { name: "@x/arc", files: { "src/in/a.test.ts": 'const dist = "../../../../apps/desktop/dist/renderer";\n' } },
      "packages/kit": { name: "@x/kit", files: { "src/in/k.test.ts": 'import "../../../../apps/desktop/src/capture/build.ts";\n' } },
      "packages/views": { name: "@x/views", files: { "src/in/v.test.ts": 'import "../../../../apps/desktop/src/renderer/views.ts";\n' } },
      "packages/seeds": {
        name: "@x/seeds",
        files: { "src/s.test.ts": 'const data = "../../world/src/evidence";\n' },
      },
      "packages/world": { name: "@x/world", files: { "src/evidence/probe-site.mjs": 'const site = "../../../site/src/site.ts";\n' } },
    },
  });
  const ws = readWorkspace(root);
  assert.deepEqual(classify(["packages/site/src/site.ts"], ws).dirs, ["apps/desktop", "packages/site", "packages/views"], "views.ts reached directly is read in full: its computed import reaches all of desktop");
  assert.deepEqual(classify(["apps/desktop/src/renderer/views.ts"], ws).dirs, ["apps/desktop", "packages/arc", "packages/forest", "packages/kit", "packages/views"]);
});

test("2.1 a type-only import is erased before a test runs, so a path reaching it depends on nothing through it; typecheck, which runs in full, reads it", (t) => {
  const root = workspace(t, {
    packages: {
      "packages/site": { name: "@x/site", files: { "src/site.ts": "" } },
      "packages/shop": { name: "@x/shop", files: { "src/shop.ts": "" } },
      "apps/desktop": {
        name: "@x/desktop",
        files: {
          "src/bridge.ts": 'import { CHANNELS } from "@x/site";\n',
          "src/capture/index.ts": 'import type { Bridge } from "../bridge.js";\nimport type {\n  Shop,\n} from "@x/shop";\nexport type { Bridge } from "../bridge.js";\n',
          "src/capture/live.ts": 'import { type Shop } from "@x/shop";\n',
        },
      },
      "packages/forest": { name: "@x/forest", files: { "src/in/f.test.ts": 'import "../../../../apps/desktop/src/capture/index.ts";\n' } },
      "packages/arc": { name: "@x/arc", files: { "src/in/a.test.ts": 'import "../../../../apps/desktop/src/capture/live.ts";\n' } },
    },
  });
  const ws = readWorkspace(root);
  assert.deepEqual(classify(["packages/site/src/site.ts"], ws).dirs, ["packages/site"]);
  assert.deepEqual(classify(["packages/shop/src/shop.ts"], ws).dirs, ["packages/arc", "packages/shop"], "an inline type specifier leaves the import in place");
  assert.deepEqual(classify(["apps/desktop/src/bridge.ts"], ws).dirs, ["apps/desktop"]);
});

test("2.1 a path to a folder whose code names no script under it reads its data, so it depends on the folder's files and not on what its scripts import", (t) => {
  const root = workspace(t, {
    packages: {
      "packages/site": { name: "@x/site", files: { "src/site.ts": "" } },
      "packages/forest": {
        name: "@x/forest",
        files: {
          "src/evidence/look/build.mjs": 'import "../../../../site/src/site.ts";\n',
          "src/evidence/look/seed.json": "{}",
          "src/look.test.ts": 'run("evidence/look/build.mjs");\n',
        },
      },
      "packages/seeds": { name: "@x/seeds", files: { "src/seeds.ts": 'const at = "../../forest/src/evidence";\nread(path.join(at, "look", "seed.json"));\n' } },
      "packages/runs": { name: "@x/runs", files: { "src/runs.test.ts": 'const at = "../../forest/src/evidence";\nfor (const dir of dirs) run(path.join(at, dir, "build.mjs"));\n' } },
    },
  });
  const ws = readWorkspace(root);
  assert.deepEqual(classify(["packages/site/src/site.ts"], ws).dirs, ["packages/forest", "packages/runs", "packages/site"]);
  assert.deepEqual(classify(["packages/forest/src/evidence/look/seed.json"], ws).dirs, ["packages/forest", "packages/runs", "packages/seeds"]);
});

test("2.1 the real workspace: a story whose captures reach desktop's capture kit runs on a change to the kit or its seeds, not on what the kit's types or forest's evidence scripts import", () => {
  const ws = readWorkspace(repoRoot);
  const scope = (file) => classify([file], ws).dirs;
  const users = ["packages/knowledge-core"];
  for (const file of ["apps/desktop/src/capture/index.ts", "packages/forest/testing/view/code-rows/seed.json.gz"]) {
    for (const dir of users) assert.ok(scope(file).includes(dir), `${file}: ${dir}`);
  }
  assert.deepEqual(scope("apps/desktop/src/bridge.ts"), ["apps/desktop"]);
  for (const dir of users) assert.ok(!scope("packages/forest-world/src/x.ts").includes(dir), dir);
  // The page's road worker, which the kit builds from the drawing engine, is bounded to desktop's files as the renderer is.
  for (const dir of users) assert.ok(scope("apps/desktop/src/renderer/road-worker.ts").includes(dir), dir);
  for (const dir of users) assert.ok(!scope("packages/forest-world/src/planet/road-worker.ts").includes(dir), dir);
});

test("2.1 the real workspace: a website-only change runs only website, since nothing depends on it, nor the packages whose captures and tests reach into desktop's files", () => {
  const decision = classify(["packages/website/src/site.ts"], readWorkspace(repoRoot));
  assert.deepEqual(decision.dirs, ["packages/website"]);
});

test("2.1 the real workspace: the capture scripts no test runs (forest-world's website-reveal, forest's probe-website) draw no edge into website", () => {
  const ws = readWorkspace(repoRoot);
  for (const dir of ["packages/forest", "packages/forest-world"]) assert.ok(!ws.find((p) => p.dir === dir).reaches.includes("packages/website"), dir);
});

test("the real workspace's undeclared reach is found: app-setup builds cli's bin by path", () => {
  const ws = readWorkspace(repoRoot);
  assert.ok(ws.find((p) => p.dir === "packages/app-setup").reaches.includes("packages/cli"));
  assert.ok(classify(["packages/cli/src/bins/storytree.ts"], ws).dirs.includes("packages/app-setup"));
});

test("2.2 a change in the dev loop runs everything: its runner, scoper and gate decide how every test runs (ADR-0805 D4)", () => {
  const decision = classify(["packages/dev-loop/src/gate.mjs"], readWorkspace(repoRoot));
  assert.equal(decision.mode, "full");
  assert.match(decision.reason, /@storytree\/dev-loop/);
});

test("2.2 any file the workspace graph cannot account for runs everything, and says which file", (t) => {
  const ws = readWorkspace(fixture(t));
  const wide = {
    "README.md": /README\.md/,
    "stories/library.md": /stories\/library\.md/,
    "pnpm-lock.yaml": /lockfile/,
    "pnpm-workspace.yaml": /pnpm-workspace\.yaml/,
    "package.json": /package\.json/,
    "packages/forest/package.json": /package\.json/,
    ".github/workflows/ci.yml": /ci\.yml/,
    "packages/README.md": /no workspace package/,
    "packages/gone/src/old.ts": /no workspace package/,
    "packages/pg/src/server.ts": /test harness/,
  };
  for (const [file, reason] of Object.entries(wide)) {
    const decision = classify(["packages/cli/src/z.ts", file], ws);
    assert.equal(decision.mode, "full", file);
    assert.match(decision.reason, reason, file);
  }
  assert.equal(classify([], ws).mode, "full", "no change at all runs everything rather than nothing");
});

test("the changes are the branch since it left main plus the working tree, untracked included", (t) => {
  const root = fixture(t);
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(root, "checkout", "-q", "-b", "work");
  write(root, "packages/cli/src/committed.ts", "1");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "on the branch");
  // main moves on after the branch left it: what main gained is not this branch's change
  git(root, "checkout", "-q", "main");
  write(root, "packages/library/src/on-main.ts", "1");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "main moves");
  git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(root, "checkout", "-q", "work");
  write(root, "packages/forest/src/d.test.ts", "edited, not staged");
  write(root, "apps/desktop/src/new.ts", "untracked");
  rmSync(path.join(root, "packages/pg/src/e.test.ts"));

  assert.deepEqual(changedFiles(root).sort(), [
    "apps/desktop/src/new.ts",
    "packages/cli/src/committed.ts",
    "packages/forest/src/d.test.ts",
    "packages/pg/src/e.test.ts",
  ]);
  const decision = scopeFor(root);
  assert.equal(decision.mode, "full", "the deleted file is in a package the harness runs on");
});

test("2.2 an origin/main that cannot be read runs everything, saying so", (t) => {
  const root = fixture(t);
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  const decision = scopeFor(root);
  assert.equal(decision.mode, "full");
  assert.match(decision.reason, /origin\/main/);
});

test("the decision prints as one scope: line naming what runs and why", (t) => {
  const ws = readWorkspace(fixture(t));
  const affected = scopeLine(classify(["packages/agent-link/src/x.ts"], ws));
  assert.match(affected, /^scope: affected /);
  assert.ok(affected.includes("packages/agent-link") && affected.includes("packages/cli"), affected);
  assert.equal(affected.split("\n").length, 1);
  const full = scopeLine(classify(["pnpm-lock.yaml"], ws));
  assert.match(full, /^scope: full /);
  assert.match(full, /pnpm-lock\.yaml/);
});

test("a run is one unit per selected package with tests", (t) => {
  const root = fixture(t);
  const ws = readWorkspace(root);
  mkdirSync(path.join(root, "packages/empty/src"), { recursive: true });
  write(root, "packages/empty/package.json", JSON.stringify({ name: "@x/empty" }));
  const all = readWorkspace(root);

  const affected = planRun({ root, workspace: ws, decision: classify(["packages/agent-link/src/x.ts"], ws) });
  assert.deepEqual(affected.units, ["packages/agent-link", "packages/cli"]);

  const full = planRun({ root, workspace: all, decision: classify(["README.md"], all) });
  assert.deepEqual(full.units, [
    "apps/desktop",
    "packages/agent-link",
    "packages/cli",
    "packages/forest",
    "packages/library",
    "packages/pg",
  ], "a package with no test files is no unit");
});

test("a package whose tests are .test.mjs files is a unit, and its unit runs them", (t) => {
  const root = fixture(t);
  write(root, "packages/loop/package.json", JSON.stringify({ name: "@x/loop" }));
  write(root, "packages/loop/src/gate.test.mjs", "");
  const ws = readWorkspace(root);

  const all = planRun({ root, workspace: ws, decision: classify(["README.md"], ws) }).units;
  assert.ok(all.includes("packages/loop"), all.join(", "));
  assert.ok(unitGlobs("packages/loop").includes("packages/loop/src/**/*.test.mjs"));
});

test("1.3 a file named to run in every scoped run is carried only when the caller names it, and a full run has it in its package already", (t) => {
  const root = fixture(t);
  write(root, "packages/dev-loop/package.json", JSON.stringify({ name: "@x/dev-loop" }));
  write(root, "packages/dev-loop/src/package-boundaries.test.mjs", "");
  write(root, "packages/dev-loop/src/other.test.mjs", "");
  write(root, "packages/forest/src/view/desktop-renderer-smoke.test.ts", "");
  const ws = readWorkspace(root);
  const decision = classify(["packages/agent-link/src/x.ts"], ws);
  assert.deepEqual(planRun({ root, workspace: ws, decision }).units, ["packages/agent-link", "packages/cli"], "the base runner names no file of storytree's own");
  assert.deepEqual(planRun({ root, workspace: ws, decision: classify(["packages/forest/src/x.ts"], ws) }).units, ["apps/desktop", "packages/forest"], "nor runs one of storytree's alone");

  const alwaysRun = ["packages/dev-loop/src/package-boundaries.test.mjs", "packages/dev-loop/src/gone.test.mjs"];
  assert.deepEqual(planRun({ root, workspace: ws, decision, alwaysRun }).units, [
    "packages/agent-link",
    "packages/cli",
    "packages/dev-loop/src/package-boundaries.test.mjs",
  ], "a named file that is not there is left out");
  assert.deepEqual(unitGlobs("packages/dev-loop/src/package-boundaries.test.mjs"), ["packages/dev-loop/src/package-boundaries.test.mjs"]);
  const all = planRun({ root, workspace: ws, decision: classify(["README.md"], ws), alwaysRun }).units;
  assert.ok(all.includes("packages/dev-loop") && !all.includes("packages/dev-loop/src/package-boundaries.test.mjs"), "a full run has it in its package already");
});

test("1.3 the test runner runs in a repository that is not storytree's, at the root and with the lists its caller gives", (t) => {
  const root = workspace(t, { packages: { "packages/site": { name: "@w/site", files: { "src/site.ts": "", "src/site.test.mjs": "", "src/slow.test.mjs": "" } } } });
  write(root, "checks/layout.test.mjs", "");
  const runner = pathToFileURL(fileURLToPath(new URL("./test.mjs", import.meta.url))).href;
  write(root, "run.mjs", `import { testCommand } from ${JSON.stringify(runner)};
testCommand({ root: ${JSON.stringify(root)}, alwaysRun: ["checks/layout.test.mjs"], alone: ["packages/site/src/slow.test.mjs"] });
`);
  git(root, "init", "-q", "-b", "main");
  git(root, "add", ".");
  git(root, "commit", "-qm", "base");
  git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
  write(root, "packages/site/src/site.ts", "export {};\n");
  const home = mkdtempSync(path.join(tmpdir(), "test-elsewhere-"));
  t.after(() => removeTemp(home));
  const run = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), "run.mjs", "--scope"], { cwd: root, env: { ...process.env, STORYTREE_HOME: home }, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^units: packages\/site, checks\/layout\.test\.mjs, packages\/site\/src\/slow\.test\.mjs$/m, run.stdout);
});

test("2.6 a folder under infra/ that holds tests is a unit: a full run runs it, and --only names it", (t) => {
  const root = fixture(t);
  write(root, "infra/host/host.mjs", "");
  write(root, "infra/host/host.test.mjs", "");
  write(root, "infra/notes/README.md", "");
  const ws = readWorkspace(root);

  const decision = classify(["infra/host/host.mjs"], ws);
  assert.equal(decision.mode, "full", "an infra change still runs everything: package tests may read its files");
  const units = planRun({ root, workspace: ws, decision }).units;
  assert.ok(units.includes("infra/host"), units.join(", "));
  assert.ok(!units.includes("infra/notes"), "a folder with no tests is no unit");
  assert.deepEqual(unitGlobs("infra/host"), ["infra/host/**/*.test.ts", "infra/host/**/*.test.mjs"]);
  assert.deepEqual(planRun({ root, workspace: ws, decision, flags: { only: ["infra/host"] } }).units, ["infra/host"]);
  assert.ok(!planRun({ root, workspace: ws, decision: classify(["packages/agent-link/src/x.ts"], ws) }).units.includes("infra/host"), "a package-only change does not run it");
});

test("2.3 --full forces everything, --only names units, and --rerun-failed runs what the last run failed or never reached", (t) => {
  const root = fixture(t);
  const ws = readWorkspace(root);
  const decision = classify(["packages/agent-link/src/x.ts"], ws);

  const forced = planRun({ root, workspace: ws, decision, flags: { full: true } });
  assert.equal(forced.decision.mode, "full");
  assert.match(forced.decision.reason, /--full/);
  assert.equal(forced.units.length, 6);

  const only = planRun({ root, workspace: ws, decision, flags: { only: ["forest", "@x/cli"] } });
  assert.deepEqual(only.units, ["packages/cli", "packages/forest"]);
  assert.match(scopeLine(only.decision), /^scope: only /);
  assert.throws(() => planRun({ root, workspace: ws, decision, flags: { only: ["nope"] } }), /nope/);

  const record = { units: { "packages/cli": "fail", "packages/library": "pass", "packages/forest": "not run" } };
  const rerun = planRun({ root, workspace: ws, decision, flags: { rerunFailed: true }, record });
  assert.deepEqual(rerun.units, ["packages/cli", "packages/forest"]);
  assert.match(scopeLine(rerun.decision), /^scope: rerun-failed /);

  const nothing = planRun({ root, workspace: ws, decision, flags: { rerunFailed: true }, record: undefined });
  assert.deepEqual(nothing.units, []);
  assert.match(nothing.decision.reason, /no earlier run/);
});

test("2.3 --help prints the runner's usage, and an unknown flag is refused naming the known ones, before any lock or Postgres", (t) => {
  assert.equal(parseTestArgs(["--help"]).help, true);
  assert.equal(parseTestArgs(["-h"]).help, true);
  assert.match(parseTestArgs(["--bogus"]).refusal, /--bogus/);
  assert.match(parseTestArgs(["--bogus"]).refusal, /--full.*--scope.*--only.*--rerun-failed/s);
  const passed = parseTestArgs(["--", "--full", "--only=cli", "--test-name-pattern=x", "a.test.mjs"]);
  assert.equal(passed.refusal, undefined);
  assert.equal(passed.flags.full, true);
  assert.deepEqual(passed.flags.only, ["cli"]);
  assert.deepEqual(passed.testArgs, ["--test-name-pattern=x", "a.test.mjs"]);

  const home = mkdtempSync(path.join(tmpdir(), "test-help-"));
  t.after(() => removeTemp(home));
  const env = { ...process.env, STORYTREE_HOME: home };
  delete env.STORYTREE_HEAVY_LOCK_HOLDER; // this suite itself runs under the outer run's lock
  const run = (arg) => spawnSync(process.execPath, ["--import", "tsx", "packages/base-dev-loop/src/test.mjs", arg], { cwd: repoRoot, env, encoding: "utf8" });
  const help = run("--help");
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /pnpm run test --rerun-failed/);
  assert.doesNotMatch(help.stdout + help.stderr, /^scope:|test Postgres/m);
  const unknown = run("--bogus");
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /--bogus/);
  assert.doesNotMatch(unknown.stdout + unknown.stderr, /^scope:|test Postgres/m);
});

test("the results table shows each unit PASS, FAIL or NOT RUN, and how to rerun the failures", () => {
  const table = resultsTable({ "packages/cli": "pass", "packages/forest": "fail", "apps/desktop": "not run" });
  assert.match(table, /PASS\s+packages\/cli/);
  assert.match(table, /FAIL\s+packages\/forest/);
  assert.match(table, /NOT RUN\s+apps\/desktop/);
  assert.match(table, /pnpm run test --rerun-failed/);
  assert.doesNotMatch(resultsTable({ "packages/cli": "pass" }), /rerun-failed/, "nothing to rerun, no hint");
});

test("2.5 a file named to run alone is a unit of its own whenever its package runs, and its package's unit runs every other file", (t) => {
  const root = fixture(t);
  write(root, "packages/forest/src/view/proof.test.ts", "");
  write(root, "packages/forest/src/view/other.test.ts", "");
  write(root, "packages/forest/src/more.test.mjs", "");
  const ws = readWorkspace(root);
  const alone = ["packages/forest/src/view/proof.test.ts", "packages/cli/src/gone.test.ts"];

  const scoped = planRun({ root, workspace: ws, decision: classify(["packages/forest/src/x.ts"], ws), alone }).units;
  assert.deepEqual(scoped, ["apps/desktop", "packages/forest", "packages/forest/src/view/proof.test.ts"]);
  assert.ok(planRun({ root, workspace: ws, decision: classify(["README.md"], ws), alone }).units.includes("packages/forest/src/view/proof.test.ts"));
  assert.deepEqual(planRun({ root, workspace: ws, decision: classify(["README.md"], ws), flags: { only: ["forest"] }, alone }).units, ["packages/forest", "packages/forest/src/view/proof.test.ts"]);
  assert.ok(!planRun({ root, workspace: ws, decision: classify(["packages/agent-link/src/x.ts"], ws), alone }).units.some((unit) => unit.endsWith(".test.ts")), "not when its package does not run");

  assert.deepEqual(unitGlobs("packages/forest", { root, alone }).sort(), ["packages/forest/src/d.test.ts", "packages/forest/src/more.test.mjs", "packages/forest/src/view/other.test.ts"]);
  assert.deepEqual(unitGlobs("packages/forest/src/view/proof.test.ts", { root, alone }), ["packages/forest/src/view/proof.test.ts"]);
  assert.ok(unitGlobs("packages/library", { root, alone }).includes("packages/library/src/**/*.test.ts"), "a package with no file to run alone keeps its globs");
});
