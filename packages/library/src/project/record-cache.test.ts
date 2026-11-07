import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { withCountedProject } from "../testing/pg.js";
import type { Project } from "./index.js";
import { connect } from "./storytree.js";

/** A note's worth of text: about a kilobyte, as the library's notes run. */
const BODY = "words ".repeat(170);

async function seed(project: Project, count: number): Promise<void> {
  for (let index = 0; index < count; index++) {
    await project.transactions.save({ id: `note_${String(index).padStart(4, "0")}`, type: "note", fields: { title: `Note ${index}`, body: BODY } });
  }
}

/** Open the counted project again, through the same counting proxy, as a second process on this machine would. */
async function reopen(project: Project, recordCache: string | null): Promise<{ again: Project; close: () => Promise<void> }> {
  const server = await connect({ url: project.pool.options.connectionString! }, { recordCache });
  const again = await server.openProject(project.name, { create: false });
  return { again, close: () => server.close() };
}

async function withCacheFolder(body: (file: string) => Promise<void>): Promise<void> {
  const folder = await mkdtemp(path.join(tmpdir(), "storytree-records-"));
  try {
    await body(path.join(folder, "records.sqlite"));
  } finally {
    await removeTemp(folder);
  }
}

test("1.31 · a second identical read with nothing changed takes under 4 KB from the server, from the machine's own copy", async () => {
  await withCacheFolder(async (file) => {
    await withCountedProject(async (project, received) => {
      await seed(project, 150);
      const { again, close } = await reopen(project, file);
      try {
        const first = await again.transactions.list("note");
        assert.equal(first.length, 150);
        const before = received();
        const second = await again.transactions.list("note");
        const one = await again.transactions.get("note_0042");
        const taken = received() - before;
        assert.deepEqual(second, first);
        assert.deepEqual(one, await project.transactions.get("note_0042"));
        assert.ok(taken < 4096, `the second read took ${taken} bytes from the server`);
      } finally {
        await close();
      }
      // A later process on the same machine starts from the copy the first one left.
      const { again: later, close: closeLater } = await reopen(project, file);
      try {
        const before = received();
        assert.equal((await later.transactions.list("note")).length, 150);
        const taken = received() - before;
        assert.ok(taken < 4096, `a later process's first read took ${taken} bytes from the server`);
      } finally {
        await closeLater();
      }
    });
  });
});

test("1.32 · a cached read sees every change committed before it, by this connection or any other, retirements included", async () => {
  await withCacheFolder(async (file) => {
    await withCountedProject(async (project) => {
      await seed(project, 3);
      const { again, close } = await reopen(project, file);
      try {
        assert.equal((await again.transactions.list("note")).length, 3);
        // Another connection, with no cache, changes the records.
        await project.transactions.edit({ id: "note_0000", fields: { title: "Edited elsewhere" } });
        await project.transactions.retire({ id: "note_0001", reason: "gone" });
        await project.transactions.save({ id: "note_0009", type: "note", fields: { title: "Made elsewhere" } });
        assert.equal((await again.transactions.get("note_0000"))?.fields.title, "Edited elsewhere");
        assert.equal(await again.transactions.get("note_0001"), null);
        assert.deepEqual((await again.transactions.list("note")).map(({ id }) => id), ["note_0000", "note_0002", "note_0009"]);
        // Its own write, read straight back.
        await again.transactions.edit({ id: "note_0002", fields: { title: "Edited here" } });
        assert.equal((await again.transactions.get("note_0002"))?.fields.title, "Edited here");
        // Filters read the copy as the server would.
        assert.deepEqual(
          await again.transactions.list("note", { where: { title: "Edited here" }, projection: { version: 1, fields: ["title"] } }),
          await project.transactions.list("note", { where: { title: "Edited here" }, projection: { version: 1, fields: ["title"] } }),
        );
      } finally {
        await close();
      }
    });
  });
});

test("1.33 · a cached read inside inOneWrite sees that write's own changes, and an unusable cache leaves reads to the server", async () => {
  await withCacheFolder(async (file) => {
    await withCountedProject(async (project) => {
      await seed(project, 2);
      const { again, close } = await reopen(project, file);
      try {
        await again.transactions.list("note");
        const seen = await again.transactions.inOneWrite(async () => {
          await again.transactions.save({ id: "note_0005", type: "note", fields: { title: "Not yet committed" } });
          return [await again.transactions.get("note_0005"), (await again.transactions.list("note")).length] as const;
        });
        assert.equal(seen[0]?.fields.title, "Not yet committed");
        assert.equal(seen[1], 3);
      } finally {
        await close();
      }
    });
  });
  await withCacheFolder(async (file) => {
    await mkdir(file, { recursive: true }); // a folder where the cache's file would be: it cannot be opened
    await withCountedProject(async (project) => {
      await seed(project, 2);
      const { again, close } = await reopen(project, file);
      try {
        assert.deepEqual(await again.transactions.list("note"), await project.transactions.list("note"));
        assert.deepEqual(await again.transactions.get("note_0001"), await project.transactions.get("note_0001"));
      } finally {
        await close();
      }
    });
  });
});
