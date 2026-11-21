// Capability 8 · Storytree's own test and gate entries.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { RuleTester } from "oxlint/plugins-dev";

import * as oxlint from "../oxlint.mjs";
import plugin from "./index.mjs";

const rule = plugin.rules["no-silent-derived-folder"];
const at = (file) => path.join(process.cwd(), file);
const SOURCE = at("packages/repo-checks/src/test-run/factory-run.mjs");
const code = (...lines) => lines.join("\n").replaceAll("#{", "${").replaceAll("'", "`");
const refused = (text, filename = SOURCE) => ({ code: text, filename, errors: [{ messageId: "dropped" }] });
const passes = (text, filename = SOURCE) => ({ code: text, filename });

const FACTORY_PLUGINS = code(
  "import { existsSync } from \"node:fs\";",
  "import path from \"node:path\";",
  "import { packageOf } from \"./test-run.mjs\";",
  "export function factoryPlugins(stories, factory) {",
  "  return stories",
  "    .map((story) => ({ story, folder: 'plugins/#{story.plugin ?? packageOf(story)}' }))",
  "    .filter(({ folder }) => existsSync(path.join(factory, folder, \"package.json\")));",
  "}",
);

const BARE_FILTER = code(
  "import { existsSync } from \"node:fs\";",
  "import path from \"node:path\";",
  "import { packagesOf } from \"./package-of.js\";",
  "export function folders(story, root) {",
  "  return packagesOf(story).map((name) => path.join(root, \"packages\", name)).filter(existsSync);",
  "}",
);

const IN_CALLBACK = code(
  "import { existsSync } from \"node:fs\";",
  "import path from \"node:path\";",
  "import { packageOf } from \"./package-of.js\";",
  "export function present(stories, root) {",
  "  return stories.filter((story) => existsSync(path.join(root, \"packages\", packageOf(story), \"package.json\")));",
  "}",
);

const MEMBER_CALLS = code(
  "import fs from \"node:fs\";",
  "import * as survey from \"./code-survey/code-survey.js\";",
  "export function present(stories) {",
  "  return stories.map((s) => survey.packageOf(s)).filter((f) => fs.existsSync(f));",
  "}",
);

const MEMBER_EXISTS = code(
  "import fs from \"node:fs\";",
  "import path from \"node:path\";",
  "import { packageOf } from \"./package-of.js\";",
  "export function present(stories, root) {",
  "  return stories.filter((story) => fs.existsSync(path.join(root, \"packages\", packageOf(story))));",
  "}",
);

const MEMBER_DERIVES = code(
  "import { existsSync } from \"node:fs\";",
  "import * as survey from \"./code-survey/code-survey.js\";",
  "export function present(story) {",
  "  return survey.packagesOf(story).filter(existsSync);",
  "}",
);

test("8.33 · storytree/no-silent-derived-folder refuses, in a non-test source file under packages/repo-checks, packages/map or packages/app-setup, a .filter whose callback calls existsSync or is existsSync over a list derived by packageOf or packagesOf, each called bare or as a member (fs.existsSync, survey.packageOf), called in the filtered expression (factoryPlugins as it stood, a .filter(existsSync) on a packagesOf result) or in the callback; its message names escape_ea60149a4f42; an existsSync filter over a list no packageOf or packagesOf derives, a packageOf .map with no existsSync filter, a test file and a file under another package pass", () => {
  assert.match(rule?.meta?.messages?.dropped ?? "", /escape_ea60149a4f42/);

  new RuleTester({ cwd: process.cwd(), languageOptions: { parserOptions: { lang: "ts" } } }).run("no-silent-derived-folder", rule, {
    valid: [
      passes(code(
        "import { existsSync } from \"node:fs\";",
        "import path from \"node:path\";",
        "export function present(dirs, root) {",
        "  return dirs.filter((dir) => existsSync(path.join(root, dir)));",
        "}",
      )),
      passes(code(
        "import { packageOf } from \"./test-run.mjs\";",
        "export function folders(stories) {",
        "  return stories.map((story) => 'plugins/#{story.plugin ?? packageOf(story)}');",
        "}",
      )),
      passes(code(
        "import { packageOf } from \"./test-run.mjs\";",
        "export function folders(stories) {",
        "  return stories.map(packageOf).filter((name) => name !== \"app\");",
        "}",
      )),
      passes(FACTORY_PLUGINS, at("packages/repo-checks/src/test-run/factory-run.test.mjs")),
      passes(FACTORY_PLUGINS, at("packages/code-measures/src/record.ts")),
    ],
    invalid: [
      refused(FACTORY_PLUGINS),
      refused(BARE_FILTER, at("packages/map/src/code-survey/read-survey.ts")),
      refused(IN_CALLBACK, at("packages/app-setup/src/stories.ts")),
      refused(IN_CALLBACK),
      refused(FACTORY_PLUGINS, at("packages/map/src/graph.ts")),
      refused(MEMBER_CALLS, at("packages/map/src/affected.ts")),
      refused(MEMBER_EXISTS),
      refused(MEMBER_DERIVES, at("packages/app-setup/src/stories.ts")),
    ],
  });
});

test("8.33 · through pnpm lint's config, factoryPlugins as it stood in packages/repo-checks/src/test-run/factory-run.mjs is one storytree/no-silent-derived-folder hit naming escape_ea60149a4f42, and the same text in a test file or under packages/code-measures is none", () => {
  const [hits, inTest, elsewhere] = oxlint.ruleHits(["packages/repo-checks/src/test-run/factory-run.mjs", "packages/repo-checks/src/test-run/factory-run.test.mjs", "packages/code-measures/src/record.ts"].map((file) => ({ file, text: FACTORY_PLUGINS })))
    .map((each) => each.filter(({ rule: id }) => id === "storytree/no-silent-derived-folder"));
  assert.equal(hits.length, 1);
  assert.match(hits[0].message, /escape_ea60149a4f42/);

  assert.deepEqual(inTest, []);
  assert.deepEqual(elsewhere, []);
});
