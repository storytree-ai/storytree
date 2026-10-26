/**
 * Capability 1 · Project libraries, contracts 1.6 to 1.8 (the library story): a project's
 * snapshot, and restoring one only into an empty project (ADR-0641 D2 step 4, choice B1). Through
 * the public API, against the real Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { connect as dial, createServer, type AddressInfo, type Socket } from "node:net";
import { test } from "node:test";

import { dropTestDatabases, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { connect, RestoreRefusedError, type Library, type ProjectSnapshot, type Storytree } from "../index.js";

async function withServer(projects: readonly string[], body: (storytree: Storytree) => Promise<void>): Promise<void> {
  const storytree = await connect({ url: testServerUrl() });
  try {
    await body(storytree);
  } finally {
    try {
      await storytree.close();
    } finally {
      await dropTestDatabases(projects.map((name) => `storytree_${name}`));
    }
  }
}

/** A small project: a story with a capability and a contract, a decision, a memory note, an edit, a retirement and an actor. */
async function fill(library: Library): Promise<void> {
  const story = await library.addStory({ title: "The kettle", description: "It boils water." }, { actor: "tester" });
  const capability = await library.addCapability({ story: story.id, title: "1 · Heating" });
  await library.addContract({ capability: capability.id, title: "1.1 · It reaches the boil" });
  const decision = await library.recordDecision({ title: "One element", text: "It heats with one element.", status: "accepted", frontCoverOf: capability.id });
  const note = await library.defineTerm({ term: "Delivery", meaning: "The relay clicks.", links: [decision.id] });
  await library.editNote(note.id, { meaning: "The relay clicks twice." });
  const gone = await library.defineTerm({ term: "Delivery", meaning: "A whistle, left out.", links: [decision.id] });
  await library.retire(gone.id, "not in this kettle");
}

test("1.6 snapshot returns every record of the project and its whole history, as they stood at one moment", async () => {
  const name = uniqueProjectName();
  await withServer([name], async (storytree) => {
    const library = await storytree.openProject(name);
    await fill(library);
    const history = await library.history();
    const live = (await library.search("")).map(({ id }) => id).sort();

    const snapshot = await storytree.snapshot(name);

    assert.equal(snapshot.project, name);
    assert.deepEqual(snapshot.history.map(({ seq }) => seq), history.map(({ seq }) => seq), "the whole history, in order");
    assert.ok(snapshot.history.some(({ action, actor }) => action === "retired") && snapshot.history.some(({ actor }) => actor === "tester"));
    const ids = snapshot.records.map(({ id }) => id);
    for (const id of live) assert.ok(ids.includes(id), `the live note ${id} is in the snapshot`);
    assert.ok(!snapshot.records.some(({ fields }) => JSON.stringify(fields).includes("whistle")), "a retired record is only in the history");
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot, "a snapshot is plain data, as a file holds it");

    // Taken while another write lands, it reads one moment: every record it holds has its history.
    const [during] = await Promise.all([storytree.snapshot(name), library.defineTerm({ term: "Delivery", meaning: "Written during the snapshot." })]);
    const recorded = new Set(during.history.map(({ recordId }) => recordId));
    assert.ok(during.records.every(({ id }) => recorded.has(id)), "no record without its history");
    await library.close();
  });
});

test("1.7 restore into an empty project gives back the same records and history, and the next write continues after them", async () => {
  const [name, copy] = [uniqueProjectName(), uniqueProjectName()];
  await withServer([name, copy], async (storytree) => {
    const library = await storytree.openProject(name);
    await fill(library);
    const snapshot = await storytree.snapshot(name);

    await storytree.restore(copy, snapshot);

    const restored = await storytree.openProject(copy);
    const again = await storytree.snapshot(copy);
    assert.deepEqual(again.records, snapshot.records, "the same records");
    assert.deepEqual(again.history, snapshot.history, "the same history: sequence numbers, actors, reasons and times");
    assert.deepEqual(await restored.projectTree(), await library.projectTree());
    const last = snapshot.history.at(-1)?.seq ?? 0;
    const next = await restored.defineTerm({ term: "Delivery", meaning: "After the restore." });
    const [entry] = await restored.history({ id: next.id });
    assert.ok(entry !== undefined && entry.seq > last, `the next write continues after ${last}, got ${entry?.seq}`);
    await library.close();
    await restored.close();
  });
});

