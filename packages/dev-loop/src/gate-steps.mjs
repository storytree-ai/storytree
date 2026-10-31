// Capability 7 · The gate. The step Mick's dev loop adds to the gate's base steps in storytree's own checkout (ADR-1170 D2), declared as
// `gateSteps` in this package's storytree manifest and mounted by the gate the way ADR-1116 mounts verbs and tools.
// A step is `{ name, when?, command }`: `when({ root, guidance })` says whether it runs and the reason its row shows
// (absent, it always runs, with no reason), and `command({ root })` the process it runs from the checkout's root.
// check:guidance runs when generated roles changed. Library edits are not Git edits: --guidance declares a role/note edit
// even when regeneration left the committed files unchanged. A hand-written CLAUDE.md header edit alone is not one.
// Its other checks (plan edges, owner applies, the change's risk line) moved into his factory plugin micks-dev-loop
// (ADR-1192 D2), whose gate steps the gate runs while this computer names it.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

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

const node = (...args) => ({ command: process.execPath, args: ["--import", "tsx", ...args], shell: false });

export const gateSteps = [
  { name: "check:guidance", when: ({ root, guidance }) => guidanceFor(root, guidance), command: () => node("packages/dev-loop/src/build-guidance.mjs", "--check") },
];
