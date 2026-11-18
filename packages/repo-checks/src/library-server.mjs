// Capability 7 · Own health

import pg from "pg";

import { DataDirInUseError } from "@storytree/local-postgres";

import { SEED_CONNECTION } from "@storytree/library";

const SEED_LOCK = 3_000_300;

export async function libraryServer({ dataDir, owner, appOwner, start, locate, sleep, log, clock = Date.now, waitMs = 30 * 60_000, pollMs = 2_000 }) {
  const deadline = clock() + waitMs;
  let waiting = false;
  for (;;) {
    try {
      const server = await start({ dataDir, owner });
      return { url: server.url, joined: false, stop: () => server.stop() };
    } catch (error) {
      if (!(error instanceof DataDirInUseError)) throw error;
      if (error.owner === appOwner) {
        const app = locate({ dataDir });
        if (app.running) {
          log(`the storytree 0.3 app is running (process ${error.pid}): writing into its library while it runs`);
          return { url: app.url, joined: true, stop: async () => {} };
        }
      } else if (!waiting) {
        waiting = true;
        log(`the library is in use by process ${error.pid}${error.owner === undefined ? "" : ` (${error.owner})`}: waiting for it to finish …`);
      }
      if (clock() >= deadline) throw error;
      await sleep(pollMs);
    }
  }
}

export async function holdSeedLock(url, { log }) {
  const client = new pg.Client({ connectionString: url, application_name: SEED_CONNECTION });
  await client.connect();
  try {
    const { rows } = await client.query("select pg_try_advisory_lock($1) as got", [SEED_LOCK]);
    if (!rows[0].got) {
      log("another seed is writing the library: waiting for it to finish …");
      await client.query("select pg_advisory_lock($1)", [SEED_LOCK]);
    }
  } catch (error) {
    await client.end().catch(() => {});
    throw error;
  }
  return { release: () => client.end() };
}

export async function appLibraryServer(command, { writes, log = (line) => console.log(line) }) {
  const [{ start }, { locateStorytree }, { APP_OWNER, appHome }] = await Promise.all([
    import("@storytree/local-postgres"),
    import("@storytree/project-and-caller"),
    import("../../../apps/desktop/src/home.ts"),
  ]);
  const server = await libraryServer({
    dataDir: appHome().pgdata,
    owner: command,
    appOwner: APP_OWNER,
    start: (options) => start({ ...options, log: (message) => log(`Postgres: ${message}`) }),
    locate: locateStorytree,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log,
  });
  let lock;
  try {
    if (writes) lock = await holdSeedLock(server.url, { log });
  } catch (error) {
    await server.stop();
    throw error;
  }
  return {
    url: server.url,
    stop: async () => {
      await lock?.release();
      await server.stop();
    },
  };
}

export async function settingLibraryServer(command, { setting, writes, log = (line) => console.log(line) }) {
  if (setting.location === "postgres") {
    log(`the library at ${setting.address}`);
    return { where: { address: setting.address }, stop: async () => {} };
  }
  const { appHome } = await import("../../../apps/desktop/src/home.ts");
  log(`the app's library: ${appHome().pgdata}`);
  const server = await appLibraryServer(command, { writes, log });
  return { where: { url: server.url }, stop: server.stop };
}
