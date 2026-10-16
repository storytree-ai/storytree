/**
 * Capability 8 · Code survey, read from disk: surveying the checkout again reads only the files that
 * changed since the last survey (ADR-0836 D2). Written against a small package in a temporary folder.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { AnnotatedTree, StorySurvey } from "@storytree/library";

import { capabilitiesOfFiles, codeSurveyReader, offThreadSurveyReader, readCodeSurvey, testedNumbers } from "./read-survey.js";
import { focusProject } from "../read.js";
// 8.16 runs this module on a worker thread; imported here, with no parent port, it answers nothing.
import "./survey-worker.js";

const tree = { arcs: [], stories: [{ id: "story-shop", title: "Shop", capabilities: [{ id: "cap-claims", title: "3 · Claims" }] }] } as unknown as AnnotatedTree;

test("8.1, 8.5 Constructor stories survey alongside ordinary stories and package aliases", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "code-survey-titles-"));
  const fixtures = [["Shop", "shop"], ["The command line", "cli"], ["The world", "forest-world"], ["Lag in real use", "lag-in-use"], ["Constructor", "constructor"]] as const;
  const stories = fixtures.map(([title, name]) => ({ id: `story-${name}`, title, capabilities: [{ id: `cap-${name}`, title: "1 · Value" }] }));
  const ordinary = { arcs: [], stories: stories.slice(0, -1) } as unknown as AnnotatedTree;
  const reader = codeSurveyReader();
  try {
    for (const [, name] of fixtures) {
      const src = path.join(folder, "packages", name, "src");
      await mkdir(src, { recursive: true });
      await writeFile(path.join(src, "value.ts"), "export const value = 1;\n");
      await writeFile(path.join(src, "value.test.ts"), 'import { value } from "./value.js";\ntest("1.1 a value", () => value);\n');
    }
    const before = await reader.read(folder, ordinary);
    for (const title of ["Constructor", "The Constructor"]) {
      const plan = { arcs: [], stories: stories.map(story => story.id === "story-constructor" ? { ...story, title } : story) } as unknown as AnnotatedTree;
      const survey = await reader.read(folder, plan);
      assert.deepEqual(Object.keys(survey).sort(), stories.map(story => story.id).sort());
      for (const [, name] of fixtures) {
        assert.deepEqual(survey[`story-${name}`]?.files, [{ path: "src/value.ts", lines: 1, capability: `cap-${name}` }]);
      }
    }
    await writeFile(path.join(folder, "packages/shop/src/value.ts"), "export const value = 1;\nexport const another = 2;\n");
    const after = await reader.read(folder, ordinary);
    assert.equal(after["story-shop"]?.files[0]?.lines, 2);
    assert.equal(after["story-constructor"], undefined);
    assert.equal(after["story-cli"], before["story-cli"]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("8.10 disk, fetched-main and focus surveys skip oversized titles and retain unrelated proof", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "code-survey-bounds-"));
  const plan = { ...tree, stories: [{ ...tree.stories[0], capabilities: [{ ...tree.stories[0]!.capabilities[0], dependsOn: [],
    contracts: [{ id: "claim-proof", title: "3.1 a claim holds" }],
  }] }] } as unknown as AnnotatedTree;
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe", windowsHide: true });
  try {
    for (const mode of ["disk", "git"]) {
      const checkout = path.join(folder, mode);
      const src = path.join(checkout, "packages/shop/src");
      await mkdir(src, { recursive: true });
      await writeFile(path.join(src, "claim.ts"), "export const claim = 1;");
      await writeFile(path.join(src, "claim.test.ts"), 'import { claim } from "./claim.js";\ntest("3.1–3.2 ordinary proof", () => claim);');
      await writeFile(path.join(src, "oversized.test.ts"), [
        'throw new Error("source must never execute");',
        'test("3.1–3.9007199254740991 oversized", () => {});',
        'const TITLE = "shop 3.1–3.128, 3.129–3.257 cumulative";',
        'test(TITLE, () => {});',
        'test(`${TITLE} template`, () => {});',
        'test("3.3 valid after refusal", () => {});',
      ].join("\n"));
      if (mode === "git") {
        git(checkout, "init", "-b", "main");
        git(checkout, "add", ".");
        git(checkout, "-c", "user.name=Survey test", "-c", "user.email=survey@example.test", "-c", "commit.gpgsign=false", "commit", "-m", "fixture");
        const origin = path.join(folder, "origin.git");
        git(folder, "init", "--bare", origin);
        git(checkout, "remote", "add", "origin", origin);
        git(checkout, "push", "origin", "main");
      }
      const survey = (await readCodeSurvey(checkout, plan))["story-shop"]!;
      assert.deepEqual(survey.files, [{ path: "src/claim.ts", lines: 1, capability: "cap-claims" }]);
      assert.deepEqual(survey.tests?.find(file => file.path === "src/claim.test.ts")?.titles.map(title => title.number), ["3.1", "3.2"]);
      assert.deepEqual(survey.tests?.find(file => file.path === "src/oversized.test.ts")?.titles, [{ number: "3.3", title: "3.3 valid after refusal" }]);
      const focus = await focusProject({ projectTree: async () => plan }, checkout, { select: "promise:claim-proof", down: 1, mode: "show" });
      assert.equal(focus.refused, false);
      assert.ok(focus.rows?.some(row => row.id === "test:packages/shop/src/claim.test.ts"));
      assert.equal(focus.rows?.some(row => row.id === "test:packages/shop/src/oversized.test.ts"), false);
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

/** The command lines of running processes that name `needle`. */
function processesNaming(needle: string): string[] {
  const lines = process.platform === "win32"
    ? execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command",
      "Get-CimInstance Win32_Process | ForEach-Object { $_.CommandLine }"], { encoding: "utf8", windowsHide: true })
    : execFileSync("ps", ["-A", "-o", "args="], { encoding: "utf8" });
  return lines.split(/\r?\n/).filter(line => line.includes(needle));
}

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

