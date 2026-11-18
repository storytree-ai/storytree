// Capability 8 · Storytree's own test and gate entries.
import { fileURLToPath, pathToFileURL } from "node:url";

import { allocationProblems } from "./allocation.mjs";
import { codeqlPatternProblems } from "./codeql-patterns.mjs";
import { eslintProblems } from "./eslint.mjs";
import { boundaryProblems } from "./package-boundaries.mjs";
import { sketchBundleProblems } from "./sketch-bundles.mjs";
import { typeImportProblems } from "./type-imports.mjs";

/** The rules, each `{ name, problems(root) }`, its problems one sentence each naming the file that breaks it. */
export const RULES = [
  { name: "type-imports", problems: typeImportProblems },
  { name: "package-boundaries", problems: boundaryProblems },
  { name: "allocation", problems: allocationProblems },
  { name: "codeql-patterns", problems: codeqlPatternProblems },
  { name: "sketch-bundle-names", problems: sketchBundleProblems },
  { name: "eslint", problems: eslintProblems },
];

/** Run `rules` over the checkout at `root`, logging each problem under its rule's name; 1 when any rule breaks, else 0. */
export async function lint({ root, rules = RULES, log = console.log }) {
  let count = 0;
  for (const rule of rules) {
    for (const problem of await rule.problems(root)) {
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
