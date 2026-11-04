import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { removeTemp } from "@storytree/test-waits";
import { setupHelpActions } from "./actions.js";

test("3.2 from the guide, checking a folder whose connection is incomplete shows the setup diagnostics with their recovery fixes; a cancelled pick shows nothing", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-app-check-"));
  t.after(() => removeTemp(dir));
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

test("8.45 from the guide, checking a folder names each plugin in this computer's factory that no part setting names, with the command that names it, and none the setting names", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-app-check-"));
  t.after(() => removeTemp(dir));
  const home = path.join(dir, "home");
  const plugin = (name: string, manifest: Record<string, unknown>) => {
    mkdirSync(path.join(home, "your-factory", "plugins", name), { recursive: true });
    writeFileSync(path.join(home, "your-factory", "plugins", name, "package.json"), JSON.stringify({ name, storytree: { interface: 1, verbs: [{ from: "./verbs", export: "PLUGIN_FAMILIES" }], ...manifest } }));
  };
  plugin("micks-dev-loop", {});
  plugin("my-runner", { for: "agent-pool" });
  plugin("ci-health", {});
  writeFileSync(path.join(home, "settings.json"), JSON.stringify({ "stand-ins": { "ci-health": "ci-health" } }));
  const unused = async () => { throw new Error("not used here"); };
  const help = setupHelpActions({ licenseFile: "", storytreeHome: home, chooseFolder: async () => dir, openExternal: unused, copyText: unused, library: () => { throw new Error("not used here"); } });

  const factory = ((await help.checkSetupFolder()) ?? []).filter((line) => line.check === "factory");

  assert.deepEqual(factory.map((line) => line.fix?.match(/`storytree settings set part \S+ plugin \S+`/)?.[0]), [
    "`storytree settings set part micks-dev-loop plugin micks-dev-loop`",
    "`storytree settings set part agent-pool plugin my-runner`",
  ]);
});
