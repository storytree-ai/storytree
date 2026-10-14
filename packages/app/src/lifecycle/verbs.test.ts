/** Capability 1 · Lifecycle, contract 1.7, as the declared `app quit` answers it to whichever door mounts it. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { DoorWords } from "@storytree/project-and-caller/verbs";

import { APP_FAMILIES } from "./verbs.js";

const words: DoorWords = { door: "command", say: (step) => step.command ?? step.tool! };

test("1.7 the declared `app quit`, with no app ever started under the storytree home, says storytree isn't running and needs no caller", async (t) => {
  const home = mkdtempSync(path.join(tmpdir(), "storytree-quit-verb-"));
  const was = process.env.STORYTREE_HOME;
  process.env.STORYTREE_HOME = home;
  t.after(() => {
    if (was === undefined) delete process.env.STORYTREE_HOME;
    else process.env.STORYTREE_HOME = was;
    rmSync(home, { recursive: true, force: true });
  });
  const [app] = APP_FAMILIES;
  assert.equal(app!.name, "app");
  const quit = app!.verbs.find((each) => "name" in each.command && each.command.name === "quit")!;
  assert.equal(quit.callerless, true);
  const answer = await quit.act({}, { folder: home }, words);
  assert.equal(answer.text, "storytree isn't running, so there is nothing to quit.");
});
