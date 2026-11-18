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
