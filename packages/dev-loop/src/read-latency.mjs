// `pnpm lag:reads`: what the page's reads cost against a slow library (ADR-0836), measured the same
// way by every lane (capability 8, Lag instruments). It seeds one fixed project into a throwaway
// Postgres, adds a fixed delay to every pg query to stand in for Cloud SQL's round trip, and prints
// each page read's query count and median time over the rounds, as the app answers the page
// (`pageReads`). A report to read at an increment boundary, never a gate (ADR-0623).
//
//   pnpm lag:reads [--delay 20] [--rounds 5] [--reads arcViews,holds,...]
//
// The server is STORYTREE_TEST_PG_URL's when set, otherwise its own, started in a temporary folder
// under the machine's heavy-run lock so no test run shares the box with the measurement. Compare a
// branch with main by running it in both checkouts.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { openActivityLog } from "@storytree/agent-link";
import { pageReads } from "@storytree/app";
import { connect } from "@storytree/library";
import { start } from "@storytree/local-postgres";
import pg from "pg";

import { acquireHeavyLock } from "./heavy-lock.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));

/** The one seed: the size #391 measured, with a question on every arc. */
export const SEED = { arcs: 25, incrementsPerArc: 8, stories: 5, capabilitiesPerStory: 3, contractsPerCapability: 2, logLines: 40 };

/** Each read the instrument knows, as the page asks it of `reads`; `ids` are the seed's. */
const READS = {
  listProjects: (reads) => reads.listProjects(),
  projectTree: (reads, project) => reads.projectTree(project),
  changesSince: (reads, project) => reads.changesSince(project, 0),
  linesSince: (reads, project) => reads.linesSince(project, 0),
  arcViews: (reads, project) => reads.arcViews(project),
  holds: (reads, project) => reads.holds(project),
  frontCovers: (reads, project, ids) => reads.frontCovers(project, ids.capability),
  relatedNotes: (reads, project, ids) => reads.relatedNotes(project, ids.decision),
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
 * Seed `project` in `storytree`'s library and the activity log on `url`: arcs with increments and a
 * question each, stories with capabilities, contracts and a front cover each, and agent log lines.
 * Nothing here is counted or delayed. `size` overrides parts of SEED.
 */
export async function seedLagProject(storytree, url, project, size = {}) {
  const seed = { ...SEED, ...size };
  const library = await storytree.openProject(project);
  for (let s = 0; s < seed.stories; s++) {
    const story = await library.addStory({ title: `Story ${s + 1}` });
    for (let c = 0; c < seed.capabilitiesPerStory; c++) {
      const capability = await library.addCapability({ title: `Capability ${s + 1}.${c + 1}`, story: story.id });
      await library.recordDecision({ status: "accepted", title: `Founding ${s + 1}.${c + 1}`, text: "Why it is shaped so", frontCoverOf: capability.id });
      for (let k = 0; k < seed.contractsPerCapability; k++) {
        await library.addContract({ title: `Promise ${s + 1}.${c + 1}.${k + 1}`, capability: capability.id });
      }
    }
  }
  for (let a = 0; a < seed.arcs; a++) {
    const arc = await library.createArc({ title: `Arc ${a + 1}`, intent: "Ship it", endState: "It shipped" });
    for (let i = 0; i < seed.incrementsPerArc; i++) {
      await library.addIncrement({ arc: arc.id, title: `Increment ${a + 1}.${i + 1}`, objective: "Build it", body: "One piece, then the next." });
    }
    await library.raiseQuestion({ arc: arc.id, title: "Which way?", stakes: "Blocks the arc", statement: "Short or long?", context: "None yet", options: "Short or long" });
  }
  const log = await openActivityLog(url);
  try {
    for (let n = 0; n < seed.logLines; n++) {
      const line = n < 4 ? { kind: "session-started" } : { kind: "file-edited", files: [`packages/p${n % 5}/src/file.ts`] };
      await log.append(project, { session: `lag-${n % 4}`, source: "hook", ...line });
    }
  } finally {
    await log.close();
  }
}

/**
 * Each of `reads` (names from ALL_READS) asked through the page's reads over `storytree`, once to
 * warm the libraries it opens, then `rounds` times with `delayMs` added to every query: its query
 * count and time, the medians over the rounds.
 */
export async function measureReads({ storytree, project, delayMs = 20, rounds = 5, reads = ALL_READS }) {
  const library = await storytree.openProject(project);
  const tree = await library.projectTree();
  const capability = tree.stories[0]?.capabilities[0]?.id;
  const ids = { capability, decision: capability === undefined ? undefined : (await library.frontCovers(capability))[0]?.id };
  const page = pageReads({ storytree });
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
    await page.close();
  }
  return results;
}

/** The click's own time: relatedNotes asked 5 ms after the arcViews reading began, timed to its answer. */
async function clickDuringArcViews(page, project, ids) {
  const background = page.arcViews(project);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const began = performance.now();
  await page.relatedNotes(project, ids.decision);
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
      await seedLagProject(storytree, url, project);
      console.log(`lag:reads: ${SEED.arcs} arcs x ${SEED.incrementsPerArc} increments, a question each; ${SEED.stories} stories x ${SEED.capabilitiesPerStory} capabilities x ${SEED.contractsPerCapability} contracts; ${SEED.logLines} log lines`);
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