/** Write each package's files under `folder`, keyed by their path from the package. */
async function writePackages(folder: string, packages: Readonly<Record<string, Readonly<Record<string, string>>>>): Promise<void> {
  for (const [name, files] of Object.entries(packages)) {
    for (const [file, text] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(folder, "packages", name, file)), { recursive: true });
      await writeFile(path.join(folder, "packages", name, file), text);
    }
  }
}

/** Two stories: the till's names, defined across its files and offered through its exports and re-exports, and a bank whose code no numbered test reaches. */
const tillAndBank = {
  till: {
    "package.json": JSON.stringify({ name: "@x/till", exports: { ".": "./src/index.ts", "./receipts": "./src/receipts.ts" } }),
    "src/index.ts": 'export * from "./prices.js";\nexport { receipt as makeReceipt } from "./receipts.js";\n',
    "src/prices.ts": "export const price = 1;\nexport type Money = number;\n",
    "src/receipts.ts": "export function receipt() { return 1; }\n",
    "src/prices.test.ts": 'import { price } from "./prices.js";\ntest("1.1 prices", () => price);\n',
    "src/receipts.test.ts": 'import { receipt } from "./receipts.js";\ntest("2.1 receipts", () => receipt);\n',
  },
  bank: {
    "package.json": JSON.stringify({ name: "@x/bank", exports: { ".": "./src/index.ts" } }),
    "src/index.ts": 'export { vault } from "./vault.js";\n',
    "src/vault.ts": "export const vault = 1;\n",
  },
};
const tillAndBankStories = [
  { id: "story-till", title: "Till", capabilities: [{ id: "cap-prices", title: "1 · Prices" }, { id: "cap-receipts", title: "2 · Receipts" }] },
  { id: "story-bank", title: "Bank", capabilities: [{ id: "cap-vault", title: "1 · Vault" }] },
];

