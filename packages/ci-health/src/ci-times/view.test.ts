import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setImmediate as tick } from "node:timers/promises";
import { test } from "node:test";

import { connect } from "@storytree/library";
import { removeTemp } from "@storytree/test-waits";

import { ciTimesReading, type CiTimesReading } from "./reading.js";
import type { ActionsReader } from "./record.js";
import { ciTimesAnswers, recordFromFolder, RECORD_AFTER_MS } from "./runtime.js";
import { ciTimesPool, type CiTimesDb } from "./store.js";
import { mountCiTimes, renderCiTimes, type CiTimesHost } from "./view.js";

const NOW = new Date("2026-11-10T12:00:00Z");
const READING: CiTimesReading = {
  repository: "acme/shop",
  readAt: "2026-11-10T11:57:00.000Z",
  toMerge: { median: 36.4, was: 57, merged: 40, days: [50, 60, null, 55, 57, 58, 70, 40, 36, 30, 36, 38, 35, 33] },
  run: { median: 13.2, bound: "win32", runs: 120 },
  legs: { checks: 12.5, queue: 14, pulls: [] },
  queue: { reds: 22, runs: 100 },
  now: { inCi: 2, inQueue: 1 },
};

/** The text of each of the strip's figures, its markup stripped. */
const lines = (html: string) => html.split("</span><span class=\"ci-times-item\"").map((line) => line.split(/<[^>]*>/).join("").replace(/^[^>]*>/, ""));

/** An element as the page gives the strip, and the document it is in, its adopted stylesheets each the text they were given. */
function host(): CiTimesHost {
  class Sheet { text = ""; replaceSync(text: string) { this.text = text; } }
  return { hidden: false, innerHTML: "", title: "", ownerDocument: { adoptedStyleSheets: [], defaultView: { CSSStyleSheet: Sheet } } };
}

test("6.6 The map's bottom-left strip shows the CI times reading as four dim figures on one line, time to merge with its sparkline, and no strip with nothing recorded", async (t) => {
  assert.deepEqual(lines(renderCiTimes(READING, NOW)), [
    "To merge 36 min ▅▆·▅▆▆█▃▂▁▂▂▂▂ 57 min last week",
    "Run 13 min, Windows slowest",
    "Queue reds 22%",
    "In CI 2, in queue 1, 3 min ago",
  ]);

  const shown = host();
  const block = mountCiTimes(shown, { read: async () => READING, now: () => NOW });
  await tick();
  assert.equal(shown.hidden, false);
  assert.match(shown.innerHTML, /Queue reds 22%/);
  assert.match(shown.title, /22 of 100 merge-queue runs failed/);
  assert.match((shown.ownerDocument.adoptedStyleSheets as unknown as { text: string }[]).map(({ text }) => text).join(""), /\.ci-times \{ position: absolute; left: calc\(var\(--rail-width, 0px\) \+ 12px\); bottom: 8px/,
    "pinned to the map's bottom-left, beside the rail");
  block.stop();
  assert.deepEqual(shown.ownerDocument.adoptedStyleSheets, [], "stopped, it takes its styles away");

  const empty = host();
  const none = mountCiTimes(empty, { read: async () => undefined, now: () => NOW });
  t.after(() => none.stop());
  await tick();
  assert.equal(empty.hidden, true, "nothing recorded shows no strip");
  assert.equal(empty.innerHTML, "");
});

test("6.6 The strip says a long time to merge in hours, and a last recording hours or days old by its age", () => {
  const slow: CiTimesReading = { ...READING, toMerge: { ...READING.toMerge, median: 95, was: 150 }, readAt: "2026-11-10T09:00:00.000Z" };
  assert.deepEqual(lines(renderCiTimes(slow, NOW)).map((line, at) => (at === 0 ? line.replace(/ [▁-█·]+ /, " ") : line)), [
    "To merge 1 h 35 2 h 30 last week",
    "Run 13 min, Windows slowest",
    "Queue reds 22%",
    "In CI 2, in queue 1, 3 h ago",
  ]);
  assert.match(lines(renderCiTimes({ ...slow, readAt: "2026-11-07T12:00:00.000Z" }, NOW))[3]!, /, 3 days ago$/);
  assert.match(lines(renderCiTimes({ ...slow, readAt: NOW.toISOString(), queue: { reds: 0, runs: 0 } }, NOW)).slice(2).join("|"), /^Queue reds —\|.*, just now$/);
});

test("6.6 The app records only from a project folder whose origin is on GitHub, into that repository's times", async (t) => {
  const { db, project } = await store(t);
  const asked: string[] = [];
  const actions: ActionsReader = {
    json: async (route) => { asked.push(route); return route.includes("/pulls") ? [] : { workflow_runs: [], jobs: [], artifacts: [] }; },
    graphql: async () => ({ data: { search: { pageInfo: { hasNextPage: false }, nodes: [] } } }),
    download: async () => {},
  };
  const folder = mkdtempSync(path.join(tmpdir(), "ci-times-folder-"));
  t.after(() => removeTemp(folder));
  execFileSync("git", ["-C", folder, "init", "-q"]);
  await recordFromFolder(db, project, folder, actions);
  assert.equal(asked.length, 0, "a folder with no GitHub origin asks GitHub nothing");
  assert.equal(await ciTimesReading(db, project, NOW), undefined, "and records nothing");

  execFileSync("git", ["-C", folder, "remote", "add", "origin", "git@github.com:acme/shop.git"]);
  await recordFromFolder(db, project, folder, actions);
  assert.ok(asked.every((route) => route.startsWith("repos/acme/shop/")) && asked.length > 0, "its origin's repository is asked");
  assert.equal((await ciTimesReading(db, project))?.repository, "acme/shop");
});

test("6.9 The app's own recording keeps each open pull request's scope too, by CI's own rule over the project's folder", async (t) => {
  const { db, project } = await store(t);
  const actions: ActionsReader = {
    json: async (route) => {
      if (route.startsWith("repos/acme/shop/pulls?state=open")) return route.endsWith("page=1") ? [{ number: 7, head: { sha: "f1" } }] : [];
      if (route.startsWith("repos/acme/shop/pulls/7/files")) return [{ filename: "packages/forest/src/a.ts" }];
      return { workflow_runs: [], jobs: [], artifacts: [] };
    },
    graphql: async () => ({ data: { search: { pageInfo: { hasNextPage: false }, nodes: [] } } }),
    download: async () => {},
  };
  const folder = mkdtempSync(path.join(tmpdir(), "ci-times-folder-"));
  t.after(() => removeTemp(folder));
  execFileSync("git", ["-C", folder, "init", "-q"]);
  execFileSync("git", ["-C", folder, "remote", "add", "origin", "git@github.com:acme/shop.git"]);
  writeFileSync(path.join(folder, "package.json"), JSON.stringify({ name: "acme" }));
  for (const [dir, name, deps] of [["packages/forest", "@acme/forest", {}], ["packages/map", "@acme/map", { "@acme/forest": "workspace:*" }], ["packages/cli", "@acme/cli", {}]] as const) {
    mkdirSync(path.join(folder, dir, "src"), { recursive: true });
    writeFileSync(path.join(folder, dir, "package.json"), JSON.stringify({ name, dependencies: deps }));
  }
  await recordFromFolder(db, project, folder, actions);
  const { rows } = await db.query<Record<string, unknown>>("SELECT pull, head_sha, every AS full, dirs FROM ci_pull_scopes WHERE project = $1", [project]);
  assert.deepEqual(rows, [{ pull: 7, head_sha: "f1", full: false, dirs: ["packages/forest", "packages/map"] }], "its changed package and the one depending on it");
});

async function store(t: { after(fn: () => Promise<void>): void }): Promise<{ server: Awaited<ReturnType<typeof connect>>; db: CiTimesDb; project: string }> {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined) throw new Error("run the tests via `pnpm test`, which starts a local Postgres");
  const server = await connect({ url });
  const project = `t-${randomBytes(4).toString("hex")}`;
  await server.openProject(project);
  const db = await ciTimesPool(server);
  t.after(async () => {
    try {
      await db.query("DELETE FROM ci_readings WHERE project = $1", [project]);
      await server.dropProject(project);
    } finally {
      await server.close();
    }
  });
  return { server, db, project };
}

