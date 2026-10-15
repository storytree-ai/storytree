// Capability 5 · Library tools. `pnpm library:export`: print the project `storytree` in the library the storytree
// `library` setting names (`storytree settings show`) as story and decision files, into library-export/stories/ and
// library-export/decisions/ (which git ignores). They are read-only copies, for reading the plan
// outside the app: the library is the one copy of 0.3's own stories and decisions (ADR-0641 D2
// step 4, choice F1), and nothing is ever read back from these files. It reads the library and
// writes nothing to it.
//
// Like `pnpm check:own-health` run by hand, it reaches a Postgres address or Cloud SQL directly, and
// the app's own library by joining the running app's database, or starting the app's Postgres itself
// when the app is not running (packages/dev-loop/src/library-server.mjs). The rules for printing live in packages/dev-loop/src/library-export.mjs.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { connect } from "@storytree/library";
import { readLibrary } from "@storytree/project-and-caller";

import { appHome } from "../../../apps/desktop/src/home.ts";
import { settingLibraryServer } from "./library-server.mjs";
import { exportLibrary } from "./library-export.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const PROJECT = "storytree";
const OUT = "library-export";
const COMMAND = "pnpm library:export";

let server; // the library's server, while the script holds it

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.once("SIGINT", () => {
    console.error("\nexport: interrupted; stopping Postgres");
    void (server?.stop() ?? Promise.resolve()).finally(() => process.exit(130));
  });
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`\nexport: ${error.stack ?? error.message}`);
      process.exitCode = 1;
    },
  );
}

async function main() {
  server = await settingLibraryServer(COMMAND, { setting: readLibrary(appHome().dir), writes: false });

  let printed;
  let storytree;
  try {
    storytree = await connect(server.where);
    if (!(await storytree.listProjects()).includes(PROJECT)) {
      console.error(`\nThe library has no project "${PROJECT}". Restore it from a snapshot with \`pnpm library:restore\`.`);
      return 1;
    }
    const library = await storytree.openProject(PROJECT);
    try {
      printed = await exportLibrary(library);
    } finally {
      await library.close();
    }
  } finally {
    await storytree?.close();
    await server.stop();
  }

  writeExport(printed, path.join(root, OUT));
  console.log(`\nprinted ${printed.size} files into ${OUT}/: read-only copies; the library is the one copy`);
  return 0;
}

/** Replace the stories and decisions folders under `out` with the `printed` files, by their paths. */
export function writeExport(printed, out) {
  for (const dir of ["stories", "decisions"]) rmSync(path.join(out, dir), { recursive: true, force: true });
  for (const [file, text] of printed) {
    mkdirSync(path.dirname(path.join(out, file)), { recursive: true });
    writeFileSync(path.join(out, file), text);
  }
}
