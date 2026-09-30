// Turns one journey.ps1 run's raw outputs into the checks it observed, for `pnpm record:acceptance`
// (ADR-0825 D5). Every check reads what storytree's installed command or the machine said: the model's
// replies (claude-*.txt) are kept as evidence and never read here. A clause the journey does not
// exercise is written as not-observed, so its contract is left not checked rather than passed.
// Usage: node observe.mjs <outDir> --stamp <stamp> --release <version> --commit <sha> --evidence <path>
//          [--baseline-version <version>]   (the app's version recorded before the run, to see an update)
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { stamp: { type: "string" }, release: { type: "string" }, commit: { type: "string" }, evidence: { type: "string" }, "baseline-version": { type: "string" } },
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

const started = Date.parse(read("started.txt") ?? "");
const before = read("app-version-before.txt");
const after = read("app-version-after.txt");
if (before !== after) throw new Error(`the app updated during the run (${before} -> ${after}): the run is void`);

for (const side of ["a", "b"]) {
  const project = `st-accept-${values.stamp}-${side}`;
  const where = side === "a" ? "the first folder" : "a second folder, later";
  const doctorBefore = read(`doctor-${side}-before.txt`);
  const doctorAfter = read(`doctor-${side}-after.txt`);
  const fired = /Hooks last seen firing: (\S+), from Claude Code\./.exec(doctorAfter ?? "")?.[1];

  // 2.2: a new agent session in the folder reaches THAT folder's setup check.
  check("2.2", `${where}: storytree's command says it was not a project before the session`, doctorBefore === undefined ? undefined : doctorBefore.includes("This folder is not a storytree project."));
  check("2.2", `${where}: after one new Claude Code session there, storytree's command says it is project "${project}"`, doctorAfter === undefined ? undefined : doctorAfter.includes(`This folder is storytree project "${project}".`));
  check("2.2", `${where}: Claude Code's hooks reached storytree after the run started`, fired === undefined ? false : Date.parse(fired) >= started, fired && `last seen firing ${fired}`);

  // 1.6: the installed command runs from a fresh Windows terminal.
  const source = read(`command-${side}.txt`);
  check("1.6", `${where}: a fresh PowerShell finds storytree's installed command`, source === undefined ? undefined : /\\\.storytree\\0\.3\\bin\\storytree\.cmd$/i.test(source), source);
  const exit = read(`doctor-${side}-exit.txt`);
  check("1.6", `${where}: storytree doctor, run from that fresh PowerShell, exits 0`, exit === undefined ? undefined : exit === "0", exit && `exit ${exit}`);

  // 1.5: after an ordinary update, the next session starts compatible tools from a durable place.
  check("1.5", `${where}: with no Node and no Git on the machine's path, the session's tools set the folder up`, doctorAfter === undefined ? undefined : doctorAfter.includes("There is no Node on the path.") && doctorAfter.includes("git is not installed.") && doctorAfter.includes(`project "${project}"`));
}
const registration = read("mcp-registration.txt");
check("1.5", "Claude Code starts storytree's tool server from the installed app's own folder, not a checkout or a package cache", registration === undefined ? undefined : registration !== "" && registration.split("\n").every((line) => /\\\\AppData\\\\Local\\\\Programs\\\\storytree-0\.3\\\\resources\\\\agent-tools\\\\storytree-mcp\.mjs/i.test(line)), registration);
check("1.6", "an existing unrelated storytree command is preserved and the conflict named", undefined);
const updated = values["baseline-version"] !== undefined && values["baseline-version"] !== before;
check("1.5", "the app took an ordinary release update before these sessions started", values["baseline-version"] === undefined ? undefined : updated, `${values["baseline-version"]} -> ${before}`);

console.log(JSON.stringify({ story: "The app setup", release: values.release, commit: values.commit, evidence: values.evidence, checks }, null, 2));
