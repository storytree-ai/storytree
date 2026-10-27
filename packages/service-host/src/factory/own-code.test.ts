/** Capability 4 · Keeping the factory current, contract 4.4: the version of the host's own code, on a throwaway checkout. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { git } from "../testing/factory-repo.js";
import { ownCodeVersion } from "./own-code.js";

test("4.4 · the host's own code is its package and the workspace packages it stands on, as the checkout's HEAD holds them: a commit to one of them moves it, a commit elsewhere or an uncommitted edit does not", (t) => {
  const top = realpathSync(mkdtempSync(path.join(tmpdir(), "storytree-own-code-")));
  t.after(() => removeTemp(top));
  const write = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(top, file)), { recursive: true });
    writeFileSync(path.join(top, file), text);
  };
  write(".gitignore", "node_modules/\n");
  write("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  write("packages/host/package.json", JSON.stringify({ name: "host", dependencies: { "@x/dep": "workspace:*" } }));
  write("packages/dep/package.json", JSON.stringify({ name: "@x/dep" }));
  write("packages/dep/index.js", "export const one = 1;\n");
  write("packages/unrelated/index.js", "export const two = 2;\n");
  mkdirSync(path.join(top, "packages/host/node_modules/@x"), { recursive: true });
  symlinkSync(path.join(top, "packages/dep"), path.join(top, "packages/host/node_modules/@x/dep"), "junction");
  git(top, "init", "-q", "-b", "main");
  const commit = () => { git(top, "add", "-A"); git(top, "commit", "-q", "-m", "a change"); };
  commit();
  const host = path.join(top, "packages", "host");

  const began = ownCodeVersion(host);
  assert.match(began ?? "", /^[0-9a-f]{12}$/);
  write("packages/unrelated/index.js", "export const two = 3;\n");
  commit();
  assert.equal(ownCodeVersion(host), began, "a commit outside the host's packages does not move it");
  write("packages/dep/index.js", "export const one = 2;\n");
  assert.equal(ownCodeVersion(host), began, "an edit not committed does not move it");
  commit();
  const moved = ownCodeVersion(host);
  assert.notEqual(moved, began, "a commit to a package the host stands on moves it");
  write("pnpm-lock.yaml", "lockfileVersion: '9.0'\n# changed\n");
  commit();
  assert.notEqual(ownCodeVersion(host), moved, "a lockfile change moves it");
  assert.equal(ownCodeVersion(path.join(tmpdir())), undefined, "a folder in no checkout has no version");
});
