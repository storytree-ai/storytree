// A stand-in for the storytree app, for the doctor's test that storytree is opened when closed:
// started as `stub-app.mjs <dataDir> <port>`, it writes the owner record the app's Postgres keeps
// beside its data directory, naming itself and `port` (the test Postgres), then waits until it is
// killed. The agent link's tests keep one like it; this is the command line's own.
import { writeFileSync } from "node:fs";

const [dataDir, port] = process.argv.slice(2);
writeFileSync(`${dataDir}.owner.json`, JSON.stringify({ pid: process.pid, token: "stub", owner: "a stand-in storytree app", port: Number(port), startedAt: new Date().toISOString() }));
setInterval(() => {}, 60_000);
