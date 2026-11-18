import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const [dataDir, serverDataDir, testPid] = process.argv.slice(2);
const parent = Number(testPid);
if (!Number.isInteger(parent) || parent <= 0) throw new Error("the stand-in needs its test owner's PID");

function stop() {
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
