// Capability 4 · Capability-list check
import { capabilityListFor } from "./capability-list.mjs";
import { mountedPartsFor } from "./mounted-parts.mjs";

const node = (...args) => ({ command: process.execPath, args: ["--import", "tsx", ...args], shell: false });
export const listed = ({ root }) => capabilityListFor(root, {});

export const gateSteps = [
  { name: "lint", command: () => node("packages/repo-checks/src/lint.mjs") },
  { name: "check:seed-records", command: () => node("packages/repo-checks/src/seed-records.mjs") },
  { name: "check:leaks", command: () => node("packages/repo-checks/src/leak-scan.mjs") },
  { name: "check:secrets", command: () => node("packages/repo-checks/src/leak-scan.mjs", "--secrets") },
  { name: "check:evidence", command: () => node("packages/repo-checks/src/evidence-check.mjs") },
  { name: "check:capability-list", when: listed, command: () => node("packages/repo-checks/src/capability-list.mjs") },
  { name: "check:mounted-parts", when: (options) => mountedPartsFor(options), command: () => node("packages/repo-checks/src/mounted-parts.mjs") },
  { name: "fyi:comment-hatches", command: () => node("packages/repo-checks/src/comment-hatches.mjs") },
];
