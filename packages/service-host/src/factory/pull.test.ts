// Capability 4 · Keeping the factory current
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { factoryRepo, git } from "../testing/factory-repo.js";
import { pullFactory, type Install } from "./pull.js";

const PLUGINS = { "plugins/my-voice/package.json": "{}\n", "plugins/my-echo/package.json": "{}\n" };

test("4.1 · Given the factory clone is behind origin/main, when the host's 15-minute cadence comes round, then it fast-forwards the clone to origin/main, and then it reinstalls only if the lockfile changed; when that install fails, then the host puts HEAD back where it was, keeps the running services on their code, and says why; when the clone moves, then the pull names the plugins the move changed", async (t) => {
  const repo = factoryRepo(t, PLUGINS);
  const installs: string[] = [];
  const install: Install = async (folder) => { installs.push(folder); };

  const head = git(repo.clone, "rev-parse", "HEAD");
  assert.deepEqual(await pullFactory(repo.clone, install), { updated: true, moved: false, head }, "a clone already at main does not move");

  const moved = repo.push({ "plugins/my-voice/services.js": "export const listen = {};\n" });
  assert.deepEqual(await pullFactory(repo.clone, install), { updated: true, moved: true, from: head, to: moved, reinstalled: false, plugins: ["my-voice"] });
  assert.equal(git(repo.clone, "rev-parse", "HEAD"), moved, "the clone is at origin's main");
  assert.deepEqual(installs, [], "no install without a lockfile change");

  const locked = repo.push({ "pnpm-lock.yaml": "lockfileVersion: '9.0'\n# changed\n" });
  const pulled = await pullFactory(repo.clone, install);
  assert.equal(pulled.updated && pulled.moved && pulled.reinstalled, true, "a lockfile change reinstalls");
  assert.deepEqual(installs, [repo.clone], "the clone itself is installed");
  assert.equal(git(repo.clone, "rev-parse", "HEAD"), locked);

  const broken = repo.push({ "pnpm-lock.yaml": "lockfileVersion: '9.0'\n# broken\n", "plugins/my-echo/services.js": "export const listen = {};\n" });
  await assert.rejects(pullFactory(repo.clone, async () => { throw new Error("no such package"); }), { message: `the install for ${broken.slice(0, 12)} failed, so the factory is back at ${locked.slice(0, 12)}: no such package` });
  assert.equal(git(repo.clone, "rev-parse", "HEAD"), locked, "a failed install puts HEAD back");
  assert.equal(git(repo.clone, "status", "--porcelain"), "", "and leaves the clone clean, so the next pull tries the same move again");
});

test("4.2 · Given the factory clone is off main or its working tree is not clean, when the host's cadence comes round, then the host leaves the clone alone and says the factory was not updated, with the reason", async (t) => {
  const repo = factoryRepo(t, PLUGINS);
  const head = git(repo.clone, "rev-parse", "HEAD");
  repo.push({ "plugins/my-voice/services.js": "export const listen = {};\n" });
  const install: Install = async () => { throw new Error("no install is expected"); };

  git(repo.clone, "checkout", "-q", "-b", "editing");
  assert.deepEqual(await pullFactory(repo.clone, install), { updated: false, reason: "the clone is on editing, not main" });
  assert.equal(git(repo.clone, "rev-parse", "HEAD"), head);

  git(repo.clone, "checkout", "-q", "main");
  const manifest = path.join(repo.clone, "plugins", "my-voice", "package.json");
  writeFileSync(manifest, "{ \"edited\": true }\n");
  assert.deepEqual(await pullFactory(repo.clone, install), { updated: false, reason: "the clone has changes not committed (1 path)" });
  assert.equal(git(repo.clone, "rev-parse", "HEAD"), head);
  assert.equal(readFileSync(manifest, "utf8"), "{ \"edited\": true }\n", "the edit is left as it was");

  const plain = realpathSync(mkdtempSync(path.join(tmpdir(), "storytree-factory-plain-")));
  t.after(() => removeTemp(plain));
  assert.deepEqual(await pullFactory(plain, install), { updated: false, reason: `${plain} is not a git clone` });
});
