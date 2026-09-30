/**
 * Capability 3 · Hooks, contract 3.17 (ADR-0758 D4): when a Claude Code or Codex turn ends in a storytree
 * project on a branch whose work has reached main, and the session has not closed out, the Stop
 * hook asks it to, once. Real git in a throwaway repository with an origin beside it; the close-out
 * is written to the real log on the Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { openActivityLog } from "../activity/index.js";
import { closeOut } from "../sessions/index.js";
import { git, withTempDir } from "../testing/folders.js";
import { testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { CLOSE_OUT_REMINDER, runHook } from "./index.js";

test("3.17 a turn that ends with its branch merged and no close-out is asked, once, to close out; a fresh branch with no commits of its own, a branch still ahead, main, a stop the reminder caused, or a session that closed out is not", async () => {
  await withTempDir(async (dir) => {
    const origin = path.join(dir, "origin.git");
    const site = path.join(dir, "site");
    git(dir, "init", "--bare", "-b", "main", origin);
    git(dir, "init", "-b", "main", site);
    writeFileSync(path.join(site, ".storytree.json"), `${JSON.stringify({ project: uniqueProjectName() })}\n`);
    git(site, "add", ".");
    git(site, "commit", "-m", "first");
    git(site, "remote", "add", "origin", origin);
    git(site, "push", "-q", "origin", "main");
    const stop = (session: string, extra: Record<string, unknown> = {}, harness = "claude-code") =>
      runHook({ argv: [harness, CLOSE_OUT_REMINDER], input: JSON.stringify({ hook_event_name: "Stop", session_id: session, cwd: site, ...extra }) });
    const [asked, again, caused, done] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];

    assert.equal(await stop(asked), undefined, "on main: nothing to close out");
    git(site, "checkout", "-q", "-b", "fix-login");
    assert.equal(await stop(asked), undefined, "a fresh branch at main has no work of its own to have merged");
    git(site, "commit", "-q", "--allow-empty", "-m", "fix");
    assert.equal(await stop(asked), undefined, "its branch is still ahead of main");

    git(site, "push", "-q", "origin", "fix-login:main");
    git(site, "fetch", "-q", "origin");
    const reminder = JSON.parse((await stop(asked)) ?? "{}") as { decision?: string; reason?: string };
    assert.equal(reminder.decision, "block");
    assert.match(reminder.reason ?? "", /fix-login/);
    assert.match(reminder.reason ?? "", /storytree session close-out --safe yes\|no --why/);
    assert.equal(await stop(asked), undefined, "asked once per session");
    const codex = JSON.parse((await stop(randomUUID(), {}, "codex")) ?? "{}") as { decision?: string };
    assert.equal(codex.decision, "block", "a Codex session is asked the same way");
    assert.equal(await stop(again, { stop_hook_active: true }), undefined, "never again for the turn the reminder itself caused");

    const log = await openActivityLog(testServerUrl());
    try {
      await closeOut({ log, project: uniqueProjectName(), session: done, harness: "claude-code", folder: site }, { safe: true, why: "merged" });
    } finally {
      await log.close();
    }
    assert.equal(await stop(done), undefined, "a session that closed out here is not asked");
  });
});
