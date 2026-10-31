// Capability 7 · The gate. The steps Mick's dev loop adds to the gate's base steps in storytree's own checkout (ADR-1170 D2), declared as
// `gateSteps` in this package's storytree manifest and mounted by the gate the way ADR-1116 mounts verbs and tools.
// A step is `{ name, when?, command }`: `when({ root, guidance })` says whether it runs and the reason its row shows
// (absent, it always runs, with no reason), and `command({ root })` the process it runs from the checkout's root.
// check:guidance runs when generated roles changed. Library edits are not Git edits: --guidance declares a role/note edit
// even when regeneration left the committed files unchanged. A hand-written CLAUDE.md header edit alone is not one.
// check:plan-edges (ADR-0840 D2) reads the plan from the library, which CI cannot, so it runs here every time.
// It fails only on edges between stories whose packages the branch changes; others it prints as notes.
// check:owner-applies fails a branch that changes a folder the owner applies by hand (owner-applies.mjs) unless an
// owner wait names it; it reads the library's waits, so it runs only here, and is NOT RUN when no such folder changed.
// check:risk (ADR-1144 D1, D4) reads the branch's change for its risk line (tier, rating, depth, radius, flags,
// stories) from its diff and the package graph, and writes it on the branch's increment with `storytree quality risk`,
// so each change's tier is read from the paths it changes at the gate; a branch whose name carries no increment leaves it
// NOT RUN with that reason, as it leaves the repository checks' check:capability-list (packages/repo-checks/src/gate-steps.mjs).
// Both read the increment and its change from the branch checked out here: check:risk hands quality risk this checkout's diff, so a
// branch renamed after review to name its increment is read where it is, not looked for under the name its claim recorded.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { currentBranch, incrementOfBranch } from "@storytree/repo-checks/capability-list";
import { listed } from "@storytree/repo-checks/gate-steps";
import { ownerAppliesFor } from "./owner-applies.mjs";
import { REGION_START, REGION_END, ROLE_DIRS, SKILL_DIRS } from "./guidance.mjs";
import { changedFiles } from "@storytree/base-dev-loop/test-scope";

/** Check generated roles automatically; require the check when Git cannot establish the changes. */
export function guidanceFor(root, requested = false) {
  if (requested) return { run: true, reason: "--guidance declares a role or note change in the library" };
  try {
    const files = changedFiles(root);
    const role = files.find((file) => file === "AGENTS.md" || [...Object.keys(ROLE_DIRS), ...SKILL_DIRS].some((dir) => file.startsWith(`${dir}/`)));
    if (role) return { run: true, reason: `${role} changed` };
    if (files.includes("CLAUDE.md")) {
      const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      const base = git("merge-base", "origin/main", "HEAD").trim();
      const before = generatedRegion(git("show", `${base}:CLAUDE.md`));
      const after = generatedRegion(readFileSync(path.join(root, "CLAUDE.md"), "utf8"));
      if (before !== after) return { run: true, reason: "CLAUDE.md's generated role changed" };
    }
    return { run: false, reason: "no role or note change detected; use --guidance for library-only edits" };
  } catch {
    return { run: true, reason: "guidance changes could not be read; checking conservatively" };
  }
}

function generatedRegion(text) {
  text = text.replaceAll("\r\n", "\n");
  const start = text.indexOf(REGION_START);
  const end = text.indexOf(REGION_END, start);
  if (start === -1 || end === -1) throw new Error("missing generated guidance markers");
  return text.slice(start, end + REGION_END.length);
}

/**
 * The change checked out at `root` as quality risk reads it: its diff from the merge base with origin/main, with each untracked
 * file as a diff that adds it, written to a file in the checkout's own Git folder; the file's path, absolute.
 */
export function checkoutDiff(root) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  const added = (file) => {
    try {
      return git("diff", "--no-index", "--", "/dev/null", file);
    } catch (error) {
      // `git diff --no-index` exits 1 when the two differ, which a new file always does.
      if (error.status === 1 && typeof error.stdout === "string") return error.stdout;
      throw error;
    }
  };
  const untracked = git("ls-files", "--others", "--exclude-standard", "-z").split("\0").filter((file) => file !== "");
  const diff = [git("diff", git("merge-base", "origin/main", "HEAD").trim()), ...untracked.map(added)].join("");
  const file = path.resolve(root, git("rev-parse", "--git-path", "storytree-risk.diff").trim());
  writeFileSync(file, diff);
  return file;
}

const node = (...args) => ({ command: process.execPath, args: ["--import", "tsx", ...args], shell: false });

export const gateSteps = [
  { name: "check:guidance", when: ({ root, guidance }) => guidanceFor(root, guidance), command: () => node("packages/dev-loop/src/build-guidance.mjs", "--check") },
  { name: "check:plan-edges", command: () => node("packages/dev-loop/src/plan-edges.mjs") },
  { name: "check:owner-applies", when: ({ root }) => ownerAppliesFor(root), command: () => node("packages/dev-loop/src/owner-applies.mjs") },
  { name: "check:risk", when: listed, command: ({ root }) => node("packages/cli/src/bins/storytree.ts", "quality", "risk", incrementOfBranch(currentBranch(root, {})), "--diff", `@${checkoutDiff(root)}`) },
];
