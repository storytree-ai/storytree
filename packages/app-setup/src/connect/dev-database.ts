/**
 * Capability 2 · Connect an agent. A dev home's database (see dev-home.ts): what its app.json starts when a storytree command finds
 * it closed. It runs the home's own Postgres, as the app would, until it is told to stop.
 *
 *   node --import tsx dev-database.ts <storytree home>
 */
import path from "node:path";

import { start } from "@storytree/local-postgres";

const home = process.argv[2];
if (home === undefined) throw new Error("usage: dev-database <storytree home>");
const server = await start({ dataDir: path.join(home, "pgdata"), owner: "a dev build's throwaway home" });
const stop = async () => { await server.stop(); process.exit(0); };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
setInterval(() => {}, 1 << 30);
