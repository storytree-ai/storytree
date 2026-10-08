// A stand-in for the storytree app, for the doctor's test that storytree is opened when closed:
// started as `stub-app.mjs <dataDir> <serverDataDir> <testPid>`, it writes the owner record the app's
// Postgres keeps beside its data directory: the test Postgres's own (`<serverDataDir>.owner.json`, so
// its port, token and sign-in metadata agree with any handoff the test placed), naming itself. It
// lives only as long as its test, not the short-lived doctor command that launches it detached.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const [dataDir, serverDataDir, testPid] = process.argv.slice(2);
const parent = Number(testPid);
if (!Number.isInteger(parent) || parent <= 0) throw new Error("the stand-in needs its test owner's PID");

function stop() {
  // This is only the stand-in's disposable home, never the shared test Postgres's directory.
  rmSync(path.dirname(dataDir), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  process.exit();
}

function checkOwner() {
  try { process.kill(parent, 0); } catch (error) {
    if (error.code === "ESRCH") stop();
    else throw error;
  }
}

checkOwner();
const server = JSON.parse(readFileSync(`${serverDataDir}.owner.json`, "utf8"));
writeFileSync(`${dataDir}.owner.json`, JSON.stringify({ ...server, pid: process.pid, owner: "a stand-in storytree app", startedAt: new Date().toISOString() }));
process.on("SIGTERM", stop);
setInterval(checkOwner, 250);
