import assert from "node:assert/strict";
import { test } from "node:test";
import { copyCommand } from "./copy-command.js";

test("1.5 · copying preserves every command character and waits for the clipboard", async () => {
  const command = "& (Invoke-Something 'https://example.test/?a=1&b=2')";
  let written = "";
  let done = false;
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const result = copyCommand(command, { writeText: text => { written = text; return pending; } }).then(ok => { done = true; return ok; });
  assert.equal(written, command);
  await Promise.resolve();
  assert.equal(done, false);
  finish();
  assert.equal(await result, true);
});

test("1.5 · clipboard denial returns failure, never a claim that the command was copied", async () => {
  assert.equal(await copyCommand("select this manually", { writeText: async () => { throw new Error("Permission denied"); } }), false);
});