/** A story's derived edges, one line each: from capability, story, to capability, by value or types. */
const edgeLines = (survey: StorySurvey | undefined): string[] =>
  (survey?.edges ?? []).map((edge) => `${edge.from ?? "-"} > ${edge.story}:${edge.to ?? "-"} ${edge.typeOnly ? "types" : "value"}`).sort();

test("8.18 an import of another story's name is an edge from its file's capability to the capability of the file defining it, type-only when every import behind it is", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "code-survey-edges-"));
  const stories = { arcs: [], stories: [{ id: "story-shop", title: "Shop", capabilities: [{ id: "cap-cart", title: "1 · Cart" }, { id: "cap-pay", title: "2 · Pay" }] }, ...tillAndBankStories] } as unknown as AnnotatedTree;
  try {
    await writePackages(folder, {
      ...tillAndBank,
      shop: {
        "package.json": JSON.stringify({ name: "@x/shop" }),
        // A value and a type import of one capability's file make a value edge; a renamed re-export leads to its own file.
        "src/cart.ts": 'import { price, makeReceipt } from "@x/till";\nimport type { Money } from "@x/till";\nexport const cart: Money = price + makeReceipt();\n',
        // Types alone make a type-only edge, even inline; a subpath export and a literal dynamic import lead to the file they name.
        "src/pay.ts": 'import { type Money } from "@x/till";\nexport const pay = (): Promise<Money> => import("@x/till/receipts").then(({ receipt }) => receipt());\n',
        "src/cart.test.ts": 'import { cart } from "./cart.js";\nimport { vault } from "@x/bank";\ntest("1.1 cart", () => cart + vault);\n',
        "src/pay.test.ts": 'import { pay } from "./pay.js";\ntest("2.1 pay", () => pay);\n',
      },
    });
    const survey = await codeSurveyReader().read(folder, stories);
    assert.deepEqual(edgeLines(survey["story-shop"]), [
      "cap-cart > story-till:cap-prices value",
      "cap-cart > story-till:cap-receipts value",
      "cap-pay > story-till:cap-prices types",
      "cap-pay > story-till:cap-receipts value",
    ], "a test's import of the bank makes no edge");
    assert.deepEqual(survey["story-shop"]?.edges?.find((edge) => edge.from === "cap-pay" && edge.to === "cap-prices")?.files, [{ from: "src/pay.ts", to: "src/prices.ts", typeOnly: true }]);
    assert.deepEqual(edgeLines(survey["story-till"]), []);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("8.19 a derived edge with no capability at an end is kept as a story edge naming the files that cause it", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "code-survey-story-edges-"));
  const stories = { arcs: [], stories: [{ id: "story-shop", title: "Shop", capabilities: [{ id: "cap-cart", title: "1 · Cart" }] }, ...tillAndBankStories] } as unknown as AnnotatedTree;
  try {
    await writePackages(folder, {
      ...tillAndBank,
      shop: {
        "package.json": JSON.stringify({ name: "@x/shop" }),
        "src/cart.ts": 'import { vault } from "@x/bank";\nexport const cart = vault;\n',
        "src/loose.ts": 'export { price } from "@x/till";\n',
        "src/cart.test.ts": 'import { cart } from "./cart.js";\ntest("1.1 cart", () => cart);\n',
      },
    });
    const survey = await codeSurveyReader().read(folder, stories);
    assert.deepEqual(survey["story-shop"]?.edges, [
      { story: "story-bank", from: "cap-cart", typeOnly: false, files: [{ from: "src/cart.ts", to: "src/vault.ts", typeOnly: false }] },
      { story: "story-till", to: "cap-prices", typeOnly: false, files: [{ from: "src/loose.ts", to: "src/prices.ts", typeOnly: false }] },
    ]);
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
    // On Windows, `git` is often Git for Windows' launcher, whose real git.exe is its child.
    assert.deepEqual(processesNaming(path.basename(folder)), [], "no git process the reading started outlives it");
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

test("8.27 a start's reader answers its first ask from the main already fetched while it fetches, and its next ask waits on that fetch and surveys what it brought", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "code-survey-start-"));
  const checkout = path.join(folder, "checkout");
  const other = path.join(folder, "other");
  const origin = path.join(folder, "origin.git");
  const sockets = new Set<import("node:net").Socket>();
  let connections = 0;
  const server = createServer(socket => {
    connections++;
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
  });
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe", windowsHide: true }).trim();
  const commit = (cwd: string) => {
    git(cwd, "add", ".");
    git(cwd, "-c", "user.name=Survey test", "-c", "user.email=survey@example.test", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "fixture");
  };
  const claimLines = async (reading: Promise<Record<string, StorySurvey>>) => (await reading)["story-shop"]?.files[0]?.lines;
  try {
    await mkdir(path.join(checkout, "packages/shop/src"), { recursive: true });
    await writeFile(path.join(checkout, "packages/shop/src/claim.ts"), "export const claim = 1;\n");
    git(folder, "init", "--bare", "-b", "main", origin);
    git(checkout, "init", "-b", "main");
    git(checkout, "remote", "add", "origin", origin);
    commit(checkout);
    git(checkout, "push", "--quiet", "origin", "main");
    // Main moves on the origin after this checkout last fetched it.
    git(folder, "clone", "--quiet", origin, other);
    await writeFile(path.join(other, "packages/shop/src/claim.ts"), "export const claim = 1;\nexport const landed = 2;\n");
    commit(other);
    git(other, "push", "--quiet", "origin", "main");

    const start = codeSurveyReader({ startFromFetched: true });
    assert.equal(await claimLines(start.read(checkout, tree)), 1, "the first ask answers from the main already fetched");
    assert.equal(await claimLines(start.read(checkout, tree)), 2, "the next ask surveys the newer main that fetch brought");

    // A stalling origin: the first answer lands while the start's fetch is still open, and the next ask waits on it.
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as import("node:net").AddressInfo;
    git(other, "worktree", "add", "--quiet", "--detach", path.join(folder, "stalled"), "HEAD");
    const stalled = path.join(folder, "stalled");
    git(stalled, "update-ref", "refs/remotes/origin/main", "HEAD");
    git(stalled, "remote", "set-url", "origin", `git://127.0.0.1:${address.port}/stall.git`);
    const restarted = codeSurveyReader({ startFromFetched: true });
    assert.equal(await claimLines(restarted.read(stalled, tree)), 2);
    assert.equal(connections, 1, "the start's fetch was asked for");
    assert.equal(sockets.size, 1, "and is still open when the first answer lands");
    assert.equal(await claimLines(restarted.read(stalled, tree)), 2, "a fetch that fails leaves the next ask on the main already fetched");
    assert.equal(connections, 1, "the next ask waits on the start's fetch rather than starting another");
    assert.deepEqual(processesNaming(path.basename(folder)), [], "no git process the reading started outlives it");
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(folder, { recursive: true, force: true });
  }
});

