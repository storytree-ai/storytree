// Capability 4 · Capability-list check. The steps storytree's own repository checks add to the gate's base steps
// (ADR-1170 D2), declared as `gateSteps` in this package's storytree manifest, beside the ones Mick's dev loop adds
// (his factory plugin micks-dev-loop's gate steps). A step is `{ name, when?, command }`, as the base gate runner reads it.
// lint (lint.mjs, ADR-1199 D2) runs storytree's three code-structure rules, type-only imports, package boundaries and
// the numbered-test refusal; it reads only the code, so CI runs it too, and it runs here every time.
// check:seed-records refuses a seed or snapshot file the branch adds or changes that holds what the forest's seed
// sanitiser drops (a work record, a withheld arc, a redaction pattern); it reads only files, so CI runs it too.
// check:leaks refuses a file the branch adds or changes that gains a personal path, name, address or link
// (leak-scan.mjs, the tree-wide scan the new repo's starting commit passes); CI runs it too, without the private names.
// check:secrets refuses a file the branch adds or changes that gains a credential's shape (leak-scan.mjs), by pattern
// only; CI runs it as its own secret-check job, whose failure the watcher takes to the owner.
// check:capability-list (ADR-0949 D3) fails a branch that changes a capability its increment does not list; a
// branch whose name carries no increment is NOT RUN with that reason.
import { capabilityListFor } from "./capability-list.mjs";

const node = (...args) => ({ command: process.execPath, args: ["--import", "tsx", ...args], shell: false });
// The gate runs in a checkout, whose branch Git knows; CI's own run of the check reads its pull request's.
export const listed = ({ root }) => capabilityListFor(root, {});

export const gateSteps = [
  { name: "lint", command: () => node("packages/repo-checks/src/lint.mjs") },
  { name: "check:seed-records", command: () => node("packages/repo-checks/src/seed-records.mjs") },
  { name: "check:leaks", command: () => node("packages/repo-checks/src/leak-scan.mjs") },
  { name: "check:secrets", command: () => node("packages/repo-checks/src/leak-scan.mjs", "--secrets") },
  { name: "check:capability-list", when: listed, command: () => node("packages/repo-checks/src/capability-list.mjs") },
];
