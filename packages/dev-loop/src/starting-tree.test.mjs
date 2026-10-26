import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { scanTree, trackedFiles } from "./leak-scan.mjs";
import { buildStartingCommit } from "./starting-tree.mjs";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

test("11.3 · the starting commit is an orphan holding the ref's tree, option b without the evidence folders except a set a file outside them reads, and the leak scan reads it", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "starting-tree-"));
  t.after(() => removeTemp(root));
  const files = {
    "README.md": "storytree\n",
    "packages/a/src/view.test.ts": 'const seed = "../evidence/replay/seed.json";\n',
    "packages/a/evidence/replay/seed.json": "{}\n",
    "packages/a/evidence/run-1/notes.txt": `ran in ${["", "home", "jobloggs"].join("/")}\n`,
    "packages/b/evidence/clip.webm": "clip\n",
    // A library snapshot or code survey records old paths as data; naming a set there reads nothing.
    "packages/b/testing/replay/seed.json": '{"file":"packages/b/evidence/clip.webm"}\n',
    "packages/b/testing/replay/survey.json": '{"files":["packages/b/evidence/clip.webm"]}\n',
  };
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), body);
  }
  git(root, "init", "-q");
  git(root, "config", "user.name", "t");
  git(root, "config", "user.email", "t@example.com");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "one");
  writeFileSync(path.join(root, "README.md"), "storytree, twice\n");
  git(root, "commit", "-q", "-am", "two");

  const b = path.join(root, "..", `${path.basename(root)}-b`);
  t.after(() => removeTemp(b));
  const built = buildStartingCommit({ root, ref: "HEAD", option: "b", out: b });
  assert.deepEqual(built.kept, ["packages/a/evidence/replay"]);
  assert.equal(git(b, "rev-list", "--count", "--all"), "1", "one commit and no history");
  assert.equal(git(b, "rev-list", "--parents", "-n", "1", "main"), built.commit, "the commit has no parent");
  assert.deepEqual(trackedFiles(b), ["README.md", "packages/a/evidence/replay/seed.json", "packages/a/src/view.test.ts", "packages/b/testing/replay/seed.json", "packages/b/testing/replay/survey.json"]);
  assert.equal(git(b, "show", "main:README.md"), "storytree, twice");
  assert.deepEqual(scanTree(b, trackedFiles(b)), []);

  const a = path.join(root, "..", `${path.basename(root)}-a`);
  t.after(() => removeTemp(a));
  const all = buildStartingCommit({ root, ref: "HEAD", option: "a", out: a });
  assert.equal(all.files, 7);
  assert.equal(all.bytes, Object.values(files).reduce((total, body) => total + Buffer.byteLength(body), 0) + "storytree, twice\n".length - "storytree\n".length);
  assert.deepEqual(scanTree(a, trackedFiles(a)).map((found) => [found.file, found.counts]), [["packages/a/evidence/run-1/notes.txt", { "a Linux home folder": 1 }]]);
});
