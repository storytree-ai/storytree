import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import fsPromises, { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { mock, test } from "node:test";
import { Worker } from "node:worker_threads";

import { removeTemp } from "@storytree/test-waits";

import type { AnnotatedTree } from "@storytree/library";
import { capabilitiesCommand, incrementOfBranch, mapCommand } from "./read.js";

test("3.4 the map command reads the current plan and survey and exposes counts, dry-run, show and refusal as text or JSON", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "map-command-"));
  try {
    await mkdir(path.join(folder, "packages/app/src"), { recursive: true });
    await writeFile(path.join(folder, "packages/app/src/view.ts"), "export const view = 1;");
    await writeFile(path.join(folder, "packages/app/src/view.test.ts"), 'import { view } from "./view.js"; test("2.5 empty view", () => view);');
    const health = { reported: { state: "not-checked" }, verified: { state: "passing" } };
    const plan = { arcs: [], stories: [{ id: "app", title: "The app", health, capabilities: [{ id: "projects", title: "2 · Projects", health, dependsOn: [], contracts: [{ id: "empty", title: "2.5 empty view", health }] }] }] } as unknown as AnnotatedTree;
    const library = { projectTree: async () => plan };
    for (const mode of ["counts", "dry_run", "show"] as const) {
      const options = { select: "file:packages/app/src/view.ts", up: 1, mode };
      const json = JSON.parse(await mapCommand(library, folder, options, true));
      const text = await mapCommand(library, folder, options);
      assert.equal(json.rowCount, 4);
      assert.match(text, /4 rows/);
      assert.equal(json.rows !== undefined, mode === "show");
      if (mode === "show") assert.ok(json.rows.some((row: { id: string }) => row.id === "empty"));
    }
    plan.stories[0]!.capabilities[0]!.contracts = Array.from({ length: 201 }, (_, n) => ({ id: `promise-${n}`, title: `2.${n + 1} promise`, health: health as never }));
    const options = { select: "cap:projects", down: 1, mode: "show" as const };
    const refused = JSON.parse(await mapCommand(library, folder, options, true));
    assert.equal(refused.refused, true);
    assert.equal(refused.rows, undefined);
    assert.match(await mapCommand(library, folder, options), /Show refused/);
  } finally {
    await removeTemp(folder);
  }
});

test("3.6 in a branch's checkout the map reads the plan with that branch's increment's pending changes laid over; elsewhere the live plan", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "map-branch-"));
  try {
    await mkdir(path.join(folder, "packages/app/src"), { recursive: true });
    await writeFile(path.join(folder, "packages/app/src/view.ts"), "export const view = 1;");
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: folder, stdio: "pipe" });
    git("init", "-q", "-b", "main");
    git("add", "-A");
    git("commit", "-qm", "base");
    const health = { reported: { state: "not-checked" }, verified: { state: "passing" } };
    const capability = { id: "projects", title: "2 · Projects", health, dependsOn: [], contracts: [{ id: "empty", title: "2.5 empty view", health }] };
    const live = { arcs: [], stories: [{ id: "app", title: "The app", health, capabilities: [capability] }] } as unknown as AnnotatedTree;
    const pending = { arcs: [], stories: [{ id: "app", title: "The app", health, capabilities: [{ ...capability, contracts: [] }] }] } as unknown as AnnotatedTree;
    const library = { projectTree: async (options?: { pendingOf?: string | undefined }) => (options?.pendingOf === "increment_ca8ba53211b7" ? pending : live) };
    const promises = async (): Promise<number> => {
      const answer = JSON.parse(await mapCommand(library, folder, { select: "cap:projects", down: 1, mode: "show" }, true));
      return answer.rows.filter((row: { kind: string }) => row.kind === "promise").length;
    };
    assert.equal(await promises(), 1, "main reads the live plan");
    git("checkout", "-q", "-b", "claude/increment-ca8ba53211b7-f8f424");
    assert.equal(await promises(), 0, "the increment's branch reads its pending retirement");
    assert.equal(incrementOfBranch("claude/dazzling-jones-f96c61"), undefined);
  } finally {
    await removeTemp(folder);
  }
});

