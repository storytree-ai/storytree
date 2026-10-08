import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { connect as openSocket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import pg from "pg";

import { Knowledge } from "../knowledge/knowledge.js";
import { chunksOf, renderNote } from "../knowledge/embedding.js";
import type { SchemaRecord } from "../schema/index.js";
import { createTestRole, dropTestDatabases, dropTestRoles, testServerUrl, uniqueProjectName, withCountedProject } from "../testing/pg.js";
import { PgVectors, vectorServerIdentity } from "./embeddings.js";
import { connect, type Storytree } from "./storytree.js";

// The original two-project poisoning probe: real ranking and SQLite, synthetic records,
// database responses and embedder. No network, credentials, model download or live library.
const note = (id: string, term: string): SchemaRecord => ({
  id, type: "definition", version: 1,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  fields: { term, meaning: `The known shared text for ${term}.` },
});
const alpha = note("known-alpha", "Alpha"), beta = note("known-beta", "Beta");
const key = (record: SchemaRecord): string => {
  const chunks = chunksOf(renderNote(record));
  assert.equal(chunks.length, 1);
  return createHash("sha256").update(chunks[0]!).digest("hex");
};
const good = new Map([[key(alpha), Float32Array.of(1, 0)], [key(beta), Float32Array.of(0, 1)]]);
const poison = new Map([[key(alpha), Float32Array.of(-1, 0)]]);
const domain = { server: "trusted-server", database: "storytree_victim", identity: "123" };

function remote(vectors: ReadonlyMap<string, Float32Array>) {
  const requests: string[][] = [];
  return {
    requests,
    async query(sql: string, params: [string, string[]]) {
      assert.match(sql, /^SELECT key, vector FROM embedding/);
      requests.push([...params[1]]);
      return { rows: params[1].filter(k => vectors.has(k)).map(k => ({
        key: k, vector: Buffer.from(vectors.get(k)!.buffer),
      })) };
    },
  };
}

function search(notes: SchemaRecord[], pool: ReturnType<typeof remote>, cache: string, scope = domain, model = "test/isolation") {
  return new Knowledge({ async list(type: string) { return notes.filter(n => n.type === type); } } as never, "synthetic", {
    vectors: new PgVectors(pool as never, cache, scope),
    embedder: async () => ({ model, async embed(texts) {
      assert.deepEqual(texts, ["question"], "kept chunks need no new embedding");
      return [Float32Array.of(1, 0)];
    } }),
  });
}

for (const method of ["rank", "rankAll"] as const) {
  test(`14.10 · ${method} ignores another server, project or database incarnation's cached remote vectors`, async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "storytree-vector-isolation-"));
    try {
      const baseline = await search([alpha, beta], remote(good), path.join(folder, "baseline.sqlite"))[method]("question");
      assert.deepEqual(baseline.hits.map(({ note, score }) => [note.id, score]), [[alpha.id, 1], [beta.id, 0]]);
      const attackers = [
        { ...domain, server: "attacker-server" },
        { ...domain, database: "storytree_attacker" },
        { ...domain, identity: "122" },
      ];
      for (const [index, attacker] of attackers.entries()) {
        const file = path.join(folder, `${index}.sqlite`);
        await search([alpha], remote(poison), file, attacker)[method]("question");
        const victim = remote(good);
        assert.deepEqual(await search([alpha, beta], victim, file)[method]("question"), baseline);
        assert.deepEqual(victim.requests, [[key(alpha), key(beta)]], "the victim reads its own authoritative vectors");
        const warm = remote(good);
        assert.deepEqual(await search([alpha, beta], warm, file)[method]("question"), baseline);
        assert.deepEqual(warm.requests, [], "a fresh store in the same domain reuses both vectors");
      }
      const file = path.join(folder, "models.sqlite");
      await search([alpha], remote(poison), file, domain, "test/old-model")[method]("question");
      assert.deepEqual(await search([alpha, beta], remote(good), file)[method]("question"), baseline);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
}

test("14.10 · legacy unscoped entries are ignored, and a store without an identity uses only Postgres", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "storytree-vector-legacy-"));
  try {
    const file = path.join(folder, "vectors.sqlite");
    const old = new DatabaseSync(file);
    try {
      old.exec("CREATE TABLE embedding (model TEXT, key TEXT, vector BLOB, PRIMARY KEY (model, key))");
      old.prepare("INSERT INTO embedding VALUES (?, ?, ?)").run("test/isolation", key(alpha), Buffer.from(poison.get(key(alpha))!.buffer));
    } finally { old.close(); }
    const pool = remote(good);
    const result = await search([alpha, beta], pool, file).rank("question");
    assert.deepEqual(result.hits.map(({ note, score }) => [note.id, score]), [[alpha.id, 1], [beta.id, 0]]);
    assert.deepEqual(pool.requests, [[key(alpha), key(beta)]]);
    for (let i = 0; i < 2; i++) {
      const unscoped = remote(poison);
      assert.deepEqual(await new PgVectors(unscoped as never, file).get("test/isolation", [key(alpha)]), poison);
      assert.equal(unscoped.requests.length, 1, "no explicit identity means no shared-cache read");
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("14.10 · server domains follow pg endpoint overrides, user, TLS trust and Cloud SQL instance without retaining passwords", async () => {
  const pools: pg.Pool[] = [];
  const identity = (config: string | pg.PoolConfig, instance?: string) => {
    const pool = new pg.Pool(typeof config === "string" ? { connectionString: config } : config);
    pools.push(pool);
    return vectorServerIdentity(pool, instance);
  };
  try {
    const base = "postgres://alice:secret-one@victim.invalid:5432/postgres?sslmode=disable";
    const expected = identity(base);
    assert.match(expected, /^[a-f0-9]{64}$/);
    assert.equal(identity(base.replace("secret-one", "secret-two")), expected, "password rotation preserves the domain");
    assert.equal(identity(`${base}&password=query-secret`), expected, "query-string passwords are also excluded");
    assert.equal(identity(base.replace("/postgres?", "/other-admin-db?")), expected, "the project's identity is supplied separately");
    for (const different of [
      base.replace("victim.invalid", "attacker.invalid"),
      base.replace(":5432", ":5433"),
      base.replace("alice:", "bob:"),
      `${base}&host=attacker.invalid`,
      `${base}&port=5433`,
      `${base}&user=bob`,
      base.replace("sslmode=disable", "sslmode=verify-full"),
    ]) assert.notEqual(identity(different), expected);
    const tls = base.replace("sslmode=disable", "sslmode=verify-full");
    assert.notEqual(identity(tls), identity(base.replace("sslmode=disable", "sslmode=no-verify")));
    const trusted = { host: "victim.invalid", user: "alice", ssl: { ca: "synthetic-ca" } };
    assert.notEqual(identity(trusted), identity({ ...trusted, ssl: { ca: "different-synthetic-ca" } }));
    assert.notEqual(identity(trusted), identity({ ...trusted, ssl: { ...trusted.ssl, checkServerIdentity: () => undefined } }));
    const cloudA = identity(base, "synthetic:region:instance-a");
    assert.notEqual(cloudA, expected, "the connector's placeholder endpoint cannot alias a URL server");
    assert.notEqual(cloudA, identity(base, "synthetic:region:instance-b"));
    // Real Cloud SQL pools carry their IAM user as a pool option, not a URL.
    const cloudPool = new pg.Pool({ user: "one@example.invalid" });
    const otherUser = new pg.Pool({ user: "two@example.invalid" });
    pools.push(cloudPool, otherUser);
    assert.notEqual(vectorServerIdentity(cloudPool, "synthetic:region:instance-a"), vectorServerIdentity(otherUser, "synthetic:region:instance-a"));
  } finally {
    await Promise.all(pools.map(pool => pool.end()));
  }
});

test("1.4, 14.10 · opened projects isolate identical restored chunks and a recreated database, while a reopened project stays warm", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "storytree-vector-projects-"));
  try {
    await withCountedProject(async (project) => {
      const file = path.join(folder, "vectors.sqlite");
      const url = new URL(project.pool.options.connectionString!);
      url.pathname = "/postgres";
      url.password = "synthetic-secret-before-rotation"; // The disposable test server uses trust authentication.
      const model = "test/projects";
      const seams = { vectorCache: file, embedder: async () => ({ model, async embed(texts: readonly string[]) {
        return texts.map(text => text.includes("# Beta") ? Float32Array.of(0, 1) : Float32Array.of(1, 0));
      } }) };
      let server = await connect({ url: url.href }, seams);
      const other = uniqueProjectName();
      try {
        const attacker = await server.openProject(project.name);
        const a = await attacker.knowledge.defineTerm({ term: "Alpha", meaning: "Shared words." });
        const b = await attacker.knowledge.defineTerm({ term: "Beta", meaning: "Other words." });
        const saved = await server.snapshot(project.name);
        await new PgVectors(attacker.pool).put(model, new Map([[key(a), Float32Array.of(-1, 0)]]));
        const poisoned = await attacker.knowledge.rank("question");
        assert.equal(poisoned.hits.find(hit => hit.note.id === a.id)!.score, -1);
        await server.restore(other, saved);
        const victim = await server.openProject(other);
        const cold = await victim.knowledge.rankAll("question");
        assert.deepEqual(cold.hits.map(({ note, score }) => [note.id, score]), [[a.id, 1], [b.id, 0]]);
        await victim.pool.query("UPDATE embedding SET vector = $1 WHERE model = $2 AND key = $3",
          [Buffer.from(Float32Array.of(-1, 0).buffer), model, key(a)]);
        await server.close();

        // Rotating a password must not invalidate this database's cache or persist either secret.
        url.password = "synthetic-secret-after-rotation";
        server = await connect({ url: url.href }, seams);
        const reopened = await server.openProject(other);
        assert.deepEqual(await reopened.knowledge.rankAll("question"), cold, "a fresh connection reuses this project's kept vector, despite the later remote mutation");

        const oldIdentity = attacker.identity;
        await server.dropProject(project.name);
        await server.restore(project.name, saved);
        const recreated = await server.openProject(project.name);
        assert.notEqual(recreated.identity, oldIdentity);
        assert.deepEqual(await recreated.knowledge.rank("question"), cold, "a recreated database cannot reuse its predecessor's poisoned vector");
        const bytes = await readFile(file);
        assert.equal(bytes.includes(Buffer.from("synthetic-secret")), false);
      } finally {
        await server.dropProject(other).catch(() => {});
        await server.close();
      }
    });
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("14.10 · Cloud SQL project openings scope the cache to the authenticated instance, even with identical database identities", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "storytree-vector-instances-"));
  const name = uniqueProjectName(), user = `${name}@example.invalid`;
  const opened: Storytree[] = [];
  try {
    await createTestRole(user, { createdb: true });
    const upstream = new URL(testServerUrl());
    const model = "test/cloud-isolation";
    const open = async (instance: string) => {
      const server = await connect({ cloudSql: { instance: `synthetic:region:${instance}`, user } }, {
        vectorCache: path.join(folder, "vectors.sqlite"),
        embedder: async () => ({ model, async embed(texts) { return texts.map(() => Float32Array.of(1, 0)); } }),
        // Both synthetic instances reach the disposable server, deliberately giving them the
        // same database name, OID and records. Nothing contacts Google or performs a sign-in.
        connector: async () => ({
          async getOptions() { return { stream: () => {
            const socket = openSocket(Number(upstream.port), upstream.hostname);
            socket.connect = () => socket;
            return socket;
          } }; },
          close() {},
        }),
      });
      opened.push(server);
      return server.openProject(name);
    };
    const attacker = await open("instance-a");
    const a = await attacker.knowledge.defineTerm({ term: "Alpha", meaning: "Known shared text." });
    await new PgVectors(attacker.pool).put(model, new Map([[key(a), Float32Array.of(-1, 0)]]));
    assert.equal((await attacker.knowledge.rank("question")).hits[0]!.score, -1);
    await opened[0]!.close();
    const victim = await open("instance-b");
    assert.equal(victim.identity, attacker.identity, "the server namespace must distinguish these equal database identities");
    await victim.pool.query("UPDATE embedding SET vector = $1", [Buffer.from(Float32Array.of(1, 0).buffer)]);
    assert.equal((await victim.knowledge.rankAll("question")).hits[0]!.score, 1);
    await opened[1]!.close();
    const again = await open("instance-a");
    assert.equal((await again.knowledge.rank("question")).hits[0]!.score, -1, "the first instance reuses only its own kept vector");
  } finally {
    await Promise.all(opened.map(server => server.close()));
    await dropTestDatabases([`storytree_${name}`]);
    await dropTestRoles([user]);
    await rm(folder, { recursive: true, force: true });
  }
});
