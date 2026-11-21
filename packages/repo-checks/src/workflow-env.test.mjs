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

test(`8.30 · workflowEnvProblems refuses the build job of ${ESCAPE}'s shape when its step runs pnpm --filter @storytree/website build from a multi-line run: | block: one problem names website.yml, job build, packages/website/src/build.ts:5 and WEBSITE_SHA`, async (t) => {
  const workflow = [
    `name: Publish website\n`,
    `on:\n  push:\n    branches: [main]\n`,
    `jobs:\n`,
    `  build:\n    runs-on: ubuntu-latest\n    steps:\n`,
    `      - uses: actions/checkout@v6\n`,
    `      - name: Install and build\n        run: |\n          pnpm install --frozen-lockfile\n\n          pnpm --filter @storytree/website build\n`,
    `      - uses: actions/upload-artifact@v7\n        with:\n          name: website-dist\n          path: dist/\n`,
    `  publish:\n    needs: build\n    runs-on: ubuntu-latest\n    env:\n      WEBSITE_SHA: \${{ github.sha }}\n    steps:\n`,
    `      - run: node scripts/publish.mjs\n`,
  ].join("");
  const problems = await problemsOf(t, { ...WEBSITE_FILES, ".github/workflows/website.yml": workflow });
  assert.equal(problems.length, 1, problems.join("\n"));
  assertNames(problems[0], { workflow: "website.yml", job: "build", at: BUILD_AT, variable: "WEBSITE_SHA" });
});

