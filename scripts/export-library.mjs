// `pnpm library:export`: print the project `storytree` in the desktop app's library
// (~/.storytree/0.3/pgdata) as story and decision files, into library-export/stories/ and
// library-export/decisions/ (which git ignores). They are read-only copies, for reading the plan
// outside the app: the library is the one copy of 0.3's own stories and decisions (ADR-0641 D2
// step 4, choice F1), and nothing is ever read back from these files. It reads the library and
// writes nothing to it.
//
// It starts the app's Postgres on the app's own data directory and stops it again, so while the
// app is running and holds that directory it says so and exits non-zero: quit the app first. The
// rules for printing live in scripts/library-export.mjs.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { connect } from "@storytree/library";
import { DataDirInUseError, start } from "@storytree/local-postgres";

import { APP_OWNER, appHome } from "../apps/desktop/src/home.ts";
import { exportLibrary } from "./library-export.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const PROJECT = "storytree";
const OUT = "library-export";
const COMMAND = "pnpm library:export";

let server; // the app's Postgres, while it runs
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

async function main() {
  const home = appHome();
  console.log(`the app's library: ${home.pgdata}`);
  try {
    server = await start({ dataDir: home.pgdata, owner: COMMAND, log: (message) => console.log(`Postgres: ${message}`) });
  } catch (error) {
    if (!(error instanceof DataDirInUseError)) throw error;
    console.error(
      error.owner === APP_OWNER
        ? `\nThe storytree 0.3 app is running (pid ${error.pid}) and holds its library in ${home.pgdata}.\n` +
            `Quit the app, then run \`${COMMAND}\` again.`
        : `\nThe app's library in ${home.pgdata} is in use by process ${error.pid}` +
            `${error.owner === undefined ? "" : ` (${error.owner})`}. When it has finished, run \`${COMMAND}\` again.`,
    );
    return 1;
  }

  let printed;
  let storytree;
  try {
    storytree = await connect({ url: server.url });
    if (!(await storytree.listProjects()).includes(PROJECT)) {
      console.error(`\nThe app's library has no project "${PROJECT}". Run \`pnpm seed:library\` first.`);
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

  const out = path.join(root, OUT);
  for (const dir of ["stories", "decisions"]) rmSync(path.join(out, dir), { recursive: true, force: true });
  for (const [file, text] of printed) {
    mkdirSync(path.dirname(path.join(out, file)), { recursive: true });
    writeFileSync(path.join(out, file), text);
  }
  console.log(`\nprinted ${printed.size} files into ${OUT}/: read-only copies; the library is the one copy`);
  return 0;
}
