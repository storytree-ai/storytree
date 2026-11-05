import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { build, type BuildOptions } from "esbuild";
import { removeTemp } from "@storytree/test-waits";

import { buildCommit, mainBuild, preloadBuild } from "./bundles.js";

const dist = path.join(tmpdir(), "storytree-bundles");

/** One bundle built in memory, with the modules it leaves outside it. */
async function bundled(options: BuildOptions): Promise<{ text: string; outside: Set<string> }> {
  const result = await build({ ...options, write: false, metafile: true, logLevel: "silent" });
  const output = result.outputFiles.find((file) => file.path.endsWith(".cjs"))!;
  const outside = new Set(Object.values(result.metafile.outputs).flatMap((out) => out.imports.filter((one) => one.external).map((one) => one.path)));
  return { text: output.text, outside };
}

/** Run a CommonJS bundle as Electron would, with `electron` answered by a stand-in. */
function run(text: string, electron: object): Record<string, unknown> {
  const real = createRequire(import.meta.url);
  const module = { exports: {} as Record<string, unknown> };
  new Function("require", "module", "exports", "__filename", "__dirname", text)((id: string) => id === "electron" ? electron : real(id), module, module.exports, path.join(dist, "bundle.cjs"), dist);
  return module.exports;
}

const isNodes = (name: string) => name.startsWith("node:") || builtinModules.includes(name);

test("4.37 · the main process bundles whole into main.cjs: it loads nothing from outside it but Node's own modules, Electron and the optional modules it never loads or loads lazily, so a packaged app needs no node_modules", { timeout: 120_000 }, async () => {
  const { outside } = await bundled({ ...mainBuild(dist), entryPoints: [fileURLToPath(new URL("./main.ts", import.meta.url))] });
  const optional = [
    "electron", "pg-native", "pg-cloudflare", "cloudflare:sockets", "@google-cloud/cloud-sql-connector", "google-auth-library", "@huggingface/transformers",
    // Native helpers ws tries to load and the proxy agent loads lazily, each done without when it is not there.
    "bufferutil", "utf-8-validate", "kerberos",
  ];
  assert.deepEqual([...outside].filter((name) => !isNodes(name) && !optional.includes(name)), []);
  assert.ok(outside.has("electron"));
});

test("8.10 · the preload script, bundled as the app bundles it, gives the page the bridge as `storytree` and nothing else, with the main process's answers on sign-in for feedback and stand-ins", { timeout: 60_000 }, async () => {
  const { text, outside } = await bundled({ ...preloadBuild(dist), entryPoints: [fileURLToPath(new URL("../preload/preload.ts", import.meta.url))] });
  assert.deepEqual([...outside].filter((name) => !isNodes(name)), ["electron"]);
  const opened = (answers: Record<string, unknown>) => {
    const exposed: Record<string, Record<string, unknown>> = {};
    const invoked: unknown[][] = [];
    run(text, {
      contextBridge: { exposeInMainWorld: (name: string, api: Record<string, unknown>) => { exposed[name] = api; } },
      ipcRenderer: { sendSync: (channel: string) => answers[channel], invoke: async (...args: unknown[]) => { invoked.push(args); } },
    });
    return { exposed, invoked };
  };
  const views = [{ part: "keys", title: "Keys", url: "storytree-plugin://keys/index.html" }];
  const offered = opened({ "storytree:page-stand-ins": { channels: [{ askKeys: "keys:ask" }], views } });
  assert.deepEqual(Object.keys(offered.exposed), ["storytree"]);
  const bridge = offered.exposed.storytree!;
  assert.equal(bridge.feedbackIdentity, undefined, "a build the main process says offers no sign-in gives the page none");
  assert.deepEqual(bridge.pluginViews, views);
  await (bridge.askKeys as (...args: unknown[]) => Promise<unknown>)("one");
  assert.deepEqual(offered.invoked, [["keys:ask", "one"]], "a stand-in's channel is the main process's to answer");

  const { FEEDBACK_IDENTITY_OFFERED } = await import("@storytree/app-setup/bridge");
  const signIn = opened({ [FEEDBACK_IDENTITY_OFFERED]: true });
  assert.equal(typeof signIn.exposed.storytree!.feedbackIdentity, "object");
  assert.deepEqual(signIn.exposed.storytree!.pluginViews, []);
});

test("4.39 · a packaged build names the commit its checkout had when it was bundled, in its label from the first moment, so each main-process error it records points at that commit", { timeout: 60_000 }, async (t) => {
  const checkout = mkdtempSync(path.join(tmpdir(), "storytree-build-commit-"));
  t.after(() => removeTemp(checkout));
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const git = (...args: string[]) => execFileSync("git", ["-C", checkout, "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", env }).trim();
  git("init", "--quiet");
  git("commit", "--quiet", "--allow-empty", "-m", "a commit");
  const head = git("rev-parse", "HEAD");
  assert.equal(buildCommit(checkout), head);
  assert.equal(buildCommit(path.join(checkout, "..", "no-such-checkout")), undefined, "a build from no checkout names no commit");

  const label = async (commit: string | null) => {
    const { text } = await bundled({ ...mainBuild(dist, undefined, commit), entryPoints: [fileURLToPath(new URL("./packaged-build.ts", import.meta.url))] });
    return (run(text, {}) as { packagedBuild: (version: string) => string }).packagedBuild("0.3.2001");
  };
  assert.equal(await label(head), `version 0.3.2001 (commit ${head.slice(0, 7)})`);
  assert.equal(await label(null), "version 0.3.2001");
  const app = execFileSync("git", ["rev-parse", "HEAD"], { cwd: import.meta.dirname, encoding: "utf8" }).trim();
  assert.equal(mainBuild(dist).define.STORYTREE_BUILD_COMMIT, JSON.stringify(app), "the app's own build is stamped with its checkout's commit");
});

test("4.10 · in a copy that does not install releases, the main process makes no updater, so an update request can neither fetch a build nor restart the app", { timeout: 120_000 }, async (t) => {
  const home = mkdtempSync(path.join(tmpdir(), "storytree-releases-"));
  t.after(() => removeTemp(home));
  const { text } = await bundled({ ...mainBuild(dist), entryPoints: [fileURLToPath(new URL("./releases.ts", import.meta.url))] });
  const quitting: unknown[] = [];
  const app = { isPackaged: false, getAppPath: () => home, commandLine: { hasSwitch: () => false }, once: (...args: unknown[]) => { quitting.push(args); } };
  const releases = run(text, { app }) as {
    followReleases: (options: object, home: string, choice: () => unknown) => unknown;
    installedApp: () => boolean;
    releasesInstall: () => boolean;
  };
  assert.equal(releases.installedApp(), false);
  assert.equal(releases.releasesInstall(), false);
  assert.equal(releases.followReleases({}, home, () => "ask"), undefined);
  assert.deepEqual(quitting, [], "nothing checks for releases until the app quits");
});
