import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { checkEvidence } from "./evidence-check.mjs";

function write(root, file, text = "bytes") {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
}

test("1.7 · check:evidence refuses a branch that adds or changes evidence media or an approved reference against origin/main, and passes inputs, deletions, media outside the evidence folders and pictures a capture left untracked", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "evidence-check-"));
  t.after(() => removeTemp(root));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q");
  git("config", "user.name", "t");
  git("config", "user.email", "t@example.com");
  write(root, "docs/design/rail/stills/old.png");
  write(root, "packages/web/evidence/gone/clip.webm");
  git("add", ".");
  git("commit", "-q", "-m", "main");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  const lines = [];
  const capture = { log: (line) => lines.push(line), error: (line) => lines.push(line) };

  rmSync(path.join(root, "packages/web/evidence/gone/clip.webm"));
  write(root, "packages/web/evidence/seeded/seed.json.gz");
  write(root, "docs/design/rail/inputs/frame-1.png");
  write(root, "packages/mark/icons/day/mark.png");
  write(root, "docs/design/rail/README.md", "# Rail\n");
  write(root, "docs/design/rail/retake/untracked.png");
  write(root, "packages/web/evidence/retake/untracked.webm");
  assert.equal(checkEvidence({ root, ...capture }), 0, lines.join("\n"));

  write(root, "docs/design/rail/stills/old.png", "re-taken");
  write(root, "docs/design/rail/stills/new.png");
  write(root, "packages/web/evidence/live/trace.json.gz");
  write(root, "apps/desktop/evidence/clip.webm");
  write(root, "docs/design/rail/approved/look.png");
  git("add", "docs/design/rail/stills", "packages/web/evidence/live", "docs/design/rail/approved");
  git("commit", "-q", "-m", "branch");
  git("add", "apps/desktop/evidence/clip.webm");
  assert.equal(checkEvidence({ root, ...capture }), 1);
  const said = lines.at(-1);
  assert.ok(!said.includes("untracked"), `a picture the branch does not track is not named: ${said}`);
  for (const file of ["docs/design/rail/stills/old.png", "docs/design/rail/stills/new.png", "packages/web/evidence/live/trace.json.gz", "apps/desktop/evidence/clip.webm"]) assert.ok(said.includes(file), said);
  assert.ok(!said.includes("seed.json.gz") && !said.includes("frame-1.png"), said);
  assert.match(said, /pnpm evidence:upload --pr/, "the refusal says where the evidence goes instead");
  assert.match(said, /storytree media attach <the note citing it> docs\/design\/rail\/approved\/look\.png/, "an approved reference is sent to the library");

  git("update-ref", "-d", "refs/remotes/origin/main");
  assert.equal(checkEvidence({ root, ...capture }), 1, "a branch whose changes cannot be read fails");
  assert.match(lines.at(-1), /could not be read/);
});
