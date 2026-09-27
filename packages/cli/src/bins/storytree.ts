/**
 * `storytree`: the command line for people (the command line story). Everything it does is the front
 * door's (../door.ts); this only hands it the command and the terminal.
 */
import { run } from "../door.js";

process.exitCode = await run(process.argv.slice(2), {
  cwd: process.cwd(),
  ...(process.argv[1] === undefined ? {} : { script: process.argv[1] }),
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
});
