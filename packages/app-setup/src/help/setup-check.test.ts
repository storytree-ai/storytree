import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setupHelpActions } from "./actions.js";

test("3.2 from the guide, checking a folder whose connection is incomplete shows the setup diagnostics with their recovery fixes; a cancelled pick shows nothing", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-app-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const folder = path.join(dir, "notes");
  mkdirSync(folder);
  let picked: string | undefined;
  const unused = async () => { throw new Error("not used here"); };
  const help = setupHelpActions({ licenseFile: "", storytreeHome: path.join(dir, "home"), chooseFolder: async () => picked, openExternal: unused, copyText: unused, library: () => { throw new Error("not used here"); } });

  assert.equal(await help.checkSetupFolder(), null);
  picked = folder;
  const lines = (await help.checkSetupFolder()) ?? [];
  const project = lines.find((line) => line.check === "project");
  assert.equal(project?.state, "needs-attention", "a folder not yet a project is incomplete");
  assert.ok(project?.fix, "and the diagnostic carries its recovery");
});
