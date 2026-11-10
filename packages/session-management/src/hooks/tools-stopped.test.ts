/**
 * Capability 3 · Hooks, contract 3.57: a Claude Code or Codex session in a storytree project that started before an
 * update's setup stopped storytree's tool servers (its record in the storytree home, Updates 4.46) is told, once, at its
 * next prompt or turn end, why storytree's tools are gone and what the user should do. Real hook runs on real files.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { withTempDir } from "@storytree/project-and-caller/testing/folders";
import { CLOSE_OUT_REMINDER, runHook } from "./index.js";
import { TOOLS_STOPPED } from "./tools-stopped.js";

test("3.57 a session started before an update stopped storytree's tools is told why and how to reconnect, once, at its next prompt or turn end; one started or resumed after it, one with no stop recorded, or one outside a project is not", async () => {
  const was = process.env.STORYTREE_HOME;
  try {
    await withTempDir(async (dir) => {
      const home = path.join(dir, "storytree-home");
      const site = path.join(dir, "site");
      const elsewhere = path.join(dir, "elsewhere");
      for (const folder of [home, site, elsewhere]) mkdirSync(folder, { recursive: true });
      writeFileSync(path.join(site, ".storytree.json"), `${JSON.stringify({ project: "tools-stopped-test" })}\n`);
      process.env.STORYTREE_HOME = home;
      const transcript = (session: string) => {
        const file = path.join(dir, `${session}.jsonl`);
        writeFileSync(file, "{}\n");
        return file;
      };
      const hook = (harness: string, event: string, session: string, extra: Record<string, unknown> = {}, flags: string[] = []) =>
        runHook({ argv: [harness, ...flags], input: JSON.stringify({ hook_event_name: event, session_id: session, cwd: site, transcript_path: path.join(dir, `${session}.jsonl`), ...extra }) });
      const prompt = (harness: string, session: string, extra: Record<string, unknown> = {}) => hook(harness, "UserPromptSubmit", session, { prompt: "carry on", ...extra });
      const turnEnd = (harness: string, session: string) => hook(harness, "Stop", session, {}, [CLOSE_OUT_REMINDER]);
      const said = (answer: string | undefined) => JSON.parse(answer ?? "{}") as { hookSpecificOutput?: { additionalContext?: string }; systemMessage?: string; decision?: string; reason?: string };

      const [claude, codex, compacted, resumed, unrecorded] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
      for (const session of [claude, codex, compacted, resumed, unrecorded]) transcript(session);
      assert.equal(await prompt("claude-code", unrecorded), undefined, "no stop recorded: nothing to tell");

      // The setup's stop step, after these sessions began.
      await new Promise((resolve) => setTimeout(resolve, 20));
      const stopped = path.join(home, TOOLS_STOPPED);
      writeFileSync(stopped, "stopped\r\n");
      const at = new Date(statSync(path.join(dir, `${claude}.jsonl`)).birthtimeMs + 10);
      utimesSync(stopped, at, at);
      const late = randomUUID();
      transcript(late);
      await hook("claude-code", "SessionStart", late, { source: "startup" });

      const told = said(await prompt("claude-code", claude));
      assert.match(told.hookSpecificOutput?.additionalContext ?? "", /storytree's tools in this session were stopped by a storytree update/);
      assert.match(told.hookSpecificOutput?.additionalContext ?? "", /\/mcp/);
      assert.match(told.systemMessage ?? "", /\/mcp/, "the user is shown it too");
      assert.equal(said(await prompt("claude-code", claude)).hookSpecificOutput?.additionalContext, undefined, "told once per session");
      assert.equal(await turnEnd("claude-code", claude), undefined, "told once, across the prompt and the turn end");

      // A Codex session with no new prompt coming: its turn end tells it, and its next prompt does not again.
      const ended = said(await turnEnd("codex", codex));
      assert.equal(ended.decision, "block");
      assert.match(ended.reason ?? "", /restart/i);
      assert.equal(said(await prompt("codex", codex)).hookSpecificOutput?.additionalContext, undefined);

      // A compaction keeps the old tool server's session: it is still told.
      await hook("claude-code", "SessionStart", compacted, { source: "compact" });
      assert.match(said(await prompt("claude-code", compacted)).hookSpecificOutput?.additionalContext ?? "", /stopped by a storytree update/);

      assert.equal(said(await prompt("claude-code", late)).hookSpecificOutput?.additionalContext, undefined, "started after the stop: its tools run");
      await hook("codex", "SessionStart", resumed, { source: "resume" });
      assert.equal(await turnEnd("codex", resumed), undefined, "resumed after the stop: its tool server started again");
      const outside = randomUUID();
      transcript(outside);
      utimesSync(stopped, new Date(), new Date());
      assert.equal(await prompt("claude-code", outside, { cwd: elsewhere }), undefined, "outside a storytree project: nothing is said");
    });
  } finally {
    if (was === undefined) delete process.env.STORYTREE_HOME;
    else process.env.STORYTREE_HOME = was;
  }
});
