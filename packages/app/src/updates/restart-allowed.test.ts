/**
 * Capability 4 · Updates, contract 4.36: when the app may restart itself into an update.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { restartAllowed } from "./restart-allowed.js";

test("4.36 the app restarts itself only while it is not stopping, no seed is being written to its Postgres, and no backup holds it", async () => {
  const state = { stopping: false, url: "postgres://own" as string | undefined, seed: false, backups: undefined as { canRestart(): boolean } | undefined };
  const asked: string[] = [];
  const may = restartAllowed({
    stopping: () => state.stopping,
    postgresUrl: () => state.url,
    seedWriting: async (url) => { asked.push(url); return state.seed; },
    backups: () => state.backups,
  });
  assert.equal(await may(), true);
  assert.deepEqual(asked, ["postgres://own"], "the seed check asks the app's own Postgres");
  state.seed = true;
  assert.equal(await may(), false, "a seed being written holds it");
  state.url = undefined;
  assert.equal(await may(), true, "with no Postgres of its own there is no seed to wait for");
  state.backups = { canRestart: () => true };
  assert.equal(await may(), true, "backups not being written let it through, as no backups do");
  state.backups = { canRestart: () => false };
  assert.equal(await may(), false, "a backup holds it");
  state.backups = undefined;
  state.stopping = true;
  assert.equal(await may(), false, "a stopping app never restarts");
});

test("4.36 a shutdown begun while the seed check is answering holds the restart", async () => {
  let stopping = false;
  const may = restartAllowed({
    stopping: () => stopping,
    postgresUrl: () => "postgres://own",
    seedWriting: async () => { stopping = true; return false; },
    backups: () => undefined,
  });
  assert.equal(await may(), false);
});
