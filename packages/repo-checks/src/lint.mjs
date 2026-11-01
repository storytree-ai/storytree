// Capability 8 · Storytree's own test and gate entries. `pnpm lint`: storytree's three code-structure rules as one lint
// step (ADR-1199 D2), run by `pnpm gate` (gate-steps.mjs) and by CI on every pull request. The rules are the existing
// checks, storytree's own house rules rather than base ones: a type-only import ends only at the library
// (type-imports.mjs, ADR-1017 D2), each story keeps its code in its own package behind a thin frame and front door
// (package-boundaries.mjs, ADR-0649 D1-D3), and no story package's source file is left reached by no numbered test
// (allocation.mjs, ADR-0838 D5). Each prints one line per problem, `<rule>: <problem>`, and any problem fails the run.
import { fileURLToPath, pathToFileURL } from "node:url";

import { allocationProblems } from "./allocation.mjs";
import { boundaryProblems } from "./package-boundaries.mjs";
import { typeImportProblems } from "./type-imports.mjs";

/** The three rules, each `{ name, problems(root) }`, its problems one sentence each naming the file that breaks it. */
export const RULES = [
  { name: "type-imports", problems: typeImportProblems },
  { name: "package-boundaries", problems: boundaryProblems },
  { name: "allocation", problems: allocationProblems },
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