test(`8.30 · workflowEnvProblems refuses a fallback read of process.env.RELEASE_TAG nested inside an if whose condition is not on process.argv, when the job running node scripts/stamp.mjs lacks RELEASE_TAG and another job sets it: one problem at the read's line (${ESCAPE})`, async (t) => {
  const stamp = [
    `const verbose = process.argv.length > 3;`,
    `if (verbose) {`,
    `  const tag = process.env.RELEASE_TAG ?? "dev";`,
    `  console.log(tag);`,
    `}`,
    ``,
  ].join("\n");
  const release = [
    `name: Release\n`,
    `on: [push]\n`,
    `jobs:\n`,
    `  direct:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node scripts/stamp.mjs --verbose\n`,
    `  ship:\n    runs-on: ubuntu-latest\n    env:\n      RELEASE_TAG: \${{ github.ref_name }}\n    steps:\n      - run: node scripts/stamp.mjs\n`,
  ].join("");
  const problems = await problemsOf(t, { ...ROOT_FILES, "scripts/stamp.mjs": stamp, ".github/workflows/release.yml": release });
  assert.equal(problems.length, 1, problems.join("\n"));
  assertNames(problems[0], { workflow: "release.yml", job: "direct", at: "scripts/stamp.mjs:3", variable: "RELEASE_TAG" });
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

test(`8.30 · workflowEnvProblems follows a const bound from process.env.RELEASE_TAG by its own binding: the outer tag's tag ?? "dev" is the one problem, at its line, while a parameter tag and a block's let tag read with ?? or || in their own scopes are no read of RELEASE_TAG (${ESCAPE})`, async (t) => {
  const stamp = [
    `const tag = process.env.RELEASE_TAG;`,
    `function label(tag) {`,
    `  return tag ?? "none";`,
    `}`,
    `{`,
    `  let tag = "local";`,
    `  console.log(tag || "empty");`,
    `}`,
    `console.log(label("x"), tag ?? "dev");`,
    ``,
  ].join("\n");
  const release = [
    `name: Release\n`,
    `on: [push]\n`,
    `jobs:\n`,
    `  direct:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node scripts/stamp.mjs\n`,
    `  ship:\n    runs-on: ubuntu-latest\n    env:\n      RELEASE_TAG: \${{ github.ref_name }}\n    steps:\n      - run: node scripts/stamp.mjs\n`,
  ].join("");
  const problems = await problemsOf(t, { ...ROOT_FILES, "scripts/stamp.mjs": stamp, ".github/workflows/release.yml": release });
  assert.equal(problems.length, 1, problems.join("\n"));
  assertNames(problems[0], { workflow: "release.yml", job: "direct", at: "scripts/stamp.mjs:9", variable: "RELEASE_TAG" });
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

const INSTALL_ENTRY = "apps/desktop/check-install-mac.mjs";

const PACKAGED_APP = [
  `import { readFileSync } from "node:fs";`,
  `import path from "node:path";`,
  ``,
  `const packageFile = path.join(import.meta.dirname, "package.json");`,
  ``,
  `export function releaseVersion() {`,
  `  return process.env.STORYTREE_RELEASE_VERSION || JSON.parse(readFileSync(packageFile, "utf8")).version;`,
  `}`,
  ``,
].join("\n");

const CHECK_INSTALL_MAC = (from) => [
  `import { execFileSync } from "node:child_process";`,
  `import { releaseVersion } from "${from}";`,
  ``,
  `const version = releaseVersion();`,
  `execFileSync("hdiutil", ["attach", \`dist/Storytree-\${version}.dmg\`]);`,
  ``,
].join("\n");

const DESKTOP_FILES = {
  ...ROOT_FILES,
  "apps/desktop/package.json": JSON.stringify({ name: "@storytree/desktop", private: true, version: "0.3.0" }, null, 2),
  "apps/desktop/packaged-app.mjs": PACKAGED_APP,
  "apps/desktop/package-app.mjs": `import { releaseVersion } from "./packaged-app.mjs";\n\nconsole.log("packaging", releaseVersion());\n`,
  [INSTALL_ENTRY]: CHECK_INSTALL_MAC("./packaged-app.mjs"),
};

function releasePackageYml({ installEnv = "", installStepEnv = "" } = {}) {
  return [
    `name: Release package\n`,
    `on: [workflow_dispatch]\n`,
    `jobs:\n`,
    `  package:\n    runs-on: macos-latest\n    env:\n      STORYTREE_RELEASE_VERSION: \${{ github.ref_name }}\n    steps:\n`,
    `      - uses: actions/checkout@v6\n`,
    `      - run: node --import tsx apps/desktop/package-app.mjs\n`,
    `  install-mac:\n    needs: package\n    runs-on: macos-latest\n`,
    installEnv,
    `    steps:\n`,
    `      - uses: actions/checkout@v6\n`,
    `      - run: node --import tsx ${INSTALL_ENTRY}\n`,
    installStepEnv,
  ].join("");
}

const PACKAGED_AT = "apps/desktop/packaged-app.mjs:7";

function assertInstallMac(problems, at = PACKAGED_AT) {
  assert.equal(problems.length, 1, problems.join("\n"));
  assertNames(problems[0], { workflow: "release-package.yml", job: "install-mac", at, variable: "STORYTREE_RELEASE_VERSION" });
  assert.ok(problems[0].includes(INSTALL_ENTRY), `names the entry ${INSTALL_ENTRY}: ${problems[0]}`);
}

test(`8.34 · workflowEnvProblems follows ${INSTALL_ENTRY}'s import { releaseVersion } from "./packaged-app.mjs" to its process.env.STORYTREE_RELEASE_VERSION || read: with only the package job setting it, exactly one problem names release-package.yml, job install-mac, the entry, ${PACKAGED_AT}, STORYTREE_RELEASE_VERSION and ${ESCAPE}`, async (t) => {
  assertInstallMac(await problemsOf(t, { ...DESKTOP_FILES, ".github/workflows/release-package.yml": releasePackageYml() }));
});

test(`8.34 · workflowEnvProblems follows relative imports transitively, each file once: the entry imports ./install-version.mjs, which reaches packaged-app.mjs by import … from "./packaged-app.mjs", by export { releaseVersion } from "./packaged-app.mjs" or by export * from "./packaged-app.mjs", while packaged-app.mjs imports ./install-version.mjs back; each gives exactly one problem at packaged-app.mjs's read (${ESCAPE})`, async (t) => {
  const cyclic = `import "./install-version.mjs";\n${PACKAGED_APP}`;
  const variants = {
    "import then export": `import { releaseVersion } from "./packaged-app.mjs";\n\nexport { releaseVersion };\n`,
    "export from": `export { releaseVersion } from "./packaged-app.mjs";\n`,
    "export star": `export * from "./packaged-app.mjs";\n`,
  };
  for (const [variant, middle] of Object.entries(variants)) {
    const problems = await problemsOf(t, {
      ...DESKTOP_FILES,
      "apps/desktop/packaged-app.mjs": cyclic,
      "apps/desktop/install-version.mjs": middle,
      [INSTALL_ENTRY]: CHECK_INSTALL_MAC("./install-version.mjs"),
      ".github/workflows/release-package.yml": releasePackageYml(),
    });
    assert.equal(problems.length, 1, `${variant}:\n${problems.join("\n")}`);
    assertInstallMac(problems, "apps/desktop/packaged-app.mjs:8");
  }
});

test(`8.34 · workflowEnvProblems does not follow a bare package import: the entry's import { channel } from "@storytree/release-channel", whose packages/release-channel/index.mjs reads process.env.RELEASE_CHANNEL ?? "beta" that the package job sets, adds no problem beside the one at ${PACKAGED_AT} (${ESCAPE})`, async (t) => {
  const entry = `import { channel } from "@storytree/release-channel";\n${CHECK_INSTALL_MAC("./packaged-app.mjs")}console.log(channel);\n`;
  const workflow = releasePackageYml().replace("      STORYTREE_RELEASE_VERSION:", "      RELEASE_CHANNEL: stable\n      STORYTREE_RELEASE_VERSION:");
  const problems = await problemsOf(t, {
    ...DESKTOP_FILES,
    "packages/release-channel/package.json": JSON.stringify({ name: "@storytree/release-channel", private: true, type: "module", main: "index.mjs" }, null, 2),
    "packages/release-channel/index.mjs": `export const channel = process.env.RELEASE_CHANNEL ?? "beta";\n`,
    "node_modules/@storytree/release-channel/package.json": JSON.stringify({ name: "@storytree/release-channel", private: true, type: "module", main: "index.mjs" }, null, 2),
    "node_modules/@storytree/release-channel/index.mjs": `export const channel = process.env.RELEASE_CHANNEL ?? "beta";\n`,
    [INSTALL_ENTRY]: entry,
    ".github/workflows/release-package.yml": workflow,
  });
  assertInstallMac(problems);
  assert.ok(problems.every((problem) => !/\bRELEASE_CHANNEL\b/.test(problem)), problems.join("\n"));
});

test(`8.34 · workflowEnvProblems passes the install-mac job once it sets STORYTREE_RELEASE_VERSION in its job env or its step's env, and refuses it at ${PACKAGED_AT} without (${ESCAPE})`, async (t) => {
  const variants = {
    "job env": releasePackageYml({ installEnv: "    env:\n      STORYTREE_RELEASE_VERSION: ${{ github.ref_name }}\n" }),
    "step env": releasePackageYml({ installStepEnv: "        env:\n          STORYTREE_RELEASE_VERSION: ${{ github.ref_name }}\n" }),
  };
  for (const [variant, workflow] of Object.entries(variants)) {
    assert.deepEqual(await problemsOf(t, { ...DESKTOP_FILES, ".github/workflows/release-package.yml": workflow }), [], variant);
  }
  assertInstallMac(await problemsOf(t, { ...DESKTOP_FILES, ".github/workflows/release-package.yml": releasePackageYml() }));
});

test(`8.34 · workflowEnvProblems follows an extensionless relative import: the entry's import { releaseVersion } from "./packaged-app" reaches packaged-app.mjs, giving exactly one problem at ${PACKAGED_AT} (${ESCAPE})`, async (t) => {
  assertInstallMac(await problemsOf(t, {
    ...DESKTOP_FILES,
    [INSTALL_ENTRY]: CHECK_INSTALL_MAC("./packaged-app"),
    ".github/workflows/release-package.yml": releasePackageYml(),
  }));
});

test(`8.34 · workflowEnvProblems lints an entry whose relative imports name a missing ./generated/build-info.mjs and a ./release.json data file without throwing, reporting only the one problem at ${PACKAGED_AT} (${ESCAPE})`, async (t) => {
  const entry = `import "./generated/build-info.mjs";\nimport notes from "./release.json" with { type: "json" };\n${CHECK_INSTALL_MAC("./packaged-app.mjs")}console.log(notes);\n`;
  assertInstallMac(await problemsOf(t, {
    ...DESKTOP_FILES,
    "apps/desktop/release.json": JSON.stringify({ notes: "first release" }, null, 2),
    [INSTALL_ENTRY]: entry,
    ".github/workflows/release-package.yml": releasePackageYml(),
  }));
});
