// Capability 4 · Capability-list check. How this repository's commands that read storytree's own plan reach its
// library: wherever the user's `library` setting puts it (the Mint box's Postgres, or another address), or the running
// app's local database through the address it leaves beside its data directory, and otherwise by starting the app's
// Postgres on that directory and stopping it again at the end. The capability-list check reads the plan this way, and
// so do Mick's dev loop's library commands (the guidance build, the plan-edge check, owner-applies, the evidence sweep).

import path from "node:path";

import { locateLibrary, readLibrary } from "@storytree/project-and-caller";
import { connect } from "@storytree/library";
import { DataDirInUseError, start } from "@storytree/local-postgres";

import { appHome } from "../../../apps/desktop/src/home.ts";

const PROJECT = "storytree";

let server; // the app's Postgres, when this started it

/** Stop the app's Postgres if this process started it (for an interrupted command). */
export async function stopStartedLibrary() {
  await server?.stop();
}

/** Run `read` on the project's library (storytree's own unless `project` names another), or say why it could not be opened and return undefined. */
export async function withLibrary(read, command, project = PROJECT) {
  const home = path.dirname(appHome().pgdata);
  const where = locateLibrary({ home, dataDir: appHome().pgdata });
  let options = where.found ? where.connect : undefined;
  if (options === undefined && readLibrary(home).location === "local") {
    try {
      server = await start({ dataDir: appHome().pgdata, owner: command });
    } catch (error) {
      if (!(error instanceof DataDirInUseError)) throw error;
      console.error(`The app's library in ${appHome().pgdata} is in use by process ${error.pid}. When it has finished, run \`${command}\` again.`);
      return undefined;
    }
    options = { url: server.url };
  }
  const storytree = await connect(options);
  try {
    if (!(await storytree.listProjects()).includes(project)) {
      console.error(`The app's library has no project "${project}". Restore it from a snapshot with \`pnpm library:restore\`.`);
      return undefined;
    }
    const library = await storytree.openProject(project);
    try {
      return await read(library);
    } finally {
      await library.close();
    }
  } finally {
    await storytree.close();
    await server?.stop();
  }
}
