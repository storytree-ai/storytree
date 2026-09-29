/**
 * Capability 4 · Sessions, contract 4.11: which sessions the Claude desktop app and Codex keep in
 * their own records, and whether they are archived there (ADR-0754 D4), read from files made in
 * the formats measured on the owner's laptop on 2026-09-29 (Claude's local_<id>.json, Codex's
 * state_5.sqlite `threads`), and written to the real activity log on the Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { openActivityLog, type Line } from "../activity/index.js";
import { withTempDir } from "../testing/folders.js";
import { testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { readAppRecords, recordAppStates } from "./index.js";

function claudeSession(folder: string, id: string, cliSessionId: string, isArchived: boolean): void {
  writeFileSync(path.join(folder, `local_${id}.json`), JSON.stringify({ sessionId: `local_${id}`, cliSessionId, isArchived, lastActivityAt: Date.now(), title: "a session" }));
}

test("4.11 the sessions the Claude desktop app and Codex keep are read from their own files, and each one this project knows gets a line saying whether it is archived there, written only when that changes; Codex's headless runs and subagents are not the app's; absent files are read as absent and damaged ones as unreadable, and neither writes anything", async () => {
  const log = await openActivityLog(testServerUrl());
  const project = uniqueProjectName();
  try {
    await withTempDir(async (dir) => {
      const claude = path.join(dir, "Claude", "claude-code-sessions", "account-1", "org-1");
      mkdirSync(claude, { recursive: true });
      claudeSession(claude, "a", "c-open", false);
      claudeSession(claude, "b", "c-arch", true);
      writeFileSync(path.join(claude, "local_bad.json"), "not json");
      const codexState = path.join(dir, "codex", "state_5.sqlite");
      mkdirSync(path.dirname(codexState));
      const db = new DatabaseSync(codexState);
      db.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, source TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, archived_at INTEGER)");
      const thread = db.prepare("INSERT INTO threads (id, source, archived) VALUES (?, ?, ?)");
      for (const [id, source, archived] of [["x-cli", "cli", 0], ["x-arch", "vscode", 1], ["x-exec", "exec", 0], ["x-sub", '{"subagent":{"thread_spawn":{"depth":1}}}', 0], ["x-unknown", "cli", 0]] as const) thread.run(id, source, archived);
      db.close();
      const places = { claudeSessions: path.join(dir, "Claude", "claude-code-sessions"), codexState };

      for (const session of ["c-open", "c-arch", "x-cli", "x-arch", "x-exec", "x-sub"]) {
        await log.append(project, { session, source: "hook", folder: "/work/site", kind: "session-started" });
      }
      const watcher = { log, project, folder: "/work/site", session: "observer", harness: "claude-code", source: "hook" } as const;
      const watch = { places, everyMs: 0 };
      const records = (lines: readonly Line[]) => lines.flatMap((line) => (line.kind === "session-archived" || line.kind === "session-unarchived" ? [[line.of, line.kind, line.app, line.session]] : [])).sort();

      assert.deepEqual(records(await recordAppStates(watcher, watch)), [
        ["c-arch", "session-archived", "claude-desktop", "observer"],
        ["c-open", "session-unarchived", "claude-desktop", "observer"],
        ["x-arch", "session-archived", "codex", "observer"],
        ["x-cli", "session-unarchived", "codex", "observer"],
      ]);
      assert.deepEqual(await recordAppStates(watcher, watch), [], "nothing changed, nothing written");
      claudeSession(claude, "b", "c-arch", false);
      assert.deepEqual(records(await recordAppStates(watcher, watch)), [["c-arch", "session-unarchived", "claude-desktop", "observer"]], "un-archived");

      const absent = { claudeSessions: path.join(dir, "nowhere", "claude-code-sessions"), codexState: path.join(dir, "nowhere", "state_5.sqlite") };
      assert.deepEqual((await readAppRecords(absent)).map(({ app, state }) => [app, state]), [["claude-desktop", "absent"], ["codex", "absent"]]);
      assert.deepEqual(await recordAppStates(watcher, { places: absent, everyMs: 0 }), []);
      writeFileSync(codexState, "not a database");
      const damaged = await readAppRecords(places);
      assert.deepEqual(damaged.map(({ app, state }) => [app, state]), [["claude-desktop", "read"], ["codex", "unreadable"]]);
    });
  } finally {
    await log.close();
  }
});