test("3.11 with --capabilities, the map answers a selected story's capabilities in one read: each with its health word and reason, its contracts, the capabilities it depends on, and its source files with their lines of code, tests left out; --json gives it as data", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "map-capabilities-"));
  try {
    await mkdir(path.join(folder, "packages/app/src"), { recursive: true });
    await writeFile(path.join(folder, "packages/app/src/view.ts"), "export const view = 1;\n\nexport const more = 2;\n");
    await writeFile(path.join(folder, "packages/app/src/view.test.ts"), 'import { view } from "./view.js"; test("2.5 empty view", () => view);');
    await writeFile(path.join(folder, "packages/app/src/lone.ts"), "export const lone = 1;\n");
    const health = { reported: { state: "not-checked" }, verified: { state: "passing" } };
    const why = { reason: "no test names it", mover: "agent", contracts: ["save"] };
    const plan = { arcs: [], stories: [{ id: "app", title: "The app", health, capabilities: [
      { id: "projects", title: "2 · Projects", health, status: "healthy", dependsOn: ["saving"], contracts: [{ id: "empty", title: "2.5 · empty view", health }] },
      { id: "saving", title: "3 · Saving", health, status: "untested", why, dependsOn: [], contracts: [{ id: "save", title: "3.1 · saves", health }] },
    ] }] } as unknown as AnnotatedTree;
    const library = { projectTree: async () => plan };

    const data = JSON.parse(await capabilitiesCommand(library, folder, "story:The app", true));

    assert.deepEqual(data, {
      story: { id: "app", title: "The app" },
      capabilities: [
        { id: "projects", title: "2 · Projects", health: "healthy", dependsOn: ["saving"], contracts: [{ id: "empty", number: "2.5", title: "2.5 · empty view" }], files: [{ path: "packages/app/src/view.ts", lines: 2 }], lines: 2 },
        { id: "saving", title: "3 · Saving", health: "untested", why, dependsOn: [], contracts: [{ id: "save", number: "3.1", title: "3.1 · saves" }], files: [], lines: 0 },
      ],
      unclaimed: [{ path: "packages/app/src/lone.ts", lines: 1 }],
    });
    const text = await capabilitiesCommand(library, folder, "app");
    assert.match(text, /2 · Projects  \[projects\]  healthy; 2 lines in 1 file; 1 contract; depends on saving/);
    assert.match(text, /3 · Saving  \[saving\]  untested — no test names it, the agent's to move: 3\.1; 0 lines in 0 files/);
    assert.match(text, /packages\/app\/src\/view\.ts  2/);
    assert.match(text, /\n  Unclaimed: 1 line in 1 file\n    packages\/app\/src\/lone\.ts  1$/);
    await assert.rejects(capabilitiesCommand(library, folder, "story:Nothing"), /Map selection not found: story:Nothing/);
  } finally {
    await removeTemp(folder);
  }
});

