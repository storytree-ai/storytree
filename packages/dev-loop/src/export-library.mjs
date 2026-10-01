// `pnpm library:export`: print the project `storytree` in the desktop app's library
// (~/.storytree/0.3/pgdata) as story and decision files, into library-export/stories/ and
// library-export/decisions/ (which git ignores). They are read-only copies, for reading the plan
// outside the app: the library is the one copy of 0.3's own stories and decisions (ADR-0641 D2
// step 4, choice F1), and nothing is ever read back from these files. It reads the library and
// writes nothing to it.
//
// It reads the running app's database, or starts the app's Postgres itself when the app is not
// running (packages/dev-loop/src/library-server.mjs). The rules for printing live in packages/dev-loop/src/library-export.mjs.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { connect } from "@storytree/library";

import { appHome } from "../../../apps/desktop/src/home.ts";
import { appLibraryServer } from "./library-server.mjs";
import { exportLibrary } from "./library-export.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const PROJECT = "storytree";
const OUT = "library-export";
const COMMAND = "pnpm library:export";

let server; // the app's Postgres, while it runs

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
  const home = appHome();
  console.log(`the app's library: ${home.pgdata}`);
  server = await appLibraryServer(COMMAND, { writes: false });

  let printed;
  let storytree;
  try {
    storytree = await connect({ url: server.url });
    if (!(await storytree.listProjects()).includes(PROJECT)) {
      console.error(`\nThe app's library has no project "${PROJECT}". Restore it from a snapshot with \`pnpm library:restore\`.`);
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
