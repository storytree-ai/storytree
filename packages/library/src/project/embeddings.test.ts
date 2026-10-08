import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { Knowledge, type Embedder } from "../knowledge/index.js";
import { withCountedProject } from "../testing/pg.js";
import { PgVectors } from "./embeddings.js";
import { connect } from "./storytree.js";

const domain = { server: "synthetic", database: "test-project", identity: "1" };

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
      const vectors = new PgVectors(pool, file, domain);
      const raw = new PgVectors(pool);
      // Store a view with an offset: unrelated floats must not be copied into either store.
      const first = Float32Array.of(99, 1, 2, 99).subarray(1, 3);
      const second = Float32Array.of(3, 4);
      await vectors.put("first", new Map([["same-key", first]]));
      await vectors.put("second", new Map([["same-key", second]]));
      assert.deepEqual(await raw.get("first", ["same-key"]), new Map([["same-key", first]]));
      assert.deepEqual(await raw.get("second", ["same-key"]), new Map([["same-key", second]]));
      const before = received();
      assert.deepEqual(await new PgVectors(pool, file, domain).get("first", ["same-key"]), new Map([["same-key", first]]));
      assert.deepEqual(await new PgVectors(pool, file, domain).get("second", ["same-key"]), new Map([["same-key", second]]));
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
        const vectors = new PgVectors(pool, file, domain);
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

test("14.10 · independent processes write one cache concurrently and a fresh process reuses every vector", async (t) => {
  const started = performance.now();
  const phase = (message: string) => t.diagnostic(`vectors +${Math.round(performance.now() - started)} ms: ${message}`);
  const workers = new AbortController();
  const signal = AbortSignal.any([t.signal, workers.signal]);
  // A stalled child must report its last phase and exit before the test's 60-second deadline.
  // Wait for its close callback, including after cancellation, before removing the cache or proxy.
  const run = (label: string, script: string, args: string[], timeout: number) => new Promise<void>((resolve, reject) => {
    let last = "Node/tsx startup (no child output)";
    let pending = "";
    const child = execFile(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script, ...args], {
      timeout, killSignal: "SIGKILL",
    }, (error, stdout, stderr) => {
      signal.removeEventListener("abort", abort);
      phase(`${label} closed; last phase: ${last}`);
      if (error) {
        workers.abort();
        reject(new Error(`${label} failed (code=${error.code}, signal=${error.signal}, killed=${error.killed}); last phase: ${last}\n${stdout}\n${stderr}`));
      } else resolve();
    });
    const abort = () => {
      phase(`${label} cancelled; last phase: ${last}`);
      child.kill("SIGKILL");
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    child.stdout!.on("data", (chunk: string) => {
      const lines = (pending + chunk).split("\n");
      pending = lines.pop()!;
      if (lines.length) last = lines.at(-1)!;
      for (const line of lines) {
        if (/module imports|modules ready|pool.end|all 48 vectors/.test(line)) phase(`${label}: ${line}`);
      }
    });
    phase(`${label} spawned pid=${child.pid}; deadline ${timeout} ms`);
  });
  const observe = `
    const started = performance.now();
    let previous = started, previousPhase = 'startup', slowest = { ms: 0, phase: 'startup' };
    const phase = (message) => {
      const now = performance.now();
      if (now - previous > slowest.ms) slowest = { ms: Math.round(now - previous), phase: previousPhase };
      previous = now;
      previousPhase = message;
      console.log(Math.round(now - started) + ' ms: ' + message);
    };
    phase('module imports');
  `;
  phase("create temporary cache and counted Postgres project");
  const folder = await mkdtemp(path.join(tmpdir(), "storytree-vectors-"));
  try {
    await withCountedProject(async ({ pool }, received) => {
      phase("project ready");
      try {
        const file = path.join(folder, "vectors.sqlite");
        const script = observe + `
          const { default: assert } = await import('node:assert/strict');
          const { default: pg } = await import('pg');
          const { PgVectors } = await import(${JSON.stringify(new URL("./embeddings.ts", import.meta.url).href)});
          phase('modules ready');
          const [url, file, lane] = process.argv.slice(1);
          const pool = new pg.Pool({ connectionString: url });
          let queries = 0;
          const remote = { async query(...args) {
            phase('Postgres query ' + ++queries + ' via counting proxy');
            const result = await pool.query(...args);
            phase('Postgres query ' + queries + ' returned; local cache next');
            return result;
          } };
          try {
            const vectors = new PgVectors(remote, file, ${JSON.stringify(domain)});
            for (let index = 0; index < 12; index++) {
              const value = Float32Array.of(index, 1);
              phase('put ' + index);
              await vectors.put('concurrent', new Map([['shared-' + index, value], [lane + '-' + index, value]]));
              phase('get ' + index);
              assert.deepEqual(await vectors.get('concurrent', ['shared-' + index]), new Map([['shared-' + index, value]]));
            }
          } finally {
            phase('pool.end');
            await pool.end();
            phase('pool closed; queries=' + queries + '; slowest=' + JSON.stringify(slowest));
          }
        `;
        const results = await Promise.allSettled([0, 1, 2].map((lane) => run(
          `writer ${lane}`, script, [pool.options.connectionString!, file, String(lane)], 40_000,
        )));
        phase(`writers closed; proxy received ${received()} B`);
        const failures = results.filter((result) => result.status === "rejected").map((result) => result.reason);
        if (failures.length) throw new AggregateError(failures, "concurrent vector-cache writers failed");
        phase("verify local and remote copies");
        const expected = new Map<string, Float32Array>();
        for (let index = 0; index < 12; index++) {
          for (const prefix of ["shared", "0", "1", "2"]) expected.set(`${prefix}-${index}`, Float32Array.of(index, 1));
        }
        const before = received();
        assert.deepEqual(await new PgVectors(pool, file, domain).get("concurrent", [...expected.keys()]), expected);
        assert.equal(received(), before, "every process left its complete vectors on disk");
        assert.deepEqual(await new PgVectors(pool).get("concurrent", [...expected.keys()]), expected, "all writes also reached Postgres");
        const read = observe + `
          const { default: assert } = await import('node:assert/strict');
          const { PgVectors } = await import(${JSON.stringify(new URL("./embeddings.ts", import.meta.url).href)});
          phase('modules ready; read cache without server');
          const remote = { query() { throw new Error('a warm cache must not query the server'); } };
          const kept = await new PgVectors(remote, process.argv[1], ${JSON.stringify(domain)}).get('concurrent', ${JSON.stringify([...expected.keys()])});
          assert.equal(kept.size, 48);
          for (const [key, value] of kept) assert.deepEqual([...value], [Number(key.split('-')[1]), 1]);
          phase('all 48 vectors reused');
        `;
        await run("fresh reader", read, [file], 10_000);
      } finally {
        phase("close project, counting proxy and test database");
      }
    });
  } finally {
    phase("remove temporary cache");
    await rm(folder, { recursive: true, force: true });
    phase("cleanup complete");
  }
});
