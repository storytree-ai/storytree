// How `pnpm seed:library` reaches the app's library (~/.storytree/0.3/pgdata) without anyone
// quitting the app first.
//
// - The app is running: the seed joins the app's own database (its owner record names the port)
//   and leaves it running when done. It used to refuse, and the app hides in its tray, so "I've
//   quit the app" was not enough (seen 2026-09-27).
// - Nobody holds the library: the seed starts the database itself and stops it at the end.
// - Another seed holds it: the seed waits its turn, saying so once, rather than refusing.
//
// And once connected, two seeds never write at once: each holds a writing lock (a Postgres advisory
// lock) on a connection named `storytree-seed`, which is also how the app knows not to restart into
// an update while a seed is writing (@storytree/app's seedWriting).

import pg from "pg";

import { DataDirInUseError } from "@storytree/local-postgres";

import { SEED_CONNECTION } from "../packages/app/src/updates/seed-writing.ts";

/** The advisory lock a seed holds while it writes: any fixed number, the same in every seed. */
const SEED_LOCK = 3_000_300;

/**
 * The library's database for a seed: the app's own if the app is running (`joined`), else one the
 * seed starts itself, waiting up to `waitMs` (30 minutes) while another seed holds the library.
 * `stop()` stops only a database the seed started.
 */
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
        // The app has just stopped or is only starting: try again.
      } else if (!waiting) {
        waiting = true;
        log(`the library is in use by process ${error.pid}${error.owner === undefined ? "" : ` (${error.owner})`}: waiting for it to finish …`);
      }
      if (clock() >= deadline) throw error;
      await sleep(pollMs);
    }
  }
}

/**
 * Take the seeds' writing lock on the library at `url`, waiting (and saying so) while another seed
 * holds it. Held until `release()`, on a connection named SEED_CONNECTION.
 */
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

/**
 * The app's library for one of this repo's library scripts (`pnpm seed:library`, `library:move`,
 * `library:export`, `library:restore`): the running app's database, or one started for the script,
 * waiting its turn behind another script. A script that `writes` also takes the writing lock, so
 * two never write at once and the app does not restart under it. `stop()` lets go of both.
 */
export async function appLibraryServer(command, { writes, log = (line) => console.log(line) }) {
  const [{ start }, { locateStorytree }, { APP_OWNER, appHome }] = await Promise.all([
    import("@storytree/local-postgres"),
    import("@storytree/agent-link"),
    import("../apps/desktop/src/home.ts"),
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