test("6.6 While the strip is on show the app records again once the last recording is ten minutes old, one recording at a time, and answers without waiting on it", async (t) => {
  const { server, db, project } = await store(t);
  let now = NOW;
  const started: string[] = [];
  // Each recording waits for the test to let it go, and says when it has written.
  let finish!: () => void;
  let recorded!: Promise<void>;
  const answers = ciTimesAnswers({ server: () => server, library: () => ({ projectFolder: async () => "/work/shop" }) }, {
    now: () => now,
    record: (into, name, folder) => {
      started.push(folder);
      recorded = new Promise<void>((resolve) => { finish = resolve; })
        .then(() => into.query("INSERT INTO ci_readings (project, repository, read_at) VALUES ($1, 'acme/shop', $2) ON CONFLICT (project) DO UPDATE SET read_at = EXCLUDED.read_at", [name, now]))
        .then(() => undefined);
      return recorded;
    },
  });
  /** Let the recording under way finish, and the answer hear it has. */
  const finished = async () => {
    finish();
    await recorded;
    await tick();
  };

  assert.equal(await answers.ciTimes(project), undefined, "nothing recorded yet, answered at once");
  await tick();
  assert.deepEqual(started, ["/work/shop"], "a recording starts");
  await answers.ciTimes(project);
  await tick();
  assert.equal(started.length, 1, "never two at once");
  await finished();

  now = new Date(NOW.getTime() + RECORD_AFTER_MS - 1000);
  assert.equal((await answers.ciTimes(project))?.repository, "acme/shop");
  await tick();
  assert.equal(started.length, 1, "a recording younger than ten minutes is not repeated");

  now = new Date(NOW.getTime() + RECORD_AFTER_MS);
  await answers.ciTimes(project);
  await tick();
  assert.equal(started.length, 2, "ten minutes on, it records again");
  await finished();
  await assert.rejects(answers.ciTimes("no-such-project"), /there is no project called/);
  assert.equal((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM ci_readings WHERE project = 'no-such-project'")).rows[0]!.n, 0);
});

test("6.8 Given a live count of the pull requests in CI and in the queue, the strip says it, live, rather than the last recording's; without one it says the recording's", async (t) => {
  const live = { inCi: 4, inQueue: 0 };
  assert.equal(lines(renderCiTimes(READING, NOW, live))[3], "In CI 4, in queue 0, live");

  const shown = host();
  const block = mountCiTimes(shown, { read: async () => READING, going: () => live, now: () => NOW });
  t.after(() => block.stop());
  const none = host();
  const recorded = mountCiTimes(none, { read: async () => READING, going: () => undefined, now: () => NOW });
  t.after(() => recorded.stop());
  await tick();
  assert.match(shown.innerHTML, /In CI 4, in queue 0, live/);
  assert.match(shown.title, /In CI and in queue: the open pull requests as their branch states say them now\./);
  assert.match(none.innerHTML, /In CI 2, in queue 1, 3 min ago/, "no live count: the recording's");
  assert.match(none.title, /In CI and in queue: as the last recording saw them/);
});
