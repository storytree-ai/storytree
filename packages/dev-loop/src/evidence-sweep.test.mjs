// A closed arc's evidence recordings leave main (ADR-1123 D1): the rules live in
// packages/dev-loop/src/evidence-sweep.mjs; `pnpm evidence:sweep` runs them against the library.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { applySweep, sweepPlan } from "./evidence-sweep.mjs";

const git = (root, ...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function write(root, file, text) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
}

/** A repository on main where each pull request is a branch merged as GitHub merges one. */
function repository(t) {
  const root = mkdtempSync(path.join(tmpdir(), "evidence-sweep-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "test");
  write(root, "README.md", "readme\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "start");
  return root;
}

function pullRequest(root, number, branch, files) {
  git(root, "checkout", "-qb", branch);
  for (const [file, text] of Object.entries(files)) write(root, file, text);
  git(root, "add", "-A");
  git(root, "commit", "-qm", `work on ${branch}`);
  git(root, "checkout", "-q", "main");
  git(root, "merge", "-q", "--no-ff", "-m", `Merge pull request #${number} from storytree-ai/${branch}`, branch);
}

function onMain(root, files) {
  for (const [file, text] of Object.entries(files)) write(root, file, text);
  git(root, "add", "-A");
  git(root, "commit", "-qm", "straight onto main");
}

const increment = (id, fields = {}) => ({ id, fields: { title: id, ...fields } });

test("10.1 · a recording goes only when every arc it was made for has closed and nothing active names it; --apply deletes it and links its last copy from its folder's README", (t) => {
  const root = repository(t);
  pullRequest(root, 11, "claude/increment-aaaaaaaaaaaa-1", {
    "packages/web/evidence/done/clip.webm": "clip",
    "packages/web/evidence/done/trace.json.gz": "trace",
    "packages/web/evidence/done/README.md": "# Done\n\nWatch [the clip](clip.webm).\n",
    "packages/web/evidence/seeded/seed.json.gz": "seed",
  });
  pullRequest(root, 12, "claude/increment-bbbbbbbbbbbb-1", { "packages/web/evidence/live/clip.webm": "live" });
  pullRequest(root, 13, "claude/increment-aaaaaaaaaaaa-2", { "packages/web/evidence/named/clip.webm": "named" });
  pullRequest(root, 14, "feature/by-number", { "packages/web/evidence/numbered/clip.webm": "numbered" });
  pullRequest(root, 15, "claude/increment-aaaaaaaaaaaa-3", { "packages/web/evidence/redone/clip.webm": "first" });
  pullRequest(root, 16, "claude/increment-bbbbbbbbbbbb-2", { "packages/web/evidence/redone/clip.webm": "second" });
  pullRequest(root, 17, "claude/increment-aaaaaaaaaaaa-4", {
    "packages/web/evidence/read/input-clip.webm": "input",
    "packages/web/src/reads.ts": "export const clip = \"input-clip.webm\";\n",
  });
  onMain(root, { "packages/web/evidence/stray/clip.webm": "stray" });

  const arcs = [
    { arc: { id: "arc_closed" }, state: "closed", increments: [increment("increment_aaaaaaaaaaaa"), increment("increment_cccccccccccc", { outcome: { disposition: "landed", pr: "#14" } })] },
    { arc: { id: "arc_live" }, state: "active", increments: [
      increment("increment_bbbbbbbbbbbb"),
      increment("increment_dddddddddddd", { body: "Compare against packages/web/evidence/named/clip.webm before redoing it." }),
    ] },
  ];
  const plan = sweepPlan(root, arcs);
  assert.deepEqual(plan.go.map((one) => one.file), [
    "packages/web/evidence/done/clip.webm",
    "packages/web/evidence/done/trace.json.gz",
    "packages/web/evidence/numbered/clip.webm",
  ]);
  assert.deepEqual(plan.go[2].arcs, ["arc_closed"]);
  assert.deepEqual(plan.go[2].prs, ["14"]);
  const kept = Object.fromEntries(plan.keep.map((one) => [one.file, one.why]));
  assert.match(kept["packages/web/evidence/live/clip.webm"], /arc_live is active/);
  assert.match(kept["packages/web/evidence/named/clip.webm"], /increment_dddddddddddd names it/);
  assert.match(kept["packages/web/evidence/redone/clip.webm"], /arc_live is active/);
  assert.match(kept["packages/web/evidence/read/input-clip.webm"], /packages\/web\/src\/reads\.ts reads it/);
  assert.match(kept["packages/web/evidence/stray/clip.webm"], /no pull request/);
  assert.equal(kept["packages/web/evidence/seeded/seed.json.gz"], undefined, "a seed is an input, never a recording");

  const commit = git(root, "rev-parse", "HEAD");
  applySweep(root, plan, { commit, date: "2026-10-23", repository: "https://github.com/storytree-ai/storytree" });
  for (const one of plan.go) assert.equal(existsSync(path.join(root, one.file)), false, one.file);
  assert.equal(existsSync(path.join(root, "packages/web/evidence/live/clip.webm")), true);
  const last = (file) => `https://github.com/storytree-ai/storytree/blob/${commit}/${file}`;
  const readme = readFileSync(path.join(root, "packages/web/evidence/done/README.md"), "utf8");
  assert.ok(readme.includes(`Watch [the clip](${last("packages/web/evidence/done/clip.webm")}).`), readme);
  assert.ok(readme.includes(`Removed from \`main\` on 2026-10-23, its arc closed (ADR-1123): [clip.webm](${last("packages/web/evidence/done/clip.webm")}), [trace.json.gz](${last("packages/web/evidence/done/trace.json.gz")}).`), readme);
  assert.ok(readFileSync(path.join(root, "packages/web/evidence/numbered/README.md"), "utf8").includes(`[clip.webm](${last("packages/web/evidence/numbered/clip.webm")})`));
  assert.deepEqual(git(root, "status", "--porcelain").split("\n").sort(), [
    "A  packages/web/evidence/numbered/README.md",
    "D  packages/web/evidence/done/clip.webm",
    "D  packages/web/evidence/done/trace.json.gz",
    "D  packages/web/evidence/numbered/clip.webm",
    "M  packages/web/evidence/done/README.md",
  ], "the sweep is staged, ready to commit");
});
