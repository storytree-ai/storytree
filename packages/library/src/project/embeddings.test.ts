import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { Knowledge, type Embedder } from "../knowledge/index.js";
import { withCountedProject } from "../testing/pg.js";
import { PgVectors } from "./embeddings.js";
import { connect } from "./storytree.js";

const embedder: Embedder = {
  model: "test/model",
  async embed(texts) {
    return texts.map(() => {
      const vector = new Float32Array(384);
      vector[0] = 1;
      return vector;
    });
  },
};

for (const method of ["rank", "rankAll"] as const) {
  test(`14.10 · ${method} fetches only vectors this machine lacks, including after another machine adds a note`, async (t) => {
    const folder = await mkdtemp(path.join(tmpdir(), "storytree-vectors-"));
    try {
      await withCountedProject(async (project, received) => {
        const elsewhere = new Knowledge(project.records, undefined, { embedder: async () => embedder, vectors: new PgVectors(project.pool) });
        for (let index = 0; index < 64; index++) {
          await elsewhere.defineTerm({ term: `Entry ${index}`, meaning: `Searchable text ${index}.` });
        }
        await elsewhere[method]("entry");
        const search = async () => {
          const server = await connect({ url: project.pool.options.connectionString! }, {
            embedder: async () => embedder,
            vectorCache: path.join(folder, "models", "vectors.sqlite"),
          });
          try {
            const opened = await server.openProject(project.name);
            const before = received();
            const ranked = await opened.knowledge[method]("entry");
            return { ranked, bytes: received() - before };
          } finally {
            await server.close();
          }
        };
        const cold = await search();
        const warm = await search();
        const first = cold.bytes;
        const second = warm.bytes;
        assert.deepEqual(warm.ranked, cold.ranked, "the cache preserves ranks and scores");
        assert.ok(second < first / 4, `warm search ${second} bytes must be below a quarter of cold ${first}`);

        await elsewhere.defineTerm({ term: "New entry", meaning: "A note written on another machine." });
        await elsewhere[method]("entry");
        const added = (await search()).bytes;
        assert.ok(added > second, "the new vector and note arrive");
        assert.ok(added < second + 5000, `one new 384-float vector: ${added} bytes versus ${second} warm`);
        const again = (await search()).bytes;
        assert.ok(added - again >= 384 * 4, "the fetched vector is kept locally for the next search");
        t.diagnostic(`${method}: cold ${first} B; warm ${second} B; one new note ${added} B; warm again ${again} B`);
      });
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
}

test("14.10 · vector writes reach both stores, keys are model-scoped, and a missing server key is retried", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "storytree-vectors-"));
  try {
    await withCountedProject(async ({ pool }, received) => {
      const file = path.join(folder, "vectors.sqlite");
      const vectors = new PgVectors(pool, file);
      const raw = new PgVectors(pool);
      // Store a view with an offset: unrelated floats must not be copied into either store.
      const first = Float32Array.of(99, 1, 2, 99).subarray(1, 3);
      const second = Float32Array.of(3, 4);
      await vectors.put("first", new Map([["same-key", first]]));
      await vectors.put("second", new Map([["same-key", second]]));
      assert.deepEqual(await raw.get("first", ["same-key"]), new Map([["same-key", first]]));
      assert.deepEqual(await raw.get("second", ["same-key"]), new Map([["same-key", second]]));
      const before = received();
      assert.deepEqual(await new PgVectors(pool, file).get("first", ["same-key"]), new Map([["same-key", first]]));
      assert.deepEqual(await new PgVectors(pool, file).get("second", ["same-key"]), new Map([["same-key", second]]));
      assert.equal(received(), before, "local hits make no server query");
      assert.equal((await vectors.get("first", ["later"])).size, 0);
      await raw.put("first", new Map([["later", second]]));
      assert.deepEqual(await vectors.get("first", ["later"]), new Map([["later", second]]));
    });
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("14.10 · no local place, an inaccessible path or a corrupt cache still reads and writes Postgres", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "storytree-vectors-"));
  try {
    const invalid = path.join(folder, "not-a-database");
    await writeFile(invalid, "broken sqlite");
    await withCountedProject(async ({ pool }, received) => {
      const expected = new Map([["key", Float32Array.of(1, 2)]]);
      for (const file of [null, path.join(invalid, "unavailable.sqlite"), invalid]) {
        const vectors = new PgVectors(pool, file);
        await vectors.put("model", expected);
        const before = received();
        assert.deepEqual(await vectors.get("model", ["key"]), expected);
        assert.ok(received() > before, "without usable storage the server still answers");
      }
    });
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("14.10 · independent processes write one cache concurrently and a fresh process reuses every vector", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "storytree-vectors-"));
  try {
    await withCountedProject(async ({ pool }, received) => {
      const file = path.join(folder, "vectors.sqlite");
      const script = `
        import assert from 'node:assert/strict';
        import pg from 'pg';
        import { PgVectors } from ${JSON.stringify(new URL("./embeddings.ts", import.meta.url).href)};
        const [url, file, lane] = process.argv.slice(1);
        const pool = new pg.Pool({ connectionString: url });
        try {
          const vectors = new PgVectors(pool, file);
          for (let index = 0; index < 12; index++) {
            const value = Float32Array.of(index, 1);
            await vectors.put('concurrent', new Map([['shared-' + index, value], [lane + '-' + index, value]]));
            assert.deepEqual(await vectors.get('concurrent', ['shared-' + index]), new Map([['shared-' + index, value]]));
          }
        } finally { await pool.end(); }
      `;
      await Promise.all([0, 1, 2].map((lane) => promisify(execFile)(process.execPath, [
        "--import", "tsx", "--input-type=module", "--eval", script, pool.options.connectionString!, file, String(lane),
      ])));
      const expected = new Map<string, Float32Array>();
      for (let index = 0; index < 12; index++) {
        for (const prefix of ["shared", "0", "1", "2"]) expected.set(`${prefix}-${index}`, Float32Array.of(index, 1));
      }
      const before = received();
      assert.deepEqual(await new PgVectors(pool, file).get("concurrent", [...expected.keys()]), expected);
      assert.equal(received(), before, "every process left its complete vectors on disk");
      assert.deepEqual(await new PgVectors(pool).get("concurrent", [...expected.keys()]), expected, "all writes also reached Postgres");
      const read = `
        import assert from 'node:assert/strict';
        import { PgVectors } from ${JSON.stringify(new URL("./embeddings.ts", import.meta.url).href)};
        const remote = { query() { throw new Error('a warm cache must not query the server'); } };
        const kept = await new PgVectors(remote, process.argv[1]).get('concurrent', ${JSON.stringify([...expected.keys()])});
        assert.equal(kept.size, 48);
        for (const [key, value] of kept) assert.deepEqual([...value], [Number(key.split('-')[1]), 1]);
      `;
      await promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", read, file]);
    });
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
