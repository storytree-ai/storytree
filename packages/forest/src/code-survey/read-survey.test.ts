/**
 * Capability 8 · Code survey, read from disk: surveying the checkout again reads only the files that
 * changed since the last survey (ADR-0836 D2). Written against a small package in a temporary folder.
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { AnnotatedTree } from "@storytree/library";

import { codeSurveyReader } from "./read-survey.js";

const tree = { arcs: [], stories: [{ id: "story-shop", title: "Shop", capabilities: [{ id: "cap-claims", title: "3 · Claims" }] }] } as unknown as AnnotatedTree;

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
