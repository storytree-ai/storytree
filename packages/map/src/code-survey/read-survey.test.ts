/**
 * Capability 8 · Code survey, read from disk: surveying the checkout again reads only the files that
 * changed since the last survey (ADR-0836 D2). Written against a small package in a temporary folder.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { AnnotatedTree } from "@storytree/library";

import { codeSurveyReader } from "./read-survey.js";

const tree = { arcs: [], stories: [{ id: "story-shop", title: "Shop", capabilities: [{ id: "cap-claims", title: "3 · Claims" }] }] } as unknown as AnnotatedTree;

test("8.1 a numbered test reaches its own package's public subpath through package.json exports", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "code-survey-self-"));
  try {
    const root = path.join(folder, "packages", "shop");
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "@x/shop", exports: { "./claim": "./src/claim.ts" } }));
    await writeFile(path.join(root, "src/claim.ts"), "export const claim = () => 1;\n");
    await writeFile(path.join(root, "src/claim.test.ts"), 'import { claim } from "@x/shop/claim";\ntest("3.1 a claim holds", () => claim());\n');
    const survey = await codeSurveyReader().read(folder, tree);
    assert.deepEqual(survey["story-shop"]?.files, [{ path: "src/claim.ts", lines: 1, capability: "cap-claims" }]);
    assert.deepEqual(survey["story-shop"]?.tests?.[0]?.imports, [{ from: "src/claim.test.ts", to: "src/claim.ts" }]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("8.13 a numbered test outside src reaches source through its helpers without reading unrelated scripts", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "code-survey-tests-"));
  try {
    const root = path.join(folder, "packages", "shop");
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "test"), { recursive: true });
    await writeFile(path.join(root, "src/claim.js"), "export const claim = () => 1;\n");
    await writeFile(path.join(root, "test/fake-dom.ts"), 'export { claim } from "../src/claim.js";\n');
    await writeFile(path.join(root, "test/claim.test.js"), 'import { claim } from "./fake-dom.js";\ntest("3.1 a claim holds", () => claim());\n');
    await writeFile(path.join(root, "release.js"), 'throw new Error("unrelated script");\n');
    const read: string[] = [];
    const survey = await codeSurveyReader({ readFile: file => (read.push(file), readFile(file, "utf8")) }).read(folder, tree);
    assert.deepEqual(survey["story-shop"]?.files, [{ path: "src/claim.js", lines: 1, capability: "cap-claims" }]);
    assert.deepEqual(survey["story-shop"]?.tests?.map(file => file.path), ["test/claim.test.js", "test/fake-dom.ts"]);
    assert.equal(read.includes(path.join(root, "release.js")), false);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("8.13 8.5 CommonJS helper chains stay within the package and refresh when a helper changes or disappears", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "code-survey-helpers-"));
  try {
    const root = path.join(folder, "packages/shop");
    for (const dir of ["src", "test", "helpers", "node_modules/hidden", "../other"]) {
      await mkdir(path.join(root, dir), { recursive: true });
    }
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "@x/shop", exports: { "./helper": "./helpers/index.js" } }));
    await writeFile(path.join(root, "src/claim.js"), "module.exports = () => 1;\n");
    await writeFile(path.join(root, "test/claim.test.cjs"), 'const claim = require("./page-helpers.cjs");\ntest("3.1 a claim holds", () => claim());\n');
    await writeFile(path.join(root, "test/page-helpers.cjs"), 'module.exports = require("@x/shop/helper");\nrequire("../../other/helper.js");\nrequire("../node_modules/hidden/index.js");\n');
    const helper = path.join(root, "helpers/index.js");
    await writeFile(helper, 'require("../test/page-helpers.cjs");\nmodule.exports = require("../src/claim.js");\n');
    await writeFile(path.join(root, "../other/helper.js"), 'require("../shop/src/claim.js");\n');
    await writeFile(path.join(root, "node_modules/hidden/index.js"), 'require("../../src/claim.js");\n');
    const read: string[] = [];
    const reader = codeSurveyReader({ readFile: file => (read.push(file), readFile(file, "utf8")) });
    const first = await reader.read(folder, tree);
    assert.deepEqual(first["story-shop"]?.files, [{ path: "src/claim.js", lines: 1, capability: "cap-claims" }]);
    assert.deepEqual(first["story-shop"]?.tests?.map(file => file.path), ["test/claim.test.cjs", "test/page-helpers.cjs", "helpers/index.js"]);
    assert.equal(read.some(file => file.includes(`${path.sep}other${path.sep}`) || file.includes(`${path.sep}node_modules${path.sep}`)), false);
    read.length = 0;
    assert.equal((await reader.read(folder, tree))["story-shop"], first["story-shop"]);
    assert.deepEqual(read, []);
    await writeFile(helper, "module.exports = () => 2;\n");
    const changed = await reader.read(folder, tree);
    assert.deepEqual(read, [helper]);
    assert.deepEqual(changed["story-shop"]?.files, [{ path: "src/claim.js", lines: 1 }]);
    await rm(helper);
    const removed = await reader.read(folder, tree);
    assert.deepEqual(removed["story-shop"]?.tests?.map(file => file.path), ["test/claim.test.cjs", "test/page-helpers.cjs"]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("8.5 changes to a package's exports refresh self reach without rereading its source", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "code-survey-self-cache-"));
  try {
    const root = path.join(folder, "packages", "shop");
    await mkdir(path.join(root, "src"), { recursive: true });
    const manifest = path.join(root, "package.json");
    await writeFile(path.join(root, "src/claim.ts"), "export const claim = () => 1;\n");
    await writeFile(path.join(root, "src/claim.test.ts"), 'import { claim } from "@x/shop/claim";\ntest("3.1 a claim holds", () => claim());\n');
    const read: string[] = [];
    const reader = codeSurveyReader({ readFile: file => (read.push(file), readFile(file, "utf8")) });
    await reader.read(folder, tree);
    for (const [text, reached] of [
      [JSON.stringify({ name: "@x/shop", exports: { "./claim": "./src/claim.ts" } }), true],
      [JSON.stringify({ name: "@x/shop-other", exports: { "./claim": "./src/claim.ts" } }), false],
      [JSON.stringify({ name: "@x/shop", exports: { "./claim": "./src/claim.ts" } }), true],
      [JSON.stringify({ name: "@x/shop", exports: { "./claim": "./../shop/src/claim.ts" } }), false],
      [JSON.stringify({ name: "@x/shop", exports: { "./claim": "./src/claim.ts" } }), true],
      ['{"name":', false],
    ] as const) {
      await writeFile(manifest, text);
      read.length = 0;
      const survey = await reader.read(folder, tree);
      assert.deepEqual(read, [manifest]);
      assert.equal(survey["story-shop"]?.files[0]?.capability, reached ? "cap-claims" : undefined, text);
      read.length = 0;
      assert.equal((await reader.read(folder, tree))["story-shop"], survey["story-shop"]);
      assert.deepEqual(read, []);
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("8.5 a second survey with no file changed reads no file again, and a changed file is read again", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "code-survey-"));
  try {
    const src = path.join(folder, "packages", "shop", "src");
    await mkdir(src, { recursive: true });
    await writeFile(path.join(src, "claim.ts"), "export const claim = () => 1;\n");
    await writeFile(path.join(src, "claim.test.ts"), 'import { claim } from "./claim.js";\ntest("3.1 a claim holds", () => claim());\n');
    const read: string[] = [];
    const survey = codeSurveyReader({ readFile: (file) => (read.push(file), readFile(file, "utf8")) });

    const first = await survey.read(folder, tree);
    assert.equal(read.length, 2);
    read.length = 0;

    const second = await survey.read(folder, tree);
    assert.deepEqual(read, []);
    assert.equal(second["story-shop"], first["story-shop"]);

    await writeFile(path.join(src, "claim.ts"), "export const claim = () => 1;\n\nexport const twice = () => 2;\n");
    const third = await survey.read(folder, tree);
    assert.deepEqual(read, [path.join(src, "claim.ts")]);
    assert.equal(third["story-shop"]?.files.find((file) => file.path === "src/claim.ts")?.lines, 2);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("8.8 each surveyed story names the stories whose packages its package depends on, through any dependency field", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "code-survey-"));
  const stories = { arcs: [], stories: ["Shop", "Till", "Bank"].map((title) => ({ id: `story-${title.toLowerCase()}`, title, capabilities: [] })) } as unknown as AnnotatedTree;
  try {
    const manifests = {
      shop: { name: "@x/shop", dependencies: { "@x/till": "workspace:*", lodash: "4" }, devDependencies: { "@x/bank": "workspace:*" } },
      till: { name: "@x/till", peerDependencies: { "@x/bank": "workspace:*" } },
      bank: { name: "@x/bank" },
    };
    for (const [name, manifest] of Object.entries(manifests)) {
      await mkdir(path.join(folder, "packages", name, "src"), { recursive: true });
      await writeFile(path.join(folder, "packages", name, "package.json"), JSON.stringify(manifest));
      await writeFile(path.join(folder, "packages", name, "src", "index.ts"), "export const it = 1;\n");
    }
    const survey = await codeSurveyReader().read(folder, stories);
    assert.deepEqual(survey["story-shop"]?.dependsOn, ["story-till", "story-bank"]);
    assert.deepEqual(survey["story-till"]?.dependsOn, ["story-bank"]);
    assert.deepEqual(survey["story-bank"]?.dependsOn, []);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});


test("8.8 the app unions its package and desktop dependencies and refreshes only changed manifests", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "code-survey-desktop-deps-"));
  const stories = { arcs: [], stories: ["App", "Till", "Bank", "Shop", "Cloud"].map((title) => ({ id: `story-${title.toLowerCase()}`, title, capabilities: [] })) } as unknown as AnnotatedTree;
  try {
    const manifests = {
      app: { name: "@x/app", dependencies: { "@x/till": "workspace:*" } },
      till: { name: "@x/till" },
      bank: { name: "@x/bank", dependencies: { "@x/desktop": "workspace:*" } },
      shop: { name: "@x/shop" },
      cloud: { name: "@x/cloud" },
    };
    for (const [name, manifest] of Object.entries(manifests)) {
      await mkdir(path.join(folder, "packages", name, "src"), { recursive: true });
      await writeFile(path.join(folder, "packages", name, "package.json"), JSON.stringify(manifest));
      await writeFile(path.join(folder, "packages", name, "src", "index.ts"), "export const value = 1;\n");
    }
    await mkdir(path.join(folder, "apps/desktop"), { recursive: true });
    const desktopManifest = path.join(folder, "apps/desktop/package.json");
    await writeFile(desktopManifest, JSON.stringify({ name: "@x/desktop", dependencies: { "@x/bank": "workspace:*" }, devDependencies: { "@x/till": "workspace:*" }, optionalDependencies: { "@x/shop": "workspace:*" }, peerDependencies: { "@x/cloud": "workspace:*", "@x/app": "workspace:*" } }));
    const read: string[] = [];
    const reader = codeSurveyReader({ readFile: (file) => (read.push(file), readFile(file, "utf8")) });
    const first = await reader.read(folder, stories);
    assert.deepEqual(first["story-app"]?.dependsOn, ["story-till", "story-bank", "story-shop", "story-cloud"]);
    assert.deepEqual(first["story-bank"]?.dependsOn, ["story-app"], "both package names identify the app story");
    read.length = 0;
    const second = await reader.read(folder, stories);
    assert.deepEqual(read, []);
    assert.equal(second["story-app"], first["story-app"]);
    await writeFile(desktopManifest, JSON.stringify({ name: "@x/desktop", optionalDependencies: { "@x/shop": "workspace:*" } }));
    const changed = await reader.read(folder, stories);
    assert.deepEqual(read, [desktopManifest]);
    assert.deepEqual(changed["story-app"]?.dependsOn, ["story-till", "story-shop"]);
    assert.equal(changed["story-app"]?.files, first["story-app"]?.files, "manifest changes retain the code survey");
    await rm(desktopManifest);
    const removed = await reader.read(folder, stories);
    assert.deepEqual(removed["story-app"]?.dependsOn, ["story-till"]);
    assert.deepEqual(removed["story-bank"]?.dependsOn, [], "a removed manifest no longer identifies a package");
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("8.9 the app survey includes desktop source and resolves its imports as the same story", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "code-survey-desktop-"));
  const app = { arcs: [], stories: [{ id: "app", title: "The app", capabilities: [{ id: "projects", title: "2 · Projects" }] }] } as unknown as AnnotatedTree;
  try {
    await mkdir(path.join(folder, "packages/app/src"), { recursive: true });
    await mkdir(path.join(folder, "apps/desktop/src/view"), { recursive: true });
    await writeFile(path.join(folder, "packages/app/src/projects.ts"), "export const projects = true;\n");
    await writeFile(path.join(folder, "packages/app/src/projects.test.ts"), 'import { view } from "../../../apps/desktop/src/view/view.js";\ntest("2.5 Projects view", () => view);\n');
    const projectsImport = path.posix.relative("apps/desktop/src/view", "packages/app/src/projects.js");
    await writeFile(path.join(folder, "apps/desktop/src/view/view.ts"), `import { projects } from "${projectsImport}";\nexport const view = projects;\n`);
    const survey = await codeSurveyReader().read(folder, app);
    assert.deepEqual(survey["app"]?.files, [
      { path: "src/projects.ts", lines: 1, capability: "projects" },
      { path: "../../apps/desktop/src/view/view.ts", lines: 2, capability: "projects" },
    ]);
    assert.deepEqual(survey["app"]?.imports, [{ from: "../../apps/desktop/src/view/view.ts", to: "src/projects.ts" }]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("8.11 a caller may survey its current worktree while the forest default still surveys main", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "code-survey-checkout-"));
  const main = path.join(folder, "main");
  const worktree = path.join(folder, "worktree");
  try {
    await mkdir(path.join(main, "packages/shop/src"), { recursive: true });
    await writeFile(path.join(main, "packages/shop/src/claim.ts"), "export const claim = 1;\n");
    const git = (...args: string[]) => execFileSync("git", args, { cwd: main, stdio: "pipe", windowsHide: true });
    git("init");
    git("add", ".");
    git("-c", "user.name=Survey test", "-c", "user.email=survey@example.test", "-c", "commit.gpgsign=false", "commit", "-m", "survey fixture");
    git("worktree", "add", "--detach", worktree, "HEAD");
    await writeFile(path.join(worktree, "packages/shop/src/claim.ts"), "export const claim = 1;\nexport const changed = 2;\n");
    const defaultSurvey = await codeSurveyReader().read(worktree, tree);
    const currentSurvey = await codeSurveyReader({ checkout: "current" }).read(worktree, tree);
    assert.equal(defaultSurvey["story-shop"]?.files[0]?.lines, 1);
    assert.equal(currentSurvey["story-shop"]?.files[0]?.lines, 2);
    const nested = await codeSurveyReader({ checkout: "current" }).read(path.join(worktree, "packages/shop/src"), tree);
    assert.equal(nested["story-shop"]?.files[0]?.lines, 2);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("8.11 8.5 merged surveys follow two workspace landings without touching local files and retain unchanged stories", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "code-survey-landings-"));
  const main = path.join(folder, "main");
  const workspace = path.join(folder, "workspace");
  const origin = path.join(folder, "origin.git");
  const stories = { ...tree, stories: [...tree.stories, { id: "story-bank", title: "Bank", capabilities: [] }] } as unknown as AnnotatedTree;
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe", windowsHide: true }).trim();
  const commit = (cwd: string) => {
    git(cwd, "add", ".");
    git(cwd, "-c", "user.name=Survey test", "-c", "user.email=survey@example.test", "-c", "commit.gpgsign=false", "commit", "-m", "fixture");
  };
  try {
    await mkdir(path.join(main, "packages/shop/src"), { recursive: true });
    await writeFile(path.join(main, "packages/shop/src/kept.ts"), "export const kept = 1;\n");
    await mkdir(path.join(main, "packages/bank/src"), { recursive: true });
    await writeFile(path.join(main, "packages/bank/src/bank.ts"), "export const bank = 1;\n");
    git(main, "init", "-b", "main");
    commit(main);
    const primaryHead = git(main, "rev-parse", "HEAD");
    git(folder, "init", "--bare", origin);
    git(main, "remote", "add", "origin", origin);
    git(main, "push", "origin", "main");
    git(main, "worktree", "add", "--detach", workspace, "HEAD");
    const reader = codeSurveyReader();
    const first = await reader.read(workspace, stories);
    assert.deepEqual(first["story-shop"]?.files, [{ path: "src/kept.ts", lines: 1 }]);
    // These collide with the incoming landing. Neither may be used or overwritten by main's survey.
    await writeFile(path.join(main, "packages/shop/src/kept.ts"), "export const dirty = 2;\nexport const local = 3;\n");
    await writeFile(path.join(main, "packages/shop/src/claim.ts"), "export const untracked = 9;\n");
    const status = git(main, "status", "--porcelain");
    for (const [name, text] of [
      ["claim.ts", "export const claim = 1;\nexport const landed = 2;\n"],
      ["next.ts", "export const next = 3;\n"],
    ]) {
      await writeFile(path.join(workspace, "packages/shop/src", name!), text!);
      commit(workspace);
      git(workspace, "push", "origin", "HEAD:main");
      const landed = await reader.read(main, stories);
      assert.equal(landed["story-shop"]?.files.find(file => file.path === `src/${name}`)?.lines, name === "claim.ts" ? 2 : 1);
      assert.equal(landed["story-shop"]?.files.find(file => file.path === "src/kept.ts")?.lines, 1);
      assert.equal((await reader.read(workspace, stories))["story-shop"], landed["story-shop"]);
      assert.equal(landed["story-bank"], first["story-bank"], "an unchanged story retains its survey across landings");
      assert.equal(git(main, "rev-parse", "HEAD"), primaryHead);
      assert.equal(git(main, "status", "--porcelain"), status);
    }
    assert.equal(await readFile(path.join(main, "packages/shop/src/claim.ts"), "utf8"), "export const untracked = 9;\n");
    assert.equal(await readFile(path.join(main, "packages/shop/src/kept.ts"), "utf8"), "export const dirty = 2;\nexport const local = 3;\n");
    const current = await codeSurveyReader({ checkout: "current" }).read(main, tree);
    assert.equal(current["story-shop"]?.files.find(file => file.path === "src/kept.ts")?.lines, 2);
    // Snapshots retain manifests and numbered tests outside src, including UTF-8 and quoted paths.
    await mkdir(path.join(workspace, "packages/shop/test"), { recursive: true });
    await writeFile(path.join(workspace, "packages/shop/package.json"), JSON.stringify({ name: "@x/shop", exports: { "./claim": "./src/claim.ts" } }));
    await writeFile(path.join(workspace, "packages/shop/test/helper.ts"), 'export { claim } from "@x/shop/claim";\n');
    await writeFile(path.join(workspace, 'packages/shop/test/雪 space.test.ts'), 'import { claim } from "./helper.js";\ntest("3.1 a claim holds", () => claim());\n');
    await rm(path.join(workspace, "packages/shop/src/next.ts"));
    commit(workspace);
    git(workspace, "push", "origin", "HEAD:main");
    const last = await reader.read(main, stories);
    assert.equal(last["story-shop"]?.files.find(file => file.path === "src/claim.ts")?.capability, "cap-claims");
    assert.equal(last["story-shop"]?.files.some(file => file.path === "src/next.ts"), false);
    assert.ok(last["story-shop"]?.tests?.some(file => file.path === "test/雪 space.test.ts"));
    git(main, "remote", "set-url", "origin", path.join(folder, "missing.git"));
    assert.equal((await reader.read(main, stories))["story-shop"], last["story-shop"], "offline retains fetched main");
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("8.11 a stalled origin is bounded, shared across worktrees and readers, and leaves the event loop free", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "code-survey-stall-"));
  const sockets = new Set<import("node:net").Socket>();
  let connections = 0;
  const server = createServer(socket => {
    connections++;
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
  });
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as import("node:net").AddressInfo;
    const git = (...args: string[]) => execFileSync("git", args, { cwd: folder, stdio: "pipe", windowsHide: true });
    git("init", "-b", "main");
    git("-c", "user.name=Survey test", "-c", "user.email=survey@example.test", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "fixture");
    const workspace = path.join(folder, "workspace");
    git("worktree", "add", "--detach", workspace, "HEAD");
    git("remote", "add", "origin", `git://127.0.0.1:${address.port}/stall.git`);
    const started = Date.now();
    let finished = false;
    const readings = Promise.allSettled([codeSurveyReader().read(folder, tree), codeSurveyReader().read(workspace, tree)]).then(result => { finished = true; return result; });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(finished, false, "a timer runs while Git is still waiting");
    const results = await readings;
    assert.ok(results.every(result => result.status === "rejected"));
    assert.equal(connections, 1, "the two readers share the same pending fetch");
    assert.ok(Date.now() - started < 15_000, "Git's timeout bounds a nonresponsive origin");
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(folder, { recursive: true, force: true });
  }
});

test("8.11 an unreachable origin with no fetched main fails instead of presenting workspace code as merged", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "code-survey-offline-"));
  try {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: folder, stdio: "pipe", windowsHide: true });
    git("init", "-b", "main");
    git("remote", "add", "origin", path.join(folder, "missing.git"));
    await assert.rejects(codeSurveyReader().read(folder, tree), /merged.*origin\/main/i);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
