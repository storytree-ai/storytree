// `pnpm test`: the website's tests (src/**/*.test.{ts,mjs}, or the files named) with node:test through tsx, against a
// throwaway Postgres that storytree's @storytree/local-postgres runs, as storytree's own `pnpm test` does. That runner
// (storytree/packages/base-dev-loop) is not used here: its scope and guardrails read storytree's own checkout.
//
// The server's cluster lives in .pgtest/data, listens on 127.0.0.1 only, and is always stopped again. The tests get
// STORYTREE_TEST_PG_URL (the ordinary role), STORYTREE_TEST_PG_ADMIN_URL (the superuser) and STORYTREE_TEST_PG_DATA
// (its data directory, which src/testing/pg.ts reads). With STORYTREE_TEST_PG_URL already set, that server is used.
import { spawn } from "node:child_process";
import { globSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { start } from "@storytree/local-postgres";

const root = path.dirname(fileURLToPath(import.meta.url));
const named = process.argv.slice(2);
const files = named.length > 0 ? named : globSync("src/**/*.test.{ts,mjs}", { cwd: root }).sort();

/** `url` with a 30-second connect_timeout: on a loaded machine the throwaway server can answer late. */
const patient = (url) => {
  const patient = new URL(url);
  patient.searchParams.set("connect_timeout", "30");
  return patient.toString();
};

const run = (env) => new Promise((resolve) => {
  const child = spawn(process.execPath, ["--import", "tsx", "--test", ...files], { cwd: root, env, stdio: "inherit" });
  child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
});

let code;
if (process.env.STORYTREE_TEST_PG_URL) {
  console.log("test Postgres: STORYTREE_TEST_PG_URL is set; using that server");
  code = await run({ ...process.env, STORYTREE_TEST_PG_ADMIN_URL: process.env.STORYTREE_TEST_PG_ADMIN_URL || process.env.STORYTREE_TEST_PG_URL });
} else {
  mkdirSync(path.join(root, ".pgtest"), { recursive: true });
  const server = await start({
    dataDir: path.join(root, ".pgtest", "data"),
    owner: "the website's `pnpm test`",
    signIn: "client",
    superuserUrl: true,
    // Its data is thrown away, so no commit need wait on a disk flush.
    settings: { fsync: "off", synchronous_commit: "off", full_page_writes: "off", max_connections: "300" },
    log: (message) => console.log(`test Postgres: ${message}`),
  });
  const stop = () => server.stop().finally(() => process.exit(130));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    code = await run({ ...process.env, STORYTREE_TEST_PG_URL: patient(server.url), STORYTREE_TEST_PG_ADMIN_URL: patient(server.superuserUrl), STORYTREE_TEST_PG_DATA: server.dataDir });
  } finally {
    await server.stop();
  }
}
process.exitCode = code;
