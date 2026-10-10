// A stand-in for the storytree app, for the setup check's tests (contract 8.3): started as
// `stub-app.mjs <dataDir> <port> [listenAfterMs] [owner]`, it writes the owner record the app's Postgres
// keeps beside its data directory, naming itself and `port`, then waits until it is killed. Given
// `listenAfterMs`, it also listens on `port` itself, but only that long after writing the record,
// as the app's Postgres starts listening a moment after the record is written. Given `owner` (JSON,
// recognised by its brace), its fields go into the record: the token and auth entry of a server
// whose sign-in handoff already waits beside `dataDir`.
import { writeFileSync } from "node:fs";
import { createServer } from "node:net";

const [dataDir, port, ...rest] = process.argv.slice(2);
const owner = rest.find((arg) => arg.startsWith("{"));
const listenAfterMs = rest.find((arg) => !arg.startsWith("{"));
writeFileSync(`${dataDir}.owner.json`, JSON.stringify({ token: "stub", ...(owner === undefined ? {} : JSON.parse(owner)), pid: process.pid, owner: "a stand-in storytree app", port: Number(port), startedAt: new Date().toISOString() }));
if (listenAfterMs !== undefined) {
  setTimeout(() => createServer((socket) => socket.end()).listen(Number(port), "127.0.0.1"), Number(listenAfterMs));
}
setInterval(() => {}, 60_000);
