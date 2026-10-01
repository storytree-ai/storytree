// Turns one conflict.ps1 run's raw outputs into the checks it observed, for `pnpm record:acceptance`
// (ADR-0825 D5), on the pattern of ../../acceptance-run/harness/observe.mjs. Every check reads what the
// installed app's own installer step, its setup check, a fresh PowerShell or the machine said: both of
// 1.6's clauses, the user's own command kept and named, then storytree's found again once it is gone.
// Usage: node observe.mjs <outDir> --release <version> --commit <sha> --evidence <path>
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { release: { type: "string" }, commit: { type: "string" }, evidence: { type: "string" } },
});
const out = positionals[0];

/** A raw output as text: PowerShell writes some files UTF-16 and some ASCII. */
function read(name) {
  const file = path.join(out, name);
  if (!existsSync(file)) return undefined;
  const bytes = readFileSync(file);
  const text = bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.subarray(2).toString("utf16le") : bytes.toString("utf8");
  return text.replace(/^﻿/, "").replace(/\r/g, "").trim();
}

const checks = [];
const check = (contract, name, observed, detail) => checks.push({ contract, name, observed: observed === undefined ? "not-observed" : observed ? "pass" : "fail", ...(detail ? { detail } : {}) });

if (read("refused.txt") !== undefined) throw new Error(`the run refused to start: ${read("refused.txt")}`);
if (read("done.txt") !== "done") throw new Error("the run did not finish: the run is void");
const before = read("app-version-before.txt");
const after = read("app-version-after.txt");
if (before !== after) throw new Error(`the app updated during the run (${before} -> ${after}): the run is void`);

const dummy = read("dummy-path.txt");
let report;
try {
  report = JSON.parse(read("finish.txt") ?? "");
} catch {
  report = undefined;
}
const command = report?.command;
check("1.6", "with a storytree command of the user's own on the path, the installer's finish step reports a conflict naming that command's file", command === undefined ? false : command.status === "conflict" && command.conflict?.toLowerCase() === dummy?.toLowerCase(), command && `${command.status}: ${command.conflict ?? command.file}`);
check("1.6", "the user's own command is preserved byte for byte, and storytree's own launcher is left as it was", read("dummy-before.txt") !== undefined && read("dummy-before.txt") === read("dummy-after.txt") && read("launcher-before.txt") === read("launcher-after.txt"));
const doctor = read("doctor.txt");
check("1.6", "storytree doctor, run from the installation, names the conflict and keeps the user's command", doctor === undefined ? undefined : /there is a storytree of your own on your path, so storytree's was not put there/.test(doctor), doctor?.split("\n").find((line) => line.includes("storytree command")));
const fresh = read("fresh-storytree.txt");
check("1.6", "a fresh PowerShell still runs the user's own storytree command, not storytree's", fresh === undefined ? undefined : fresh.startsWith("the user's own storytree command"), fresh);
check("1.6", "the planted command was removed afterwards", read("dummy-left.txt") === "False");
const source = read("command-after.txt");
check("1.6", "with the user's command gone, a fresh PowerShell finds storytree's installed command", source === undefined ? undefined : /\\\.storytree\\0\.3\\bin\\storytree\.cmd$/i.test(source), source);
const exit = read("doctor-after-exit.txt");
check("1.6", "storytree doctor, run from that fresh PowerShell, exits 0", exit === undefined ? undefined : exit === "0", exit && `exit ${exit}`);

console.log(JSON.stringify({ story: "The app setup", release: values.release, commit: values.commit, evidence: values.evidence, checks }, null, 2));