test("8.16 a survey read on a worker thread answers what one read in place does, and the asking thread's event loop stays free", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "code-survey-worker-"));
  const reader = offThreadSurveyReader(new URL("./survey-worker.ts", import.meta.url), { execArgv: ["--import", "tsx"] });
  try {
    const root = path.join(folder, "packages", "shop");
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "@x/shop" }));
    // Enough source that parsing it holds the asking thread for hundreds of milliseconds when read in place.
    const body = Array.from({ length: 120 }, (_, n) => `export function step${n}(a: number): number { return a * ${n} + [${n}, ${n + 1}].reduce((x, y) => x + y, 0); }`).join("\n");
    for (let n = 0; n < 300; n++) {
      await writeFile(path.join(root, `src/part${n}.ts`), `${body}\n`);
      await writeFile(path.join(root, `src/part${n}.test.ts`), `import { step0 } from "./part${n}.js";\ntest("3.${n + 1} part ${n} steps", () => step0(1));\n`);
    }
    // How busy this thread's event loop was, rather than how long its timers waited: a loaded machine
    // delays timers either way, but only a read in place keeps the loop itself busy.
    const busy = async <T>(read: () => Promise<T>) => {
      const start = performance.eventLoopUtilization();
      const result = await read();
      return { result, utilization: performance.eventLoopUtilization(start).utilization };
    };
    const offThread = await busy(() => reader.read(folder, tree));
    const inPlace = await busy(() => codeSurveyReader().read(folder, tree));
    assert.deepEqual(offThread.result, inPlace.result);
    assert.equal(offThread.result["story-shop"]?.files?.length, 300);
    assert.ok(offThread.utilization < 0.5 && offThread.utilization < inPlace.utilization / 2,
      `the asking thread's loop was busy ${(offThread.utilization * 100).toFixed(0)}% of an off-thread read, ${(inPlace.utilization * 100).toFixed(0)}% of one in place`);
  } finally {
    await reader.close();
    await rm(folder, { recursive: true, force: true });
  }
});

