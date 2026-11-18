// Capability 8 · Storytree's own test and gate entries.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { commentHatches } from "./eslint.mjs";

const STEP = "fyi:comment-hatches";
const TOLD = /^\s+fyi_\w+/m;

const what = ({ file, line, comment, reason }) => `${file}:${line} keeps the comment "${comment}", disabling storytree/no-comments because: ${reason}`;

export async function tellHatches({ project, hatches, storytree, log = console.log }) {
  if (hatches.length === 0) {
    log(`${STEP}: the branch adds no comment escape hatch`);
    return 0;
  }
  try {
    let told = 0;
    for (const hatch of hatches) {
      const text = what(hatch);
      const found = await storytree(["library", "list", "fyi", "--where", `about=${hatch.file}`, "--where", `what=${text}`]);
      if (TOLD.test(found)) continue;
      await storytree(["fyi", "new", "--title", `A comment kept by the escape hatch: ${hatch.file}:${hatch.line}`, "--what", text, "--about", hatch.file, "--project", project]);
      log(`${STEP}: told the owner of ${hatch.file}:${hatch.line}`);
      told += 1;
    }
    log(`${STEP}: ${hatches.length} comment escape hatch${hatches.length === 1 ? "" : "es"} on the branch, ${told} newly told`);
    return 0;
  } catch (failure) {
    log(`${STEP}: telling the owner of the branch's comment escape hatches failed, the library unreached or refusing: ${String(failure.stderr || failure.message).trim()}`);
    return 1;
  }
}

const STORYTREE = [process.execPath, "--import", "tsx", "packages/cli/src/bins/storytree.ts"];

export function cliRunner({ root, command = STORYTREE }) {
  const run = promisify(execFile);
  return async (args) => {
    const { stdout } = await run(command[0], [...command.slice(1), ...args], { cwd: root, encoding: "utf8", shell: false, maxBuffer: 16 * 1024 * 1024, timeout: 120_000 });
    return stdout;
  };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  const { project } = JSON.parse(readFileSync(path.join(root, ".storytree", "project.json"), "utf8"));
  process.exitCode = await tellHatches({ root, project, hatches: await commentHatches(root), storytree: cliRunner({ root }) });
}
