/**
 * Capability 3 · Surfaces: the page's reads, contracts 3.1 and 3.2 in the app story, against the
 * real Postgres `pnpm test` provides. Each test works in projects named t- and 8 hex digits, so
 * tests sharing the server never read each other's, and drops their libraries afterwards.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { openActivityLog, type ActivityLog } from "@storytree/agent-link";
import { connect, type Storytree } from "@storytree/library";
import pg from "pg";

import { pageReads, type PageReads } from "./reads.js";

test("3.1 the page can ask the app for the library's changes and the agent log's new lines since a point, for the project on show, and only newer ones come back", async () => {
  const shown = uniqueProjectName();
  const other = uniqueProjectName();
  await withApp([shown, other], async ({ storytree, log, reads }) => {
    // An agent's work, written as the agent link writes it: into the project's library and the log.
    const library = await storytree.openProject(shown);
    const first = await library.addStory({ title: "Visitor can sign up" });
    await log.append(shown, { session: "A", source: "hook", kind: "session-started" });
    await (await storytree.openProject(other)).addStory({ title: "Another project's story" });
    await log.append(other, { session: "B", source: "hook", kind: "session-started" });

    const changes = await reads.changesSince(shown, 0);
    assert.deepEqual(changes.changes.map(({ recordId }) => recordId), [first.id], "the project on show's changes, and no other project's");
    const lines = await reads.linesSince(shown, 0);
    assert.deepEqual(lines.lines.map(({ session, kind }) => [session, kind]), [["A", "session-started"]], "its lines, and no other project's");

    const second = await library.addStory({ title: "Visitor can sign in" });
    await log.append(shown, { session: "A", source: "hook", kind: "file-edited", files: ["sign-in.ts"] });
    const newerChanges = await reads.changesSince(shown, changes.cursor);
    assert.deepEqual(newerChanges.changes.map(({ recordId }) => recordId), [second.id], "only the newer change comes back");
    const newerLines = await reads.linesSince(shown, lines.cursor);
    assert.deepEqual(newerLines.lines.map(({ kind }) => kind), ["file-edited"], "only the newer line comes back");
  });
});

test("3.2 a name that is not a project is refused, and never created", async () => {
  const missing = uniqueProjectName();
  await withApp([missing], async ({ storytree, reads }) => {
    const asks: [string, () => Promise<unknown>][] = [
      ["its tree", () => reads.projectTree(missing)],
      ["an arc", () => reads.arcView(missing, "arc_1")],
      ["waits", () => reads.waitHolds(missing, "increment_1")],
      ["owner holds", () => reads.heldOnQuestion(missing, "increment_1")],
      ["its changes", () => reads.changesSince(missing, 0)],
      ["its lines", () => reads.linesSince(missing, 0)],
      ["a shelf", () => reads.frontCovers(missing, "story_1")],
      ["a note's related notes", () => reads.relatedNotes(missing, "decision_1")],
    ];
    for (const [what, ask] of asks) {
      await assert.rejects(ask(), new RegExp(`there is no project called "${missing}"`), `asking for ${what} is refused`);
    }
    assert.ok(!(await storytree.listProjects()).includes(missing), "and asking created no project");
  });
});

test("3.4 the page can ask the app for a story's or capability's shelf of front covers, and for the notes that link to a note, for the project on show", async () => {
  const shown = uniqueProjectName();
  await withApp([shown], async ({ storytree, reads }) => {
    const library = await storytree.openProject(shown);
    const story = await library.addStory({ title: "Visitor can sign up" });
    const other = await library.addStory({ title: "Visitor can sign in" });
    const cover = await library.recordDecision({ status: "accepted", title: "Sign-up asks for an email only", text: "Nothing else, to keep it short.", frontCoverOf: story.id });
    await library.recordDecision({ status: "accepted", title: "Sign-in remembers the device", text: "For thirty days.", frontCoverOf: other.id });
    const why = await library.defineTerm({ term: "Name field drop-off", meaning: "Asking for a name lost a third of visitors.", links: [cover.id] });

    assert.deepEqual((await reads.frontCovers(shown, story.id)).map(({ id }) => id), [cover.id], "the story's shelf, and no other's");
    assert.deepEqual((await reads.relatedNotes(shown, cover.id)).map(({ id }) => id), [why.id]);
  });
});

// --- helpers ---------------------------------------------------------------------------------

interface App {
  storytree: Storytree;
  log: ActivityLog;
  reads: PageReads;
}

/** Run `body` with the app's reads over a connection to the test server, then close it all and drop `projects`' libraries. */
async function withApp(projects: readonly string[], body: (app: App) => Promise<void>): Promise<void> {
  const url = testServerUrl();
  const storytree = await connect({ url });
  const log = await openActivityLog(url);
  const reads = pageReads({ storytree });
  try {
    await body({ storytree, log, reads });
  } finally {
    await reads.close();
    await log.close();
    await storytree.close();
    await dropLibraries(projects);
  }
}

/** The server the tests run against: `pnpm test` starts one. A Postgres test must never skip silently. */
function testServerUrl(): string {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined || url === "") {
    throw new Error("STORYTREE_TEST_PG_URL is not set: run the tests via `pnpm test`, which starts a local Postgres.");
  }
  return url;
}

/** A project name no other test, and no earlier run, is using. */
function uniqueProjectName(): string {
  return `t-${randomBytes(4).toString("hex")}`;
}

/** Drop these projects' libraries, if there are any: the library keeps project `name` in the database `storytree_<name>`. */
async function dropLibraries(projects: readonly string[]): Promise<void> {
  const client = new pg.Client({ connectionString: testServerUrl() });
  await client.connect();
  try {
    for (const name of projects) await client.query(`DROP DATABASE IF EXISTS "storytree_${name}" WITH (FORCE)`);
  } finally {
    await client.end();
  }
}
