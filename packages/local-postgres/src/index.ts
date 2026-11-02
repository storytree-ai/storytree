// Capability 2 · A server on a data directory. @storytree/local-postgres: a local Postgres server on a data directory, from the
// @embedded-postgres binaries. The test harness (packages/base-dev-loop/src/test.mjs), the seed script and the
// desktop app all start their servers through it.
export { binaryPackages, findBinaries } from "./binaries.js";
export type { FindBinariesOptions } from "./binaries.js";
export { DataDirInUseError, ensureCluster, letThrough, pgCtl, serverAccount, start } from "./server.js";
export type { Account, ClusterOptions, LocalPostgres, PgCtlOptions, StartOptions } from "./server.js";
