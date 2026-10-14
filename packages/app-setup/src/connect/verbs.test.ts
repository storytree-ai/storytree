/**
 * Capability 2 · Connect an agent: the `setup connect`, `disconnect` and `uninstall` verbs the app setup declares for the
 * command line, run beside a stand-in for the installed helper that says the words it was handed.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { VerbRefusal, type DoorWords, type Verb } from "@storytree/project-and-caller/verbs";

import { SETUP_FAMILIES, type SetupVerbContext } from "../verbs.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };

function verbOf(name: string): Verb<never, SetupVerbContext> {
  const setup = SETUP_FAMILIES.find((family) => family.name === "setup")!;
  return setup.verbs.find((one) => "name" in one.command && one.command.name === name)! as Verb<never, SetupVerbContext>;
}

function beside(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(path.join(tmpdir(), "setup-verbs-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, "storytree-deliver.mjs"), "console.log(JSON.stringify(process.argv.slice(2)));");
  return path.join(dir, "storytree.mjs");
}

test("2.1 / 2.5 · setup connect hands the installed helper each chosen agent and says it connected; disconnect hands it the one agent", async (t) => {
  const script = beside(t);
  let connected = 0;
  const context: SetupVerbContext = { folder: path.dirname(script), script, journey: async () => ({ projectCreated() {}, agentConnected() { connected++; } }) };
  const act = (name: string, input: Record<string, unknown>) => verbOf(name).act(input as never, context, WORDS);

  const connect = await act("connect", { claude: true, codex: true, cursor: false, pi: false, antigravity: false });
  assert.deepEqual(JSON.parse(connect.text), ["connect", "claude-code", "codex"]);
  assert.equal(connected, 1, "connecting is a journey event");
  assert.deepEqual(JSON.parse((await act("disconnect", { harness: "codex" })).text), ["disconnect", "codex"]);
  assert.deepEqual(JSON.parse((await act("uninstall", { "keep-library": true, "remove-library": false })).text), ["open-uninstaller", "keep"]);
});

test("2.4 · setup connect with no agent chosen, disconnect of no one agent, or uninstall told both is refused as a misuse; away from an installed storytree, it says to re-run the installer", async (t) => {
  const script = beside(t);
  const context: SetupVerbContext = { folder: path.dirname(script), script };
  const refused = async (name: string, input: Record<string, unknown>, at: SetupVerbContext = context) =>
    verbOf(name).act(input as never, at, WORDS).then(() => assert.fail(`${name} was not refused`), (error: unknown) => {
      assert.ok(error instanceof VerbRefusal, String(error));
      return error;
    });

  const none = { claude: false, codex: false, cursor: false, pi: false, antigravity: false };
  assert.match((await refused("connect", none)).message, /^Choose --claude, --codex, --cursor, --pi, --antigravity or several/);
  assert.equal((await refused("connect", none)).misuse, true);
  assert.equal((await refused("disconnect", { harness: "both" })).misuse, true);
  assert.equal((await refused("uninstall", { "keep-library": true, "remove-library": true })).misuse, true);
  const away = await refused("connect", { ...none, claude: true }, { folder: context.folder });
  assert.match(away.message, /only an installed storytree has it\. Re-run the storytree installer/);
  assert.equal(away.misuse, false);
});
