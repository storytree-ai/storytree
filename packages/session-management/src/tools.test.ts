/** Capability 14 · See what remains: Session management's runs tools, as its tool part registers them for the MCP server. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { sessionTools } from "./tools.js";

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
  assert.ok(all.data?.inventory !== undefined, "every session's runs are read");
});
