import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { connect } from "@storytree/library";
import pg from "pg";

test("3.4 · Conduit's refresh command saves its growth from the library, one stage per moment of its increment log", async t => {
  const url = process.env.STORYTREE_TEST_PG_URL;
  assert.ok(url, "Run through pnpm test for an isolated test Postgres");
  const directory = await mkdtemp(path.join(tmpdir(), "website-growth-"));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  // The command reads the conduit-codex the owner's library holds, by its database's identity: make that database here.
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  const server = await connect({ url });
  t.after(async () => {
    try { if ((await server.listProjects()).includes("conduit-codex")) await server.dropProject("conduit-codex"); } finally { await server.close(); await admin.end(); }
  });
  await admin.query('CREATE DATABASE "storytree_conduit-codex" WITH OID = 16706');
  const library = await server.openProject("conduit-codex");
  const story = await library.addStory({ title: "Have an account", description: "Sign in" });
  const output = path.join(directory, "conduit.json");
  const command = fileURLToPath(new URL("./refresh-growth.ts", import.meta.url));
  const run = (...args: string[]) => promisify(execFile)(process.execPath, ["--import", import.meta.resolve("tsx"), command, ...args],
    { cwd: directory, timeout: 20_000, env: { ...process.env, STORYTREE_EMBEDDER: "off" } });

  await assert.rejects(run("--output", output), /Give --library/);
  const ran = await run("--library", url, "--output", output);
  assert.match(ran.stdout, /Saved Conduit's growth/);
  const saved = JSON.parse(await readFile(output, "utf8"));
  assert.equal(saved.project, "conduit-codex");
  assert.deepEqual(saved.window, { from: "2026-10-01T21:14:00.000Z", to: "2026-10-02T12:44:00.000Z" });
  assert.equal(saved.titles[story.id], "Have an account", "the full plan is the library's plan now");
  assert.equal(saved.stages.length, 21);
  assert.deepEqual([saved.stages[0].id, saved.stages.at(-1).id], ["empty", "complete"]);
  assert.ok(saved.stages.every((stage: { counts: { stories: number } }) => stage.counts.stories === 0), "a story recorded after the window grows in no stage");

  const kept = await readFile(output, "utf8");
  await server.dropProject("conduit-codex");
  await (await server.openProject("conduit-codex")).addStory({ title: "Someone else's" });
  await assert.rejects(run("--library", url, "--output", output), /no such project/, "a conduit-codex made again is not the one recorded");
  assert.equal(await readFile(output, "utf8"), kept);
});
