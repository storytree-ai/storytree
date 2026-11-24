import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import * as evidenceCheck from "./evidence-check.mjs";
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
  assert.match(said, /storytree media attach <the note citing it> docs\/design\/rail\/approved\/look\.png --project <project>/, "an approved reference is sent to the library");

  git("update-ref", "-d", "refs/remotes/origin/main");
  assert.equal(checkEvidence({ root, ...capture }), 1, "a branch whose changes cannot be read fails");
  assert.match(lines.at(-1), /could not be read/);
});

test("1.13 · the commit check refuses a commit staging media check:evidence would refuse, naming the evidence bucket and its upload command, and passes inputs, deletions and media outside the evidence folders", (t) => {
  assert.equal(typeof evidenceCheck.checkStaged, "function", "evidence-check.mjs exports checkStaged");
  const root = mkdtempSync(path.join(tmpdir(), "evidence-staged-"));
  t.after(() => removeTemp(root));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q");
  git("config", "user.name", "t");
  git("config", "user.email", "t@example.com");
  write(root, "docs/design/rail/stills/old.png");
  write(root, "docs/design/rail/stills/kept.png");
  write(root, "packages/web/public/shot.png", "a shot moved later");
  git("add", ".");
  git("commit", "-q", "-m", "start");
  const logged = [];
  const errors = [];
  const capture = { log: (line) => logged.push(line), error: (line) => errors.push(line) };

  git("rm", "-q", "docs/design/rail/stills/old.png");
  write(root, "docs/design/rail/inputs/frame-1.png");
  write(root, "packages/web/evidence/seeded/seed.json.gz");
  write(root, "packages/web/public/icon.png");
  git("add", "docs/design/rail/inputs", "packages/web/evidence/seeded", "packages/web/public/icon.png");
  write(root, "docs/design/rail/retake/loose.png");
  write(root, "docs/design/rail/stills/kept.png", "re-taken, not staged");
  assert.equal(evidenceCheck.checkStaged({ root, ...capture }), 0, errors.join("\n"));
  assert.deepEqual(errors, [], "a commit staging no evidence media is not refused");

  write(root, "docs/design/x/tree.png");
  write(root, "docs/design/rail/approved/look.png");
  git("add", "docs/design/x/tree.png", "docs/design/rail/approved/look.png", "docs/design/rail/stills/kept.png");
  mkdirSync(path.join(root, "packages/web/evidence/moved"), { recursive: true });
  git("mv", "packages/web/public/shot.png", "packages/web/evidence/moved/shot.png");
  assert.equal(evidenceCheck.checkStaged({ root, ...capture }), 1);
  const said = errors.join("\n");
  for (const file of ["docs/design/x/tree.png", "docs/design/rail/stills/kept.png", "packages/web/evidence/moved/shot.png", "docs/design/rail/approved/look.png"]) assert.ok(said.includes(file), `${file} is named: ${said}`);
  for (const file of ["old.png", "frame-1.png", "seed.json.gz", "icon.png", "loose.png"]) assert.ok(!said.includes(file), `${file} is not named: ${said}`);
  assert.match(said, /evidence bucket/, "the refusal names where evidence goes");
  assert.match(said, /pnpm evidence:upload/, "the refusal names the upload command");
  assert.match(said, /storytree media attach .*docs\/design\/rail\/approved\/look\.png/, "an approved reference is sent to the library");
});

test("1.13 · the commit check fails when the staged changes cannot be read, saying so with git's own reason", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "evidence-staged-corrupt-"));
  t.after(() => removeTemp(root));
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeFileSync(path.join(root, ".git", "index"), "not an index");
  const errors = [];
  assert.equal(evidenceCheck.checkStaged({ root, log: () => {}, error: (line) => errors.push(line) }), 1);
  assert.match(errors.join("\n"), /staged changes could not be read \((?!Command failed)\S/, "the reason given is git's own, not node's wrapper around the failed command");
});
