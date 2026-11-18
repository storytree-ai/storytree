// Capability 16 · Build and launch
import { printable } from "@storytree/library/printable";

import { render } from "../answer.js";
import { run } from "../door.js";
import { changedOnItsWay, handedToPnpm } from "../handed.js";

const argv = process.argv.slice(2);
const handed = handedToPnpm(process.env, process.argv[1]);
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
