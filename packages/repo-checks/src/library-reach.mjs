// Capability 4 · Capability-list check

import path from "node:path";

import { locateLibrary, readLibrary } from "@storytree/project-and-caller";
import { connect } from "@storytree/library";
import { DataDirInUseError, start } from "@storytree/local-postgres";

import { appHome } from "../../../apps/desktop/src/home.ts";

const PROJECT = "storytree";

let server;

export async function stopStartedLibrary() {
  await server?.stop();
}

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
