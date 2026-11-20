// Capability 8 · Storytree's own test and gate entries.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { removeTemp } from "@storytree/test-waits";

import { RULES } from "./lint.mjs";
import { workflowEnvProblems } from "./workflow-env.mjs";

const ESCAPE = "escape_1b3b0da5720a";

async function problemsOf(t, files) {
  const root = mkdtempSync(path.join(tmpdir(), "workflow-env-"));
  t.after(() => removeTemp(root));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  execFileSync("git", ["init", "-q"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  return workflowEnvProblems(root);
}

function assertNames(problem, { workflow, job, at, variable }) {
  assert.ok(problem.includes(workflow), `names the workflow ${workflow}: ${problem}`);
  assert.match(problem, new RegExp(`\\bjob ${job}\\b`), `names job ${job}: ${problem}`);
  assert.ok(problem.includes(at), `names ${at}: ${problem}`);
  assert.match(problem, new RegExp(`\\b${variable}\\b`), `names ${variable}: ${problem}`);
  assert.ok(problem.includes(ESCAPE), `names ${ESCAPE}: ${problem}`);
}

const ROOT_FILES = {
  "package.json": JSON.stringify({ name: "website-root", private: true, scripts: { stamp: "node scripts/stamp.mjs" } }, null, 2),
  "pnpm-workspace.yaml": "packages:\n  - \"packages/*\"\n",
};

const BUILD_TS = [
  `import { writeFileSync } from "node:fs";`,
  ``,
  `const commit = process.argv[2] ?? process.env.WEBSITE_SHA;`,
  `const pages = ["index.html", "docs.html"];`,
  `const stamp = commit || "unpublished local build";`,
  `writeFileSync("dist/version.txt", stamp + "\\n");`,
  `console.log(pages.length, stamp);`,
  ``,
].join("\n");

const PUBLISH_MJS = [
  `const sha = process.env.WEBSITE_SHA ?? "";`,
  `if (!sha) throw new Error("no commit to publish");`,
  `console.log(sha);`,
  ``,
].join("\n");

const WEBSITE_FILES = {
  ...ROOT_FILES,
  "packages/website/package.json": JSON.stringify({ name: "@storytree/website", private: true, scripts: { build: "node --import tsx src/build.ts" } }, null, 2),
  "packages/website/src/build.ts": BUILD_TS,
  "scripts/publish.mjs": PUBLISH_MJS,
};

function websiteYml({ workflowEnv = "", buildEnv = "", beforeBuild = "", buildStepEnv = "", afterBuild = "", publishEnv = "    env:\n      WEBSITE_SHA: ${{ github.sha }}\n" } = {}) {
  return [
    `name: Publish website\n`,
    `on:\n  push:\n    branches: [main]\n`,
    workflowEnv,
    `jobs:\n`,
    `  build:\n    runs-on: ubuntu-latest\n`,
    buildEnv,
    `    steps:\n`,
    `      - uses: actions/checkout@v6\n`,
    `      - run: pnpm install --frozen-lockfile\n`,
    beforeBuild,
    `      - run: pnpm --filter @storytree/website build\n`,
    buildStepEnv,
    afterBuild,
    `      - uses: actions/upload-artifact@v7\n        with:\n          name: website-dist\n          path: dist/\n`,
    `  publish:\n    needs: build\n    runs-on: ubuntu-latest\n`,
    publishEnv,
    `    steps:\n`,
    `      - uses: actions/download-artifact@v8\n        with:\n          name: website-dist\n          path: dist\n`,
    `      - run: node scripts/publish.mjs\n`,
  ].join("");
}

const BUILD_AT = "packages/website/src/build.ts:5";

test(`8.30 · workflowEnvProblems refuses the shape of ${ESCAPE}: website.yml's build job runs pnpm --filter @storytree/website build, whose package.json script runs src/build.ts, which binds commit from process.env.WEBSITE_SHA and falls back with commit ||, while only the publish job sets WEBSITE_SHA; exactly one problem names website.yml, job build, packages/website/src/build.ts:5, WEBSITE_SHA and the escape`, async (t) => {
  const problems = await problemsOf(t, { ...WEBSITE_FILES, ".github/workflows/website.yml": websiteYml() });
  assert.equal(problems.length, 1, problems.join("\n"));
  assertNames(problems[0], { workflow: "website.yml", job: "build", at: BUILD_AT, variable: "WEBSITE_SHA" });
});

test(`8.30 · workflowEnvProblems refuses ${ESCAPE}'s own instance: inside buildWebsite(output, options), const commit is bound from "commit" in options ? options.commit : process.env.WEBSITE_SHA and falls back with commit || "unpublished local build"; with only the publish job setting WEBSITE_SHA, exactly one problem names website.yml, job build, packages/website/src/build.ts:8 and WEBSITE_SHA`, async (t) => {
  const instance = [
    `import path from "node:path";`,
    ``,
    `export async function buildWebsite(output = path.join("dist"), options: { commit?: string | undefined; preview?: boolean; base?: string } = {}) {`,
    `  const commit = "commit" in options ? options.commit : process.env.WEBSITE_SHA;`,
    `  const preview = options.preview ?? process.env.WEBSITE_PREVIEW === "1";`,
    `  const base = options.base ?? "/";`,
    `  if (commit && !/^[a-f0-9]{40}$/.test(commit)) throw new Error("The website's commit must be a full Git commit hash.");`,
    `  const version = commit || "unpublished local build";`,
    `  return { output, preview, base, version };`,
    `}`,
    ``,
    `await buildWebsite();`,
    ``,
  ].join("\n");
  const problems = await problemsOf(t, { ...WEBSITE_FILES, "packages/website/src/build.ts": instance, ".github/workflows/website.yml": websiteYml() });
  assert.equal(problems.length, 1, problems.join("\n"));
  assertNames(problems[0], { workflow: "website.yml", job: "build", at: "packages/website/src/build.ts:8", variable: "WEBSITE_SHA" });
});

test(`8.30 · workflowEnvProblems refuses a job running node <file> or pnpm run <script> from the root package.json, whose script reads process.env.X ?? or process.env.Y || directly, when another job sets X and Y and this one does not: one problem per job and variable, at the read's line (${ESCAPE})`, async (t) => {
  const stamp = [
    `import { writeFileSync } from "node:fs";`,
    ``,
    `const tag = process.env.RELEASE_TAG ?? "dev";`,
    `const channel = process.env.RELEASE_CHANNEL || "beta";`,
    `writeFileSync("stamp.txt", tag + " " + channel + "\\n");`,
    ``,
  ].join("\n");
  const release = [
    `name: Release\n`,
    `on: [push]\n`,
    `jobs:\n`,
    `  direct:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node scripts/stamp.mjs\n`,
    `  rooted:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm run stamp\n`,
    `  ship:\n    runs-on: ubuntu-latest\n    env:\n      RELEASE_TAG: \${{ github.ref_name }}\n    steps:\n`,
    `      - run: node scripts/stamp.mjs\n        env:\n          RELEASE_CHANNEL: stable\n`,
  ].join("");
  const problems = await problemsOf(t, { ...ROOT_FILES, "scripts/stamp.mjs": stamp, ".github/workflows/release.yml": release });
  assert.equal(problems.length, 4, problems.join("\n"));
  const find = (job, variable) => {
    const found = problems.filter((problem) => new RegExp(`\\bjob ${job}\\b`).test(problem) && new RegExp(`\\b${variable}\\b`).test(problem));
    assert.equal(found.length, 1, `one problem for job ${job} and ${variable}:\n${problems.join("\n")}`);
    return found[0];
  };
  assertNames(find("direct", "RELEASE_TAG"), { workflow: "release.yml", job: "direct", at: "scripts/stamp.mjs:3", variable: "RELEASE_TAG" });
  assertNames(find("direct", "RELEASE_CHANNEL"), { workflow: "release.yml", job: "direct", at: "scripts/stamp.mjs:4", variable: "RELEASE_CHANNEL" });
  assertNames(find("rooted", "RELEASE_TAG"), { workflow: "release.yml", job: "rooted", at: "scripts/stamp.mjs:3", variable: "RELEASE_TAG" });
  assertNames(find("rooted", "RELEASE_CHANNEL"), { workflow: "release.yml", job: "rooted", at: "scripts/stamp.mjs:4", variable: "RELEASE_CHANNEL" });
  assert.ok(problems.every((problem) => !/\bjob ship\b/.test(problem)), problems.join("\n"));
});

test(`8.30 · workflowEnvProblems passes the build job once it has WEBSITE_SHA in its job env, its build step's env, the workflow's env, or a WEBSITE_SHA=… line appended to $GITHUB_ENV by an earlier step (${ESCAPE})`, async (t) => {
  const variants = {
    "job env": websiteYml({ buildEnv: "    env:\n      WEBSITE_SHA: ${{ github.sha }}\n" }),
    "step env": websiteYml({ buildStepEnv: "        env:\n          WEBSITE_SHA: ${{ github.sha }}\n" }),
    "workflow env": websiteYml({ workflowEnv: "env:\n  WEBSITE_SHA: ${{ github.sha }}\n", publishEnv: "" }),
    "earlier GITHUB_ENV": websiteYml({ beforeBuild: "      - run: echo \"WEBSITE_SHA=${{ github.sha }}\" >> \"$GITHUB_ENV\"\n" }),
  };
  for (const [variant, workflow] of Object.entries(variants)) {
    assert.deepEqual(await problemsOf(t, { ...WEBSITE_FILES, ".github/workflows/website.yml": workflow }), [], variant);
  }
});

test(`8.30 · workflowEnvProblems still refuses the build job when WEBSITE_SHA is set only on another step of it, or appended to $GITHUB_ENV only after the build step (${ESCAPE})`, async (t) => {
  const variants = {
    "another step's env": websiteYml({ beforeBuild: "      - run: pnpm typecheck\n        env:\n          WEBSITE_SHA: ${{ github.sha }}\n" }),
    "later GITHUB_ENV": websiteYml({ afterBuild: "      - run: echo \"WEBSITE_SHA=${{ github.sha }}\" >> \"$GITHUB_ENV\"\n" }),
  };
  for (const [variant, workflow] of Object.entries(variants)) {
    const problems = await problemsOf(t, { ...WEBSITE_FILES, ".github/workflows/website.yml": workflow });
    assert.equal(problems.length, 1, `${variant}:\n${problems.join("\n")}`);
    assertNames(problems[0], { workflow: "website.yml", job: "build", at: BUILD_AT, variable: "WEBSITE_SHA" });
  }
});

test(`8.30 · workflowEnvProblems passes a fallback read of a variable no job of the workflow sets, and of one set only in another workflow file (${ESCAPE})`, async (t) => {
  assert.deepEqual(await problemsOf(t, { ...WEBSITE_FILES, ".github/workflows/website.yml": websiteYml({ publishEnv: "" }) }), [], "no job sets it");

  const other = `name: Rehearse\non: [workflow_dispatch]\njobs:\n  rehearse:\n    runs-on: ubuntu-latest\n    env:\n      WEBSITE_SHA: \${{ github.sha }}\n    steps:\n      - run: node scripts/publish.mjs\n`;
  assert.deepEqual(await problemsOf(t, {
    ...WEBSITE_FILES,
    ".github/workflows/website.yml": websiteYml({ publishEnv: "" }),
    ".github/workflows/rehearse.yml": other,
  }), [], "set only in another workflow");
});

test(`8.30 · workflowEnvProblems passes a fallback read inside if (process.argv[2] === "rehearse") when the job runs node scripts/publish-ci.mjs source, and refuses it, at the read's line, when the job runs node scripts/publish-ci.mjs rehearse (${ESCAPE})`, async (t) => {
  const script = [
    `if (process.argv[2] === "rehearse") {`,
    `  const sha = process.env.WEBSITE_SHA ?? "rehearsal";`,
    `  console.log("rehearse", sha);`,
    `} else if (process.argv[2] === "source") {`,
    `  console.log("source");`,
    `}`,
    ``,
  ].join("\n");
  const workflow = (word) => [
    `name: Publish website\n`,
    `on: [push]\n`,
    `jobs:\n`,
    `  source:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node scripts/publish-ci.mjs ${word}\n`,
    `  publish:\n    runs-on: ubuntu-latest\n    env:\n      WEBSITE_SHA: \${{ github.sha }}\n    steps:\n      - run: node scripts/publish-ci.mjs rehearse\n`,
  ].join("");

  assert.deepEqual(await problemsOf(t, { ...ROOT_FILES, "scripts/publish-ci.mjs": script, ".github/workflows/website.yml": workflow("source") }), []);

  const problems = await problemsOf(t, { ...ROOT_FILES, "scripts/publish-ci.mjs": script, ".github/workflows/website.yml": workflow("rehearse") });
  assert.equal(problems.length, 1, problems.join("\n"));
  assertNames(problems[0], { workflow: "website.yml", job: "source", at: "scripts/publish-ci.mjs:2", variable: "WEBSITE_SHA" });
});

test(`8.30 · pnpm lint's RULES include a rule named workflow-env whose problems are workflowEnvProblems (${ESCAPE})`, () => {
  const rule = RULES.find(({ name }) => name === "workflow-env");
  assert.ok(rule, RULES.map(({ name }) => name).join(", "));
  assert.equal(rule.problems, workflowEnvProblems);
});

test(`8.30 · workflowEnvProblems finds no problem in this checkout's own .github/workflows (${ESCAPE})`, async () => {
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  assert.deepEqual(await workflowEnvProblems(root), []);
});