test("8.16 a process holding an open off-thread reader that answered once exits by itself", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "code-survey-unref-"));
  try {
    const src = path.join(folder, "packages", "shop", "src");
    await mkdir(src, { recursive: true });
    await writeFile(path.join(src, "value.ts"), "export const value = 1;\n");
    // The child answers one survey and never closes its reader: only an unref'd worker lets it end.
    const script = `import { offThreadSurveyReader } from ${JSON.stringify(new URL("./read-survey.ts", import.meta.url).href)};
const reader = offThreadSurveyReader(new URL(${JSON.stringify(new URL("./survey-worker.ts", import.meta.url).href)}), { execArgv: ["--import", "tsx"] });
const survey = await reader.read(${JSON.stringify(folder)}, ${JSON.stringify(tree)});
console.log(survey["story-shop"].files.length);`;
    const exited = await new Promise<{ code: number | null; out: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "inherit"], windowsHide: true });
      let out = "";
      child.stdout.on("data", chunk => { out += chunk; });
      const stuck = setTimeout(() => { child.kill(); reject(new Error(`the process answered ${JSON.stringify(out.trim())} and was still running after 30s`)); }, 30_000);
      child.on("exit", code => { clearTimeout(stuck); resolve({ code, out }); });
    });
    assert.deepEqual(exited, { code: 0, out: "1\n" });
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("8.25 a start whose fetched main is the commit last surveyed, with the same plan, answers from the kept survey without reading a file", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "code-survey-kept-"));
  const checkout = path.join(folder, "checkout");
  const kept = path.join(folder, "kept");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: checkout, encoding: "utf8", stdio: "pipe", windowsHide: true }).trim();
  const commit = () => {
    git("add", ".");
    // Quiet: a commit's summary would read the contents a test has removed.
    git("-c", "user.name=Survey test", "-c", "user.email=survey@example.test", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "fixture");
    git("push", "--quiet", "origin", "main");
  };
  // Each start is a fresh worker thread: nothing of an earlier start's reading is in memory.
  const start = () => offThreadSurveyReader(new URL("./survey-worker.ts", import.meta.url), { execArgv: ["--import", "tsx"], keptIn: kept });
  const surveyed = async (plan: AnnotatedTree) => {
    const reader = start();
    try {
      return await reader.read(checkout, plan);
    } finally {
      await reader.close();
    }
  };
  // Removes the package's file contents from the checkout's Git: a start that reads any file fails.
  const forgetContents = async () => {
    for (const line of git("ls-tree", "-r", "HEAD", "packages/shop").split("\n")) {
      const sha = line.split(/\s+/)[2]!;
      const object = path.join(checkout, ".git/objects", sha.slice(0, 2), sha.slice(2));
      await chmod(object, 0o666);
      await rm(object);
    }
  };
  try {
    const src = path.join(checkout, "packages/shop/src");
    await mkdir(src, { recursive: true });
    await writeFile(path.join(src, "claim.ts"), "export const claim = 1;\n");
    await writeFile(path.join(src, "claim.test.ts"), 'import { claim } from "./claim.js";\ntest("3.1 a claim holds", () => claim);\n');
    execFileSync("git", ["init", "-b", "main", checkout], { stdio: "pipe", windowsHide: true });
    execFileSync("git", ["init", "--bare", path.join(folder, "origin.git")], { stdio: "pipe", windowsHide: true });
    git("remote", "add", "origin", path.join(folder, "origin.git"));
    commit();
    const first = await surveyed(tree);
    assert.deepEqual(first["story-shop"]?.files, [{ path: "src/claim.ts", lines: 1, capability: "cap-claims" }]);

    await forgetContents();
    assert.deepEqual(await surveyed(tree), first, "main unmoved and the same plan: no file is read");
    const renamed = { arcs: [], stories: [{ ...tree.stories[0], capabilities: [{ id: "cap-claims", title: "3 · Claimed" }] }] } as unknown as AnnotatedTree;
    await assert.rejects(surveyed(renamed), "another plan is surveyed afresh, reading the files");

    await writeFile(path.join(src, "claim.ts"), "export const claim = 1;\nexport const twice = 2;\n");
    await writeFile(path.join(src, "claim.test.ts"), 'import { claim } from "./claim.js";\ntest("3.1 a claim still holds", () => claim);\n');
    commit();
    const moved = await surveyed(tree);
    assert.equal(moved["story-shop"]?.files[0]?.lines, 2, "a newer main is surveyed afresh");
    await forgetContents();
    assert.deepEqual(await surveyed(tree), moved, "and kept in its turn");
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("8.17 a changed file is placed by its own declaration, else by the survey's inference, and a file outside every package or unreadable nowhere", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "code-survey-owners-"));
  const plan = { arcs: [], stories: [{ id: "story-shop", title: "Shop", capabilities: [{ id: "cap-claims", title: "3 · Claims" }, { id: "cap-cart", title: "4 · Cart" }] }] } as unknown as AnnotatedTree;
  try {
    const src = path.join(folder, "packages/shop/src");
    await mkdir(src, { recursive: true });
    await writeFile(path.join(src, "cart.ts"), "// Capability 4 · Cart.\nexport const cart = 1;\n");
    await writeFile(path.join(src, "claim.ts"), "export const claim = 1;\n");
    await writeFile(path.join(src, "claim.test.ts"), 'import { claim } from "./claim.js";\ntest("3.1 a claim", () => claim);\n');
    await writeFile(path.join(src, "loose.ts"), "export const loose = 1;\n");
    await writeFile(path.join(folder, "README.md"), "outside\n");
    const owners = await capabilitiesOfFiles(folder, ["packages/shop/src/cart.ts", "packages\\shop\\src\\claim.ts", "packages/shop/src/claim.test.ts", "packages/shop/src/loose.ts", "packages/shop/src/gone.ts", "README.md"], plan);
    assert.deepEqual([...owners], [
      ["packages/shop/src/cart.ts", { capability: "cap-cart", inferred: false }],
      ["packages/shop/src/claim.test.ts", { capability: "cap-claims", inferred: false }],
      ["packages/shop/src/claim.ts", { capability: "cap-claims", inferred: true }],
    ]);
    const read: string[] = [];
    const surveyed = await capabilitiesOfFiles(folder, ["packages/shop/src/claim.ts"], plan, {
      readText: (file) => (read.push(file), "export const claim = 1;\n"),
      survey: async () => ({ "story-shop": { files: [{ path: "src/claim.ts", lines: 1, capability: "cap-cart" }] } }) as never,
    });
    assert.deepEqual(read, ["packages/shop/src/claim.ts"]);
    assert.deepEqual([...surveyed], [["packages/shop/src/claim.ts", { capability: "cap-cart", inferred: true }]]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("8.29 a source file whose header's title is not its number's capability in its story, as a file moved from another story keeps, declares nothing: it is placed by inference, or nowhere", async () => {
  const plan = { arcs: [], stories: [{ id: "story-shop", title: "Shop", capabilities: [{ id: "cap-settings", title: "2 · Settings" }, { id: "cap-caller", title: "3 · The caller" }] }] } as unknown as AnnotatedTree;
  const texts: Record<string, string> = {
    "packages/shop/src/caller.ts": "/**\n * Capability 2 · Agent activity log: who called.\n */\nexport const caller = 1;\n",
    "packages/shop/src/settings.ts": "// Capability 2 · settings, read and written.\nexport const settings = 1;\n",
  };
  const readText = (file: string) => texts[file];
  const unsurveyed = await capabilitiesOfFiles("/nowhere", Object.keys(texts), plan, { readText, survey: async () => ({}) });
  assert.deepEqual([...unsurveyed], [["packages/shop/src/settings.ts", { capability: "cap-settings", inferred: false }]]);
  const surveyed = await capabilitiesOfFiles("/nowhere", ["packages/shop/src/caller.ts"], plan, {
    readText,
    survey: async () => ({ "story-shop": { files: [{ path: "src/caller.ts", lines: 1, capability: "cap-caller" }] } }) as never,
  });
  assert.deepEqual([...surveyed], [["packages/shop/src/caller.ts", { capability: "cap-caller", inferred: true }]]);
});

test("8.30 a story that owns several packages has each package's files surveyed under its capabilities, and its claims and tested numbers read from every one", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "code-survey-packages-"));
  const plan = { arcs: [], stories: [{ id: "story-shop", title: "Shop", capabilities: [{ id: "cap-cart", title: "1 · Cart" }, { id: "cap-store", title: "2 · Store" }] }] } as unknown as AnnotatedTree;
  const alsoOwned = { shop: ["shop-store"] };
  try {
    await mkdir(path.join(folder, "packages/shop/src"), { recursive: true });
    await mkdir(path.join(folder, "packages/shop-store/src"), { recursive: true });
    await writeFile(path.join(folder, "packages/shop/src/cart.ts"), "// Capability 1 · Cart.\nexport const cart = 1;\n");
    await writeFile(path.join(folder, "packages/shop-store/src/store.ts"), "export const store = 1;\n");
    await writeFile(path.join(folder, "packages/shop-store/src/store.test.ts"), 'import { store } from "./store.js";\ntest("2.1 a store", () => store);\ntest("shop-store 2.2 a store, named by its package", () => store);\n');
    const survey = await codeSurveyReader({ alsoOwned }).read(folder, plan);
    assert.deepEqual([...survey["story-shop"]!.files].sort((a, b) => a.path.localeCompare(b.path)), [
      { path: "../shop-store/src/store.ts", lines: 1, capability: "cap-store" },
      { path: "src/cart.ts", lines: 2, declared: 1, reachedBy: [] },
    ]);
    assert.deepEqual(survey["story-shop"]!.tests?.map((test) => [test.path, test.titles.map((title) => title.number)]), [["../shop-store/src/store.test.ts", ["2.1", "2.2"]]]);
    const owners = await capabilitiesOfFiles(folder, ["packages/shop-store/src/store.ts", "packages/shop-store/src/store.test.ts"], plan, { alsoOwned });
    assert.deepEqual([...owners], [
      ["packages/shop-store/src/store.test.ts", { capability: "cap-store", inferred: false }],
      ["packages/shop-store/src/store.ts", { capability: "cap-store", inferred: true }],
    ]);
    assert.deepEqual(await testedNumbers(folder, plan, "cap-store", { alsoOwned }), ["2.1", "2.2"]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
