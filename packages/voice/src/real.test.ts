/**
 * Contracts 2.2, 2.8, 2.9 and 1.13 against the real storytree command line and a throwaway library on the Postgres
 * `pnpm test` provides: the door's shaping of the command line's real output, and the session its children record as.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

import { setUpProject } from "@storytree/app-setup/project";
import { connect as connectLibrary } from "@storytree/library";
import { dropTestDatabases } from "@storytree/local-postgres/testing";
import { placeTestServer, testServerUrl } from "@storytree/project-and-caller/testing/pg";

import { LIMITS } from "./children.js";
import { loadConfig, voiceSession } from "./config.js";
import { startDoor } from "./door.js";
import { connect, newToken, textOf } from "./testing/door.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
/** The command line from this checkout's source, run directly as the door runs it on the box. */
const CLI = [process.execPath, "--import", pathToFileURL(path.join(root, "node_modules", "tsx", "dist", "loader.mjs")).href, path.join(root, "packages", "cli", "src", "bins", "storytree.ts")];

test("2.2, 2.8, 2.9, 1.13 against the real command line: catch_up's order, what landed, a record's history, and the voice session its children record as", async () => {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), "storytree-voice-real-")));
  const project = `t-${randomBytes(4).toString("hex")}`;
  const server = await connectLibrary({ url: testServerUrl() });
  try {
    const folder = path.join(dir, "site");
    const home = path.join(dir, "home");
    for (const made of [folder, home]) mkdirSync(made, { recursive: true });
    placeTestServer(path.join(home, "pgdata"));
    const library = await server.openProject(project);
    await setUpProject({ folder, project, storytree: server, storytreeHome: home, join: true });
    rmSync(path.join(home, "project-choice.json"), { force: true });

    const arc = await library.createArc({ title: "Voice reaches storytree", intent: "Talk to it", endState: "It answers" });
    const waiting = await library.addIncrement({ arc: arc.id, title: "Install the door on the box", objective: "o", body: "b" });
    await library.addWaitFor(waiting.id, { releaser: "owner", note: "Say when the phone call works." });
    const older = await library.raiseQuestion({ arc: arc.id, title: "Sign in through WorkOS?", stakes: "s", statement: "s", context: "c", options: "a or b" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const newer = await library.raiseQuestion({ arc: arc.id, title: "Keep the secret address alone?", stakes: "s", statement: "s", context: "c", options: "a or b" });
    const done = await library.addIncrement({ arc: arc.id, title: "A tested read door", objective: "o", body: "b" });
    await library.closeIncrement(done.id, { disposition: "landed", pr: "#1721" });

    const config = loadConfig({ ...process.env, STORYTREE_HOME: home, VOICE_TOKEN: newToken(), REPO_DIR: folder, STORYTREE_CLI: JSON.stringify(CLI), PORT: "0", CLAUDE_CODE_SESSION_ID: "the-owners-session" });
    const door = await startDoor(config, { limits: LIMITS, log: () => {} });
    const client = await connect(door.port, config.token);
    try {
      const caught = textOf((await client.callTool({ name: "catch_up", arguments: {} })) as never);
      const numbered = caught.split("\n").filter((line) => /^\d+\. /.test(line));
      assert.deepEqual(numbered.map((line) => / — (\S+)$/.exec(line)?.[1]), [waiting.id, older.id, newer.id, done.id], caught);
      assert.match(numbered[0]!, /^1\. Install the door on the box: Say when the phone call works\./);
      assert.match(numbered[3]!, /^4\. A tested read door \(#1721\), on Voice reaches storytree — /);

      const changed = textOf((await client.callTool({ name: "what_changed", arguments: { span: "last hour" } })) as never);
      assert.match(changed, /^Voice reaches storytree:\n {2}1\. A tested read door \(#1721\) — increment_[0-9a-f]{12}$/m);

      const history = textOf((await client.callTool({ name: "what_changed", arguments: { id: done.id } })) as never);
      const entries = history.split("\n").filter((line) => /^\d+\. /.test(line));
      assert.ok(entries.length >= 2, history);
      assert.match(entries.at(-1)!, /^\d+\. \S+ created by \S+$/);

      // The children ran as the day's voice session, never as the owner's: the sessions list names it.
      const sessions = execFileSync(CLI[0]!, [...CLI.slice(1), "session", "list", "--all", "--json"], { cwd: folder, env: { ...process.env, STORYTREE_HOME: home, CLAUDE_CODE_SESSION_ID: "", CODEX_THREAD_ID: "", STORYTREE_SESSION_ID: "" }, encoding: "utf8" });
      assert.ok(sessions.includes(voiceSession(new Date())), sessions.slice(0, 600));
      assert.ok(!sessions.includes("the-owners-session"), "a child ran as the owner's session");
    } finally {
      await client.close();
      await door.close();
    }
  } finally {
    await server.close();
    await dropTestDatabases([`storytree_${project}`]);
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
