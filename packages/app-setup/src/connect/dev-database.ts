// Capability 2 · Connect an agent
import { writeFileSync } from "node:fs";
import path from "node:path";

import { start } from "@storytree/local-postgres";
import { readProcess } from "@storytree/session-management/processes";

const home = process.argv[2];
if (home === undefined) throw new Error("usage: dev-database <storytree home>");
const self = await readProcess(process.pid);
if (self.state !== "live") throw new Error(`Could not read this database owner's identity: ${self.state === "unknown" ? self.reason : self.state}.`);
writeFileSync(path.join(home, "dev-database.json"), `${JSON.stringify(self.identity)}\n`);
const server = await start({ dataDir: path.join(home, "pgdata"), owner: "a dev build's throwaway home" });
const stop = async () => { await server.stop(); process.exit(0); };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
setInterval(() => {}, 1 << 30);
