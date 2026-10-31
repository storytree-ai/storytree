// Capability 5 · Library tools. `pnpm library:restore <snapshot.json> [--project <name>]`: restore a project snapshot the app took
// (~/.storytree/0.3/backups/<project>/<time>.json, ADR-0641 B1) into the library the storytree
// `library` setting names (`storytree settings show`), as the project it was taken of or as
// `--project <name>`. The library restores only into a project
// that holds no record and no history, so this can never overwrite live edits: to put a project
// back, restore it under a new name, or into a library where it does not exist yet.
//
// Like `pnpm check:own-health` run by hand, it reaches a Postgres address or Cloud SQL directly; the
// app's own library it writes into while the app runs, or starts the app's Postgres itself when the
// app is not running, never writing at the same time as another library script
// (packages/repo-checks/src/library-server.mjs).

import { readFileSync } from "node:fs";

import { connect, RestoreRefusedError } from "@storytree/library";
import { readLibrary } from "@storytree/project-and-caller";

import { appHome } from "../../../apps/desktop/src/home.ts";
import { settingLibraryServer } from "@storytree/repo-checks/library-server";

const COMMAND = "pnpm library:restore";

let server; // the library's server, while the script holds it
process.once("SIGINT", () => {
  console.error("\nrestore: interrupted; stopping Postgres");
  void (server?.stop() ?? Promise.resolve()).finally(() => process.exit(130));
});

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(`\nrestore: ${error.stack ?? error.message}`);
    process.exitCode = 1;
  },
);

async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf("--project");
  const project = at === -1 ? undefined : args[at + 1];
  const file = args.find((arg, index) => !arg.startsWith("--") && (at === -1 || index !== at + 1));
  if (file === undefined || (at !== -1 && project === undefined)) {
    console.error(`usage: ${COMMAND} <snapshot.json> [--project <name>]`);
    return 1;
  }
  const snapshot = JSON.parse(readFileSync(file, "utf8"));
  const name = project ?? snapshot.project;
  console.log(`restoring the snapshot of "${snapshot.project}" taken ${snapshot.takenAt} into "${name}"`);
  server = await settingLibraryServer(COMMAND, { setting: readLibrary(appHome().dir), writes: true });
  let storytree;
  try {
    storytree = await connect(server.where);
    await storytree.restore(name, snapshot);
  } catch (error) {
    if (!(error instanceof RestoreRefusedError)) throw error;
    console.error(`\n${error.message}\nRestore it under a new name with --project <name>.`);
    return 1;
  } finally {
    await storytree?.close();
    await server.stop();
  }
  console.log(`restored: ${snapshot.records.length} records and ${snapshot.history.length} history entries into "${name}"`);
  return 0;
}
