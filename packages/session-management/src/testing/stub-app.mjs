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
