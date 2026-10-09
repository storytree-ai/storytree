import assert from "node:assert/strict";
import { test } from "node:test";
import * as activity from "../index.js";

test("2.9 · full activity text preserves the recorded command and line identity while compact text stays brief", () => {
  const command = 'pnpm storytree arc increment edit increment_0d9b1b970765 --title "4.7 · `arc increment move …`"\n# keep $literal and quotes';
  for (const kind of ["command-started", "command-run"] as const) {
    for (const causedBy of [undefined, 12]) {
      const line: activity.Line = {
        project: "app", session: "session-A", harness: "codex", source: "hook",
        seq: 42, at: "2026-10-08T01:02:03.000Z", kind, call: "call-A", command,
        ...(causedBy === undefined ? {} : { causedBy }),
      };
      const prefix = `#42  ${line.at}  Codex session-A  ${kind} `;
      const suffix = `  · ${causedBy === undefined ? "cause not recorded" : "caused by #12"}`;
      assert.equal(activity.fullLineText(line), `${prefix}${command}${suffix}`);
      assert.equal(activity.lineText(line), `${prefix}${command.slice(0, 57)}...${suffix}`);
    }
  }
});

test("2.10 · a claim-refused line names the part, its holder, the file and the reason; a claimed line names its file and whom it took over from", () => {
  const common = { project: "app", session: "session-B", harness: "claude-code", source: "hook", seq: 7, at: "2026-10-04T12:29:17.217Z" } as const;
  const prefix = `#7  ${common.at}  Claude Code session-B`;
  const refused: activity.Line = { ...common, kind: "claim-refused", capability: "capability_1", holder: "session-A", reason: "fix the board" };
  assert.equal(activity.lineText(refused), `${prefix}  claim-refused capability_1 held by session-A: fix the board  · cause not recorded`);
  assert.equal(activity.lineText({ ...refused, file: "src/board.ts" }), `${prefix}  claim-refused capability_1 held by session-A, editing src/board.ts: fix the board  · cause not recorded`);
  const claimed: activity.Line = { ...common, kind: "claimed", increment: "increment_1", reason: "build it" };
  assert.equal(activity.lineText(claimed), `${prefix}  claimed increment_1  · cause not recorded`);
  assert.equal(activity.lineText({ ...claimed, file: "src/board.ts", takenOverFrom: "session-A" }), `${prefix}  claimed increment_1, editing src/board.ts, taken over from session-A  · cause not recorded`);
});
