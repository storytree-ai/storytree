/**
 * Capability 28 · Shared server, contract 28.12: every byte the server sends a library connection is counted against the
 * reader that asked for it, so the library's reads can be ranked by reader (increment_28a5cea44ef7).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { asReader, nameReader, scriptReader, takeReads } from "@storytree/library/reads";

import { withCountedProject, withTestClient } from "../testing/pg.js";

test("28.12 every byte a library connection receives, its handshake included, is counted against the reader that asked: the process's named reader, or the one a call runs as; and each connection is named for the process's reader", async () => {
  takeReads();
  nameReader("arc show");
  await withCountedProject(async (project, received) => {
    await asReader("tool show_plan", () => project.work.addStory({ title: "Read by a tool", description: "Its bytes are the tool's." }));
    await project.flight.holds();

    const counted = new Map(takeReads().map((total) => [total.reader, total]));
    assert.deepEqual([...counted.keys()].sort(), ["arc show", "tool show_plan"]);
    assert.ok(counted.get("tool show_plan")!.bytes > 0 && counted.get("tool show_plan")!.statements > 0, "the tool's call is the tool's");
    assert.equal([...counted.values()].reduce((sum, total) => sum + total.bytes, 0), received(), "every byte the server sent is counted, once");

    const names = await withTestClient(async (client) =>
      (await client.query<{ name: string }>("SELECT application_name AS name FROM pg_stat_activity WHERE datname = $1 AND backend_type = 'client backend'", [`storytree_${project.name}`])).rows.map((row) => row.name),
    );
    assert.ok(names.length > 0);
    for (const name of names) assert.match(name, new RegExp(` ${process.pid} arc show$`));
  });
});

test("28.13 a process that names no reader is counted as the script it runs, or, running none (argv[1] empty or a flag), as having no script, never under a flag", () => {
  assert.equal(scriptReader(["/usr/bin/node", "/home/me/storytree/dist/pool.mjs", "--once"]), "pool.mjs");
  assert.equal(scriptReader(["C:\\Program Files\\storytree\\storytree.exe", "--updated"]), "no script (storytree.exe)");
  assert.equal(scriptReader(["/opt/storytree/storytree"]), "no script (storytree)");
  assert.equal(scriptReader(["/opt/storytree/storytree", ""]), "no script (storytree)");
  assert.equal(scriptReader([]), "no script");
});
