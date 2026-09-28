/**
 * Capability 1 · Lifecycle, contracts 1.9 and 1.10 (ADR-0734 D1, ADR-0735 D4): where the app opens
 * its library follows the user's library setting. The local Postgres and connect() are handed in,
 * so the cloud path is shown without reaching Google: which is started, and what is connected.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { setLibrary } from "@storytree/agent-link";
import { ConnectionError, type ConnectOptions, type Storytree } from "@storytree/library";

import { openAppLibrary } from "./open-where-set.js";

const cloudSql = { instance: "my-project:australia-southeast1:my-instance", user: "you@example.com" };
const connected = { close: async () => {} } as unknown as Storytree;

function withHome(body: (home: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const home = mkdtempSync(path.join(tmpdir(), "storytree-app-library-"));
    try {
      await body(home);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  };
}

test("1.9 with the library set to Cloud SQL, the app starts no local Postgres and connects to the instance", withHome(async (home) => {
  setLibrary(["cloudsql", cloudSql.instance, cloudSql.user], home);
  let started = 0;
  const asked: ConnectOptions[] = [];
  const opened = await openAppLibrary({
    home,
    startLocal: async () => { started += 1; return { url: "postgres://postgres@127.0.0.1:1/postgres", stop: async () => {} }; },
    connect: async (options) => { asked.push(options); return connected; },
  });
  assert.equal(started, 0);
  assert.deepEqual([...asked], [{ cloudSql }]);
  assert.equal(opened.storytree, connected);
  assert.equal(opened.postgres, undefined);

  // Local, the app starts its own Postgres and connects to it, as before.
  setLibrary(["local"], home);
  const local = await openAppLibrary({
    home,
    startLocal: async () => { started += 1; return { url: "postgres://postgres@127.0.0.1:1/postgres", stop: async () => {} }; },
    connect: async (options) => { asked.push(options); return connected; },
  });
  assert.equal(started, 1);
  assert.deepEqual(asked.at(-1), { url: "postgres://postgres@127.0.0.1:1/postgres" } satisfies ConnectOptions);
  assert.ok(local.postgres !== undefined);
}));

test("1.10 an unreachable Cloud SQL library is said in the refusal's own words, and the local library is never opened instead", withHome(async (home) => {
  setLibrary(["cloudsql", cloudSql.instance, cloudSql.user], home);
  const refusal = new ConnectionError("sign-in", "Storytree could not find your Google sign-in. Run `gcloud auth application-default login`, then try again.");
  let started = 0;
  await assert.rejects(
    openAppLibrary({
      home,
      startLocal: async () => { started += 1; return { url: "postgres://postgres@127.0.0.1:1/postgres", stop: async () => {} }; },
      connect: async () => { throw refusal; },
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes(cloudSql.instance), error.message);
      assert.ok(error.message.includes(refusal.message), error.message);
      return true;
    },
  );
  assert.equal(started, 0);
}));
