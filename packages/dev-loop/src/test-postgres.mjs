// Capability 6 · Running the tests. The test Postgres a `pnpm test` run starts (increment_8c5b1ee4648d): the run hands its
// tests a passwordless url, so a reused cluster that asks for a password (one a run with
// local-postgres's `password: true` converted to SCRAM) would fail every Postgres test with a
// misleading SASL error. Its data is throwaway, so such a cluster is replaced by a fresh one.

import { readFileSync, rmSync } from "node:fs";

import { start } from "@storytree/local-postgres";

/** A pg_hba.conf method that asks the client for a password. */
const PASSWORD_METHODS = new Set(["scram-sha-256", "md5", "password"]);

/**
 * Start the passwordless server on `options.dataDir`. If the cluster there asks for a password, it
 * is stopped, removed (with its sign-in beside it) and made again; the check runs only once this
 * process owns the directory, so a cluster another live run holds is never touched.
 */
export async function startTestPostgres(options) {
  const server = await start(options);
  if (!demandsPassword(server.dataDir)) return server;
  options.log?.(`the cluster in ${server.dataDir} asks for a password this run does not give (a run with password: true converted it); making a fresh one`);
  await server.stop();
  rmSync(server.dataDir, { recursive: true, force: true });
  rmSync(`${server.dataDir}.auth`, { recursive: true, force: true });
  return start(options);
}

function demandsPassword(dataDir) {
  let hba;
  try {
    hba = readFileSync(`${dataDir}/pg_hba.conf`, "utf8");
  } catch {
    return false;
  }
  return hba.split("\n").some((line) => line.replace(/#.*/, "").trim().split(/\s+/).some((word) => PASSWORD_METHODS.has(word)));
}
