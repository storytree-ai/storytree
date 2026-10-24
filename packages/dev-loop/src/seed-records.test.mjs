import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";

import { removeTemp } from "@storytree/test-waits";

import { seedFilesFor, seedRecordProblems } from "./seed-records.mjs";

function folder(t, files) {
  const root = mkdtempSync(path.join(tmpdir(), "seed-records-"));
  t.after(() => removeTemp(root));
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), body);
  }
  return root;
}

test("7.10 · the gate's seed check reads each seed or snapshot file the branch changes, gzipped or not, and refuses one holding a work record or a redaction pattern, naming the file", (t) => {
  const dirty = JSON.stringify({ changes: { changes: [{ recordId: "increment_a", type: "increment", record: { id: "increment_a", type: "increment", fields: {} } }] } });
  const clean = JSON.stringify({ tree: { stories: [{ id: "story_a", title: "The library" }] } });
  const root = folder(t, {
    "packages/forest/src/view/evidence/a/seed.json.gz": gzipSync(dirty),
    "packages/forest/src/view/evidence/b/seed.json": clean,
    "packages/forest/src/view/evidence/c/investigation-seed.json": JSON.stringify({ note: "ran on winlap" }),
    "packages/website/src/forest-snapshot.json": clean,
    "packages/forest/src/view/evidence/a/survey.json": dirty,
  });
  const changed = ["packages/forest/src/view/evidence/a/seed.json.gz", "packages/forest/src/view/evidence/a/survey.json", "packages/forest/src/view/evidence/b/seed.json",
    "packages/forest/src/view/evidence/c/investigation-seed.json", "packages/website/src/forest-snapshot.json", "packages/gone/seed.json"];
  const files = seedFilesFor(root, () => changed);
  assert.deepEqual(files, ["packages/forest/src/view/evidence/a/seed.json.gz", "packages/forest/src/view/evidence/b/seed.json", "packages/forest/src/view/evidence/c/investigation-seed.json", "packages/website/src/forest-snapshot.json"]);
  const problems = seedRecordProblems(root, files);
  assert.equal(problems.length, 2, problems.join("\n"));
  assert.match(problems[0], /a\/seed\.json\.gz holds an increment record/);
  assert.match(problems[1], /investigation-seed\.json carries a machine name/);
  assert.deepEqual(seedRecordProblems(root, seedFilesFor(root, () => ["packages/forest/src/view/evidence/b/seed.json"])), []);
});
