// Capability 8 · Storytree's own test and gate entries.
import { fileURLToPath, pathToFileURL } from "node:url";

import { allocationProblems } from "./allocation.mjs";
import { oxlintProblems } from "./oxlint.mjs";
import { boundaryProblems } from "./package-boundaries.mjs";
import { processMatchProblems } from "./process-match.mjs";
import { typeImportProblems } from "./type-imports.mjs";
import { workflowEnvProblems } from "./workflow-env.mjs";

export const RULES = [
  { name: "type-imports", problems: (root) => typeImportProblems(root) },
  { name: "package-boundaries", problems: boundaryProblems },
  { name: "allocation", problems: allocationProblems },
  { name: "process-match", problems: processMatchProblems },
  { name: "workflow-env", problems: workflowEnvProblems },
  { name: "oxlint", problems: oxlintProblems },
];

export async function lint({ root, rules = RULES, log = console.log }) {
  let count = 0;
  for (const rule of rules) {
    for (const problem of await rule.problems(root, { log })) {
      log(`${rule.name}: ${problem}`);
      count += 1;
    }
  }
  const names = rules.map(({ name }) => name).join(", ");
  log(count === 0 ? `lint: clean (${names})` : `lint: ${count} problem${count === 1 ? "" : "s"} (${names})`);
  return count === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await lint({ root: fileURLToPath(new URL("../../..", import.meta.url)) });
}
