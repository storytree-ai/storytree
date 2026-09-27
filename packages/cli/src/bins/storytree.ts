/**
 * `storytree`: the command line for people (stories/cli.md). Everything it does is the front
 * door's (../door.ts); this only hands it the command and the terminal.
 */
import { run } from "../door.js";

process.exitCode = await run(process.argv.slice(2), {
  cwd: process.cwd(),
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
});
