/** Capability 1 · Project libraries: whether this code's project schema is merged, read from its checkout. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { schemaMerged } from "./schema-merged.js";

test("1.29 · the schema counts as merged outside a checkout or in a bundle, or when its last change is on origin/main with nothing uncommitted", async () => {
  const folder = mkdtempSync(path.join(tmpdir(), "schema-merged-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", folder, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const file = path.join(folder, "schema.ts");
  const commit = (text: string) => {
    writeFileSync(file, text);
    git("add", "schema.ts");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", text);
  };
  const notMerged = (why: RegExp, what?: string) => {
    const standing = schemaMerged(file);
    assert.equal(standing.merged, false, what);
    assert.match(standing.merged ? "" : standing.why, why, what);
  };
  try {
    writeFileSync(file, "a");
    assert.deepEqual(schemaMerged(file), { merged: true }, "released code, outside a checkout");
    assert.deepEqual(schemaMerged(path.join(folder, "gone.ts")), { merged: true }, "a bundle, with no schema file on disk");

    git("init", "-q", "-b", "work");
    notMerged(/not committed/);
    writeFileSync(path.join(folder, ".gitignore"), "dist/\n");
    mkdirSync(path.join(folder, "dist"));
    writeFileSync(path.join(folder, "dist", "main.mjs"), "a");
    assert.deepEqual(schemaMerged(path.join(folder, "dist", "main.mjs")), { merged: true }, "a bundle built into a folder its checkout ignores");
    commit("a");
    notMerged(/origin\/main cannot be read/);
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    assert.deepEqual(schemaMerged(file), { merged: true }, "its last change is on origin/main");

    writeFileSync(file, "ab");
    notMerged(/uncommitted/);
    commit("ab");
    notMerged(/not on origin\/main/, "a branch's own commit");

    writeFileSync(path.join(folder, "other.ts"), "x");
    git("add", "other.ts");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "other");
    git("update-ref", "refs/remotes/origin/main", "HEAD~1");
    assert.deepEqual(schemaMerged(file), { merged: true }, "main holds the schema change, and the branch has moved on in other files");
  } finally {
    await removeTemp(folder);
  }
});
