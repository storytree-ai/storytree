// Capability 8 · Lag instruments. `pnpm lag:reads`: what the page's reads cost against a slow library (ADR-0836), measured the same
// way by every lane (capability 8, Lag instruments). It seeds the lag seed (lag-seed.mjs, the one lag:desktop seeds) into a throwaway
// Postgres, adds a fixed delay to every pg query to stand in for Cloud SQL's round trip, and prints
// the query count and median time over the rounds of each library and activity-log read the page's
// reads are made of (the app's pageReads asks these, plus one listProjects check each; the dev loop
// does not depend on the frame, ADR-0847). A report to read at an increment boundary, never a gate (ADR-0623).
//
//   pnpm lag:reads [--size standard|large] [--delay 20] [--rounds 5] [--reads arcViews,holds,...]
//
// The server is STORYTREE_TEST_PG_URL's when set, otherwise its own, started in a temporary folder
// under the machine's heavy-run lock so no test run shares the box with the measurement. Compare a
// branch with main by running it in both checkouts.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { openActivityLog } from "@storytree/session-management";
import { connect } from "@storytree/library";
import { start } from "@storytree/local-postgres";
import pg from "pg";

import { acquireHeavyLock } from "./heavy-lock.mjs";
import { describeSize, seedLagProject, seedSize } from "./lag-seed.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));

/** Each read the instrument knows, as the page's reads ask it of the library or the log; `ids` are the seed's. */
const READS = {
  listProjects: ({ storytree }) => storytree.listProjects(),
  projectTree: ({ library }) => library.projectTree(),
  changesSince: ({ library }) => library.changesSince(0),
  linesSince: ({ log }, project) => log.since(project, 0),
  arcViews: ({ library }) => library.arcViews(),
  holds: ({ library }) => library.holds(),
  frontCovers: ({ library }, project, ids) => library.frontCovers(ids.capability),
  relatedNotes: ({ library }, project, ids) => library.relatedNotes(ids.decision),
};

/** A click's read (relatedNotes) fired 5 ms into the background arcViews reading: how long the click waits. */
const CLICK_DURING_ARC_VIEWS = "relatedNotes during arcViews";

export const ALL_READS = [...Object.keys(READS), CLICK_DURING_ARC_VIEWS];

/** Every pg query made while armed is counted, and delayed by `delayMs` first. */
const added = { armed: false, delayMs: 0, queries: 0 };
const realQuery = pg.Client.prototype.query;
pg.Client.prototype.query = function query(...args) {
  if (!added.armed) return realQuery.apply(this, args);
  added.queries += 1;
  if (added.delayMs === 0 || typeof args[0]?.submit === "function") return realQuery.apply(this, args);
  if (args.some((arg) => typeof arg === "function")) {
    setTimeout(() => realQuery.apply(this, args), added.delayMs);
    return undefined;
  }
  return new Promise((resolve) => setTimeout(resolve, added.delayMs)).then(() => realQuery.apply(this, args));
};

/**
 * Each of `reads` (names from ALL_READS) asked of `project`'s library and the activity log over
 * `storytree`, once to warm it, then `rounds` times with `delayMs` added to every query: its query
 * count and time, the medians over the rounds.
 */
export async function measureReads({ storytree, project, delayMs = 20, rounds = 5, reads = ALL_READS }) {
  const library = await storytree.openProject(project);
  const tree = await library.projectTree();
  const capability = tree.stories[0]?.capabilities[0]?.id;
  const ids = { capability, decision: capability === undefined ? undefined : (await library.frontCovers(capability))[0]?.id };
  const page = { storytree, library, log: await openActivityLog(storytree) };
  const results = [];
  try {
    for (const read of reads) {
      if (!ALL_READS.includes(read)) throw new Error(`no read called ${read}; the reads are ${ALL_READS.join(", ")}`);
      const ask = read === CLICK_DURING_ARC_VIEWS ? () => clickDuringArcViews(page, project, ids) : () => READS[read](page, project, ids).then(() => undefined);
      await ask();
      const queries = [];
      const times = [];
      for (let round = 0; round < rounds; round++) {
        Object.assign(added, { armed: true, delayMs, queries: 0 });
        const began = performance.now();
        let ms;
        try {
          ms = await ask();
        } finally {
          added.armed = false;
        }
        times.push(ms ?? performance.now() - began);
        queries.push(added.queries);
      }
      results.push({ read, queries: median(queries), ms: Math.round(median(times)) });
    }
  } finally {
    await page.log.close();
  }
  return results;
}

/** The click's own time: relatedNotes asked 5 ms after the arcViews reading began, timed to its answer. */
async function clickDuringArcViews(page, project, ids) {
  const background = page.library.arcViews();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const began = performance.now();
  await page.library.relatedNotes(ids.decision);
  const ms = performance.now() - began;
  await background;
  return ms;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function option(args, name, fallback) {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
}

async function main(args) {
  const delayMs = Number(option(args, "delay", "20"));
  const rounds = Number(option(args, "rounds", "5"));
  const reads = option(args, "reads", ALL_READS.join(",")).split(",");
  const size = option(args, "size", "standard");
  seedSize(size);
  const release = await acquireHeavyLock({ root, what: "pnpm lag:reads" });
  let server;
  let folder;
  try {
    let url = process.env.STORYTREE_TEST_PG_URL;
    if (!url) {
      folder = mkdtempSync(path.join(tmpdir(), "lag-reads-"));
      server = await start({ dataDir: path.join(folder, "pgdata"), owner: "a `pnpm lag:reads` run" });
      url = server.url;
    }
    const project = `t-${Math.random().toString(16).slice(2, 10).padEnd(8, "0")}`;
    const storytree = await connect({ url });
    try {
      await seedLagProject(storytree, url, project, size);
      console.log(`lag:reads: the ${size} seed: ${describeSize(size)}`);
      console.log(`lag:reads: ${delayMs} ms added per query, median of ${rounds}\n`);
      console.log(`${"read".padEnd(32)} ${"queries".padStart(8)} ${"ms".padStart(8)}`);
      for (const { read, queries, ms } of await measureReads({ storytree, project, delayMs, rounds, reads })) {
        console.log(`${read.padEnd(32)} ${String(queries).padStart(8)} ${String(ms).padStart(8)}`);
      }
    } finally {
      await storytree.dropProject(project).catch(() => {});
      await storytree.close();
    }
  } finally {
    await server?.stop();
    if (folder) rmSync(folder, { recursive: true, force: true });
    release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`lag:reads: ${error.message}`);
    process.exitCode = 1;
  });
}