test("3.13 a new process's map or diff focus on an unchanged Git checkout parses no file of it, and diff focus shares the map's reading", async () => {
  // By its real path, as Git names the checkout: a temporary folder can sit behind a link (macOS) or a short name (Windows).
  const folder = realpathSync.native(await mkdtemp(path.join(tmpdir(), "map-new-process-")));
  const health = { reported: { state: "not-checked" }, verified: { state: "passing" } };
  const plan = { arcs: [], stories: [{ id: "app", title: "The app", health, capabilities: [{ id: "projects", title: "2 · Projects", health, dependsOn: [], contracts: [{ id: "empty", title: "2.5 empty view", health }] }] }] };
  // Each start is a fresh worker thread, with its own copy of every module: it counts the checkout's files it reads,
  // its Git directory left out, through a map and then a diff focus.
  const script = path.join(await mkdtemp(path.join(tmpdir(), "map-new-process-script-")), "start.mjs");
  await writeFile(script, `
      import { parentPort, workerData } from "node:worker_threads";
      import fs from "node:fs/promises";
      import { syncBuiltinESMExports } from "node:module";
      import path from "node:path";
      const { folder, plan, module } = workerData;
      const read = [];
      const readFile = fs.readFile;
      fs.readFile = (file, ...rest) => {
        if (typeof file === "string" && file.startsWith(folder) && !file.startsWith(path.join(folder, ".git"))) read.push(file);
        return readFile(file, ...rest);
      };
      syncBuiltinESMExports();
      import(module).then(async ({ mapCommand }) => {
        const library = { projectTree: async () => plan };
        const answers = [];
        answers.push(await mapCommand(library, folder, { select: "file:packages/app/src/view.ts", up: 1, mode: "show" }, true));
        const map = read.length;
        answers.push(await mapCommand(library, folder, { select: "diff:HEAD", up: 1, mode: "show" }, true));
        parentPort.postMessage({ answers, read: [map, read.length - map] });
      }, (error) => parentPort.postMessage({ error: String(error) }));
  `);
  const start = () => new Promise<{ answers: string[]; read: number[] }>((resolve, reject) => {
    const worker = new Worker(script, { execArgv: ["--import", "tsx"], workerData: { folder, plan, module: new URL("./read.ts", import.meta.url).href } });
    worker.once("message", (said: { error?: string; answers: string[]; read: number[] }) => {
      void worker.terminate();
      if (said.error === undefined) resolve(said);
      else reject(new Error(said.error));
    });
    worker.once("error", reject);
  });
  try {
    await mkdir(path.join(folder, "packages/app/src"), { recursive: true });
    await writeFile(path.join(folder, "packages/app/src/view.ts"), "export const view = 1;");
    await writeFile(path.join(folder, "packages/app/src/view.test.ts"), 'import { view } from "./view.js"; test("2.5 empty view", () => view);');
    const git = (...args: string[]) => execFileSync("git", args, { cwd: folder, stdio: "pipe", windowsHide: true });
    git("init", "-q", "-b", "main");
    git("add", ".");
    git("-c", "user.name=Map test", "-c", "user.email=map@example.test", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "fixture");

    const first = await start();
    assert.deepEqual(first.read, [2, 0], "the first start reads its files once, and its diff focus reads the map's reading");
    const again = await start();
    assert.deepEqual(again.read, [0, 0], "a new process on an unchanged checkout parses no file of it");
    assert.deepEqual(again.answers, first.answers);
  } finally {
    await removeTemp(folder);
    await removeTemp(path.dirname(script));
  }
});

test("3.12 a repeat map or focus on an unchanged checkout reads and parses no file; a changed file is read again", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "map-repeat-"));
  // Every file the survey reads from disk goes through fs/promises' readFile: count those in this checkout.
  const read: string[] = [];
  const readFile = fsPromises.readFile;
  mock.method(fsPromises, "readFile", (file: unknown, ...rest: unknown[]) => {
    if (typeof file === "string" && file.startsWith(folder)) read.push(file);
    return (readFile as (...args: unknown[]) => unknown)(file, ...rest);
  });
  syncBuiltinESMExports();
  try {
    await mkdir(path.join(folder, "packages/app/src"), { recursive: true });
    await writeFile(path.join(folder, "packages/app/src/view.ts"), "export const view = 1;");
    await writeFile(path.join(folder, "packages/app/src/view.test.ts"), 'import { view } from "./view.js"; test("2.5 empty view", () => view);');
    const health = { reported: { state: "not-checked" }, verified: { state: "passing" } };
    const plan = { arcs: [], stories: [{ id: "app", title: "The app", health, capabilities: [{ id: "projects", title: "2 · Projects", health, dependsOn: [], contracts: [{ id: "empty", title: "2.5 empty view", health }] }] }] } as unknown as AnnotatedTree;
    const library = { projectTree: async () => plan };
    const options = { select: "file:packages/app/src/view.ts", up: 1, mode: "show" as const };

    const first = await mapCommand(library, folder, options, true);
    assert.equal(read.length, 2);
    read.length = 0;
    assert.equal(await mapCommand(library, folder, options, true), first);
    await capabilitiesCommand(library, folder, "story:The app");
    assert.deepEqual(read, [], "a repeat ask of an unchanged checkout reads no file");

    await writeFile(path.join(folder, "packages/app/src/view.ts"), "export const view = 1;\nexport const more = 2;\n");
    await mapCommand(library, folder, options, true);
    assert.deepEqual(read, [path.join(folder, "packages/app/src/view.ts")]);
  } finally {
    mock.restoreAll();
    syncBuiltinESMExports();
    await removeTemp(folder);
  }
});
