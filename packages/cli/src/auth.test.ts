/** Keys 1.5: `storytree auth` saves a key from standard input, lists names only, and removes one, offline (ADR-0843). */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { BuiltCommand, storytree } from "./testing/cli.js";

const command = new BuiltCommand();
before(() => command.build());
after(() => command.remove());

test("keys 1.5: auth set reads the value from standard input, auth list names each key and where it resolves from, auth remove deletes it", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-auth-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, "home");
  const env = { GH_TOKEN: "gh-from-env", ANTHROPIC_API_KEY: "" };
  const invoke = (args: string[], input?: string) => storytree(command.script, args, { cwd: dir, home, env, ...(input === undefined ? {} : { input }) });

  const set = await invoke(["auth", "set", "anthropic"], "sk-secret-value\n");
  assert.equal(set.code, 0, set.stderr);
  assert.doesNotMatch(set.stdout + set.stderr, /sk-secret-value/);
  assert.deepEqual(JSON.parse(readFileSync(path.join(home, "auth.json"), "utf8")), { anthropic: { key: "sk-secret-value" } });

  const command_ = await invoke(["auth", "set", "vault"], "!op read op://vault/item\n");
  assert.equal(command_.code, 0, command_.stderr);

  const list = await invoke(["auth", "list"]);
  assert.equal(list.code, 0, list.stderr);
  assert.match(list.stdout, /anthropic.*file/);
  assert.match(list.stdout, /vault.*command/);
  assert.match(list.stdout, /github.*environment.*GH_TOKEN/);
  assert.doesNotMatch(list.stdout, /sk-secret-value|op:\/\/|gh-from-env/);

  const argument = await invoke(["auth", "set", "anthropic", "sk-on-the-command-line"]);
  assert.equal(argument.code, 2, argument.stderr);
  assert.match(argument.stderr, /standard input/);

  const removed = await invoke(["auth", "remove", "anthropic"]);
  assert.equal(removed.code, 0, removed.stderr);
  assert.doesNotMatch((await invoke(["auth", "list"])).stdout, /anthropic/);
  const again = await invoke(["auth", "remove", "anthropic"]);
  assert.equal(again.code, 1);
  assert.match(again.stderr, /anthropic/);
});
