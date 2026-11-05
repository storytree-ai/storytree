/**
 * Capability 16 · Build and launch. `storytree`: the command line for people (the command line story). Everything it
 * does is the front door's (../door.ts); this refuses a word changed on its way here (../handed.ts), and otherwise hands
 * the door the command and the terminal.
 */
import { printable } from "@storytree/library/printable";

import { render } from "../answer.js";
import { run } from "../door.js";
import { changedOnItsWay, handedToPnpm } from "../handed.js";

const argv = process.argv.slice(2);
const handed = handedToPnpm(process.env, process.argv[1]);
// The line the Windows launcher was handed (ADR-0854) is this command's alone: what it starts must not read it as its own.
const launched = process.env.STORYTREE_COMMAND_LINE;
delete process.env.STORYTREE_COMMAND_LINE;
const changed = changedOnItsWay(argv, handed, launched);
if (changed !== undefined) {
  process.stderr.write(printable(render({ text: changed })));
  process.exitCode = 1;
} else {
  process.exitCode = await run(argv, {
    cwd: process.cwd(),
    ...(process.argv[1] === undefined ? {} : { script: process.argv[1] }),
    terminal: process.stderr.isTTY === true,
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}
