/** Capability 5 · Claims and 14 · See what remains: Session management's tools, as its tool part registers them for the MCP server. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { connect } from "@storytree/library";
import { testServerUrl, uniqueProjectName } from "@storytree/library/testing/pg";

import { reportContract, sessionTools, type ToolCall } from "./tools.js";

type Act = (args: Record<string, unknown>, call: { owner: undefined; locate: { dataDir: string } }) => Promise<{ text: string; data?: Record<string, unknown> }>;

test("14.6 the runs tools refuse a caller the server could not resolve, all but list_all_runs, which reads every session's runs with nobody resolved", async (t) => {
  const home = mkdtempSync(path.join(tmpdir(), "session-tools-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const acts = new Map<string, { act: Act; anyCaller: boolean }>();
  sessionTools({ ledger: path.join(home, "own") }).registerOwnerTools?.((name, _description, _input, act, options) => {
    acts.set(name, { act: act as unknown as Act, anyCaller: options?.anyCaller === true });
  });
  assert.deepEqual([...acts.keys()], ["list_own_runs", "list_all_runs", "stop_own_run", "clear_own_runs"]);
  assert.deepEqual([...acts].filter(([, { anyCaller }]) => anyCaller).map(([name]) => name), ["list_all_runs"], "only list_all_runs is served to an unresolved caller");
  const call = { owner: undefined, locate: { dataDir: path.join(home, "pgdata") } };
  for (const [name, args] of [["list_own_runs", {}], ["stop_own_run", { runs: ["one"] }], ["clear_own_runs", {}]] as const) {
    await assert.rejects(acts.get(name)!.act(args, call), /needs a resolved session identity/, name);
  }
  const all = await acts.get("list_all_runs")!.act({}, call);
  const inventory = all.data?.inventory as { rows: unknown[]; shared: unknown[] };
  assert.deepEqual(inventory.rows, [], "the empty ledger is read: no session has a run");
  assert.equal(inventory.shared.length, 1, "the app's database is named as shared work beside them");
});

test("5.16 the claim and make_workspace tools take a reason longer than 40 characters on to the library, refusing nothing for its length", async (t) => {
  const folder = mkdtempSync(path.join(tmpdir(), "session-tools-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const acts = new Map<string, (args: Record<string, unknown>, call: ToolCall) => Promise<{ text: string; refused?: boolean }>>();
  sessionTools().registerTools?.((name, _description, _input, act) => { acts.set(name, act as never); });
  // Any read or write of the library or the log throws on this call, so reaching it shows the reason was not refused.
  const untouchable = new Proxy({}, { get: () => { throw new Error("read or wrote the library"); } });
  const call = { library: untouchable, log: untouchable, project: "p", caller: { session: "s" }, folder, quietMs: 0, writer: {} } as unknown as ToolCall;
  const reason = "x".repeat(200);
  for (const [name, args] of [["claim", { capability: "capability_a", reason }], ["make_workspace", { increment: "increment_a", reason }]] as const) {
    await assert.rejects(acts.get(name)!(args, call), /read or wrote the library/, `${name} goes on to the library`);
  }
});

test("5.71 · The report reply names the contract by title, calls it the agent's report, says when storytree's own run last saw it, and asks for storytree health local", async (t) => {
  const storytree = await connect({ url: testServerUrl() });
  const project = uniqueProjectName();
  t.after(async () => {
    try {
      await storytree.dropProject(project);
    } finally {
      await storytree.close();
    }
  });
  const library = await storytree.openProject(project);
  const story = await library.addStory({ title: "Context service" });
  const capability = await library.addCapability({ story: story.id, title: "5 · Packets" });
  const { id } = await library.addContract({ capability: capability.id, title: "5.2 · Every packet matches the oracle" });
  const caller = { writer: {}, session: "s" };

  const unseen = (await reportContract(library, { contract: id, result: "green" }, caller)).text;
  assert.match(unseen, new RegExp(`^Reported "5\\.2 · Every packet matches the oracle" \\(${id}\\) green: your report, a claim until storytree's own run confirms it \\(storytree's own run has not verified it yet\\)\\. Run \`storytree health local\``), unseen);
  const { at } = await library.recordVerified(id, "passing");
  const red = (await reportContract(library, { contract: id, result: "red" }, caller)).text;
  assert.match(red, new RegExp(`^Reported "5\\.2 · Every packet matches the oracle" \\(${id}\\) red: your report, and storytree's own run last verified it passing at ${at.replace(/\./g, "\\.")}\\. Run \`storytree health local\`.*then make it pass and report it green`), red);
});
