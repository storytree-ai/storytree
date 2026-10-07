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
