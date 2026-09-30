import assert from "node:assert/strict";
import { test } from "node:test";
import { installCommand } from "./install-command.js";

test("1.2 · the README Install section is the one source of the command", () => {
  assert.equal(installCommand("# Product\r\n\r\n## Install\r\n\r\n```powershell\r\nWrite-Output '<ready>&'\r\n```\r\n\r\n## Develop\r\n```powershell\r\nDo-Something-Else\r\n```"), "Write-Output '<ready>&'");
});

test("1.2 · missing, empty, multiline or ambiguous install commands fail the build", () => {
  for (const text of [
    "# Product",
    "## Install\n```powershell\n```",
    "## Install\n```powershell\nfirst\nsecond\n```",
    "## Install\n```powershell\nfirst\n```\n```powershell\nsecond\n```",
    "## Install\n```powershell\nfirst\n```\n## Install\n```powershell\nsecond\n```",
  ]) assert.throws(() => installCommand(text), /install command/i);
});
