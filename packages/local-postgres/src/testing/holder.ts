/**
 * A second process that holds a local Postgres, for local-postgres.test.ts. It starts the server on
 * the data directory given as its argument and prints `ready <url>`. A line `stop` on stdin (or
 * stdin closing) stops the server and exits 0. Killed instead, it leaves the server running with
 * no live owner: the stale case start() recovers from.
 */
import { createInterface } from "node:readline";

import { start } from "../index.js";

const dataDir = process.argv[2];
if (dataDir === undefined) throw new Error("usage: holder.ts <dataDir>");

const server = await start({ dataDir, owner: "test holder" });
process.stdout.write(`ready ${server.url}\n`);
for await (const line of createInterface({ input: process.stdin })) {
  if (line.trim() === "stop") break;
}
await server.stop();
process.exit(0);