test("1.8 restoring into a project that holds any record or history is refused, naming it, and writes nothing", async () => {
  const [name, busy] = [uniqueProjectName(), uniqueProjectName()];
  await withServer([name, busy], async (storytree) => {
    const library = await storytree.openProject(name);
    await fill(library);
    const snapshot = await storytree.snapshot(name);

    // The project restored from holds records: restoring over it would overwrite live edits.
    await assert.rejects(storytree.restore(name, snapshot), (error: unknown) => error instanceof RestoreRefusedError && error.message.includes(name));

    // A project whose one record was retired still has history, so it is not empty either.
    const other = await storytree.openProject(busy);
    const note = await other.defineTerm({ term: "Delivery", meaning: "Soon gone." });
    await other.retire(note.id, "retired");
    const before = await storytree.snapshot(busy);
    await assert.rejects(storytree.restore(busy, snapshot), (error: unknown) => error instanceof RestoreRefusedError && error.message.includes(busy));
    assert.deepEqual(await storytree.snapshot(busy).then(({ records, history }) => ({ records, history })), { records: before.records, history: before.history }, "nothing written");
    await library.close();
    await other.close();
  });
});

/**
 * A stand-in for a far-away server: a proxy to the test server that holds every packet it passes
 * each way for `delayMs`, as a network to another continent does. Its URL, and how to stop it.
 */
async function slowLink(delayMs: number): Promise<{ url: string; close(): Promise<void> }> {
  const target = new URL(testServerUrl());
  const sockets = new Set<Socket>();
  const relay = (from: Socket, to: Socket) => from.on("data", (chunk) => setTimeout(() => to.write(chunk), delayMs));
  const proxy = createServer((client) => {
    const server = dial({ host: target.hostname, port: Number(target.port) });
    for (const socket of [client, server]) {
      sockets.add(socket);
      socket.on("error", () => {});
      socket.on("close", () => sockets.delete(socket));
    }
    relay(client, server);
    relay(server, client);
    client.on("close", () => server.destroy());
    server.on("close", () => client.destroy());
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const url = new URL(target.href);
  url.hostname = "127.0.0.1";
  url.port = String((proxy.address() as AddressInfo).port);
  return {
    url: url.href,
    close: () => new Promise<void>((resolve) => {
      for (const socket of sockets) socket.destroy();
      proxy.close(() => resolve());
    }),
  };
}

test("1.7 a restore over a slow link finishes in seconds, not a round trip per record", async () => {
  // A project the size of storytree's own, in miniature: 2,000 records and 4,000 history entries.
  const at = "2026-09-28T00:00:00.000Z";
  const records = Array.from({ length: 2_000 }, (_, i) => ({ id: `definition_${String(i).padStart(12, "0")}`, type: "definition", version: 1, fields: { term: `Term ${i}`, meaning: "It means this." }, createdAt: at, updatedAt: at }));
  const history = records.flatMap((record, i) => [
    { seq: 2 * i + 1, recordId: record.id, type: record.type, action: "created" as const, record: record.fields, actor: "tester", at },
    { seq: 2 * i + 2, recordId: record.id, type: record.type, action: "updated" as const, record: record.fields, reason: "edited", at },
  ]);
  const name = uniqueProjectName();
  const snapshot: ProjectSnapshot = { format: "storytree-project-snapshot", version: 1, project: name, takenAt: at, records, history };
  const link = await slowLink(20);
  const far = await connect({ url: link.url, connectTimeoutMs: 10_000 });
  try {
    const started = performance.now();
    await far.restore(name, snapshot);
    const seconds = (performance.now() - started) / 1000;
    assert.ok(seconds < 15, `restored in ${seconds.toFixed(1)} s`);
    await withServer([name], async (storytree) => {
      // The server writes times in its own zone; the instants are what must match.
      const instant = (time: string) => new Date(time).toISOString();
      const again = await storytree.snapshot(name);
      assert.deepEqual(again.records.map((r) => ({ ...r, createdAt: instant(r.createdAt), updatedAt: instant(r.updatedAt) })), snapshot.records);
      assert.deepEqual(again.history.map((e) => ({ ...e, at: instant(e.at) })), snapshot.history);
    });
  } finally {
    await far.close();
    await link.close();
  }
});
