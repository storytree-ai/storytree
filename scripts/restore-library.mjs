// `pnpm library:restore <snapshot.json> [--project <name>]`: restore a project snapshot the app took
// (~/.storytree/0.3/backups/<project>/<time>.json, ADR-0641 B1) into the desktop app's library, as
// the project it was taken of or as `--project <name>`. The library restores only into a project
// that holds no record and no history, so this can never overwrite live edits: to put a project
// back, restore it under a new name, or into a library where it does not exist yet.
//
// Like `pnpm seed:library`, it starts the app's Postgres on the app's own data directory and stops
// it again, so quit the app first.

import { readFileSync } from "node:fs";

import { connect, RestoreRefusedError } from "@storytree/library";
import { DataDirInUseError, start } from "@storytree/local-postgres";

import { APP_OWNER, appHome } from "../apps/desktop/src/home.ts";

const COMMAND = "pnpm library:restore";

let server; // the app's Postgres, while it runs
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
  const file = args.find((arg, index) => !arg.startsWith("--") && index !== at + 1);
  if (file === undefined || (at !== -1 && project === undefined)) {
    console.error(`usage: ${COMMAND} <snapshot.json> [--project <name>]`);
    return 1;
  }
  const snapshot = JSON.parse(readFileSync(file, "utf8"));
  const name = project ?? snapshot.project;
  const home = appHome();
  console.log(`restoring the snapshot of "${snapshot.project}" taken ${snapshot.takenAt} into "${name}" in ${home.pgdata}`);
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
  let storytree;
  try {
    storytree = await connect({ url: server.url });
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
