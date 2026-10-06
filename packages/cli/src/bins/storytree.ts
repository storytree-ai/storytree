/**
 * Capability 1 · Front door. `storytree`: the command line for people (the command line story). Everything it does is the front
 * door's (../door.ts); this only hands it the command and the terminal.
 */
import { run } from "../door.js";
import { handedToPnpm } from "../handed.js";

const handed = handedToPnpm(process.env, process.argv[1]);
// The line the Windows launcher was handed (ADR-0854) is this command's alone: what it starts must not read it as its own.
const launched = process.env.STORYTREE_COMMAND_LINE;
delete process.env.STORYTREE_COMMAND_LINE;
process.exitCode = await run(process.argv.slice(2), {
  cwd: process.cwd(),
  ...(process.argv[1] === undefined ? {} : { script: process.argv[1] }),
  ...(handed === undefined ? {} : { handed }),
  ...(launched === undefined ? {} : { launched }),
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
});
