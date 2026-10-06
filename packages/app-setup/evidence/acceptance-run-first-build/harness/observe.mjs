// Turns one first-build run into the checks it observed, for `pnpm record:acceptance` (ADR-0825 D5). Every
// check reads what storytree's installed command said on the laptop: `storytree doctor` around each session
// (journey.ps1), and read.ps1's reading of each project's plan, activity log and each contract's reported
// health history afterwards. The sessions' transcripts (turn-*.jsonl) are kept as evidence and
// never read here. A clause the journey does not exercise is written as not-observed, so its contract is left
// not checked rather than passed. It voids the run if the app updated during it.
// Usage: node observe.mjs <journey out> <read.ps1 dir of the first folder> --stamp <stamp>
//          --release <version> --commit <sha> --evidence <path>
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { reportedStates, wentRedThenGreen } from "../../../../dev-loop/src/acceptance-health.mjs";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { stamp: { type: "string" }, release: { type: "string" }, commit: { type: "string" }, evidence: { type: "string" } },
});
const [out, readA] = positionals;

/** A raw output as text: PowerShell writes some files UTF-16 and some UTF-8 or ASCII. */
function read(dir, name) {
  const file = path.join(dir, name);
  if (!existsSync(file)) return undefined;
  const bytes = readFileSync(file);
  const text = bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.subarray(2).toString("utf16le") : bytes.toString("utf8");
  return text.replace(/^﻿/, "").replace(/\r/g, "").trim();
}
const journey = (name) => read(out, name);

const checks = [];
const check = (contract, name, observed, detail) => checks.push({ contract, name, observed: observed === undefined ? "not-observed" : observed ? "pass" : "fail", ...(detail ? { detail } : {}) });

const before = journey("app-version-before.txt");
const after = journey("app-version-after.txt");
if (before !== after) throw new Error(`the app updated during the run (${before} -> ${after}): the run is void`);
if (journey("done.txt") !== "done") throw new Error("the journey did not finish: done.txt is missing");

/** The activity log as `storytree noticeboard log` printed it: one entry per line. */
function logLines(dir) {
  const lines = [];
  for (const text of (read(dir, "log.txt") ?? "").split("\n")) {
    // The line ends "· cause not recorded" or "· caused by #n"; PowerShell 5.1 may re-encode the "·" on its way to the file.
    const m = /^#(\d+)\s+(\S+)\s+(.*?)\s([0-9a-f]{8}-[0-9a-f-]{27})\s+(\S+)(.*?)\s+\S{1,2} (?:cause not recorded|caused by #\d+)$/.exec(text);
    if (m) lines.push({ seq: Number(m[1]), at: Date.parse(m[2]), harness: m[3], session: m[4], kind: m[5], about: m[6].trim() });
  }
  return lines;
}
/** The ids a `storytree library list <kind>` answer names. */
const listed = (dir, kind) => [...(read(dir, `list-${kind}.txt`) ?? "").matchAll(new RegExp(`^\\s+(${kind}_[0-9a-f]+)`, "gm"))].map((m) => m[1]);

for (const side of ["a", "b"]) {
  const project = `st-accept-fb-${values.stamp}-${side}`;
  const where = side === "a" ? "the first folder" : "a second folder, later";
  const doctorBefore = journey(`doctor-${side}-before.txt`);
  const doctorAfter = journey(`doctor-${side}-after.txt`);
  // 2.2: a new agent session in the folder reaches THAT folder's setup check.
  check("2.2", `${where}: storytree's command says it was not a project before the session`, doctorBefore === undefined ? undefined : doctorBefore.includes("This folder is not a storytree project."));
  check("2.2", `${where}: after one new Claude Code session there, storytree's command says it is project "${project}"`, doctorAfter === undefined ? undefined : doctorAfter.includes(`This folder is storytree project "${project}".`));

  // 1.6: the installed command runs from a fresh Windows terminal.
  const source = journey(`command-${side}.txt`);
  check("1.6", `${where}: a fresh PowerShell finds storytree's installed command`, source === undefined ? undefined : /\\\.storytree\\0\.3\\bin\\storytree\.(cmd|exe)$/i.test(source), source);
  const exit = journey(`doctor-${side}-after-exit.txt`);
  check("1.6", `${where}: storytree doctor, run from that fresh PowerShell, exits 0`, exit === undefined ? undefined : exit === "0", exit && `exit ${exit}`);
}
check("1.6", "an existing unrelated storytree command is preserved and the conflict named", undefined);

// 2.7: the first build, read back from folder a's library and activity log.
{
  const project = `st-accept-fb-${values.stamp}-a`;
  check("2.7", "the empty folder was not a project before the first session", journey("doctor-a-before.txt")?.includes("This folder is not a storytree project."));
  check("2.7", `the first session, asked to, made it project "${project}"`, journey("doctor-a-after.txt")?.includes(`This folder is storytree project "${project}".`));

  const stories = listed(readA, "story");
  const capabilities = listed(readA, "capability");
  const contracts = listed(readA, "contract");
  check("2.7", "the library holds the stories, capabilities and contracts the build planned", stories.length > 0 && capabilities.length > 0 && contracts.length > 0, `stories ${stories.length}, capabilities ${capabilities.length}, contracts ${contracts.length}`);

  const arcs = [...(read(readA, "arcs.txt") ?? "").matchAll(/^\s+(arc_[0-9a-f]+)\s+\[(\w+)\]/gm)].map((m) => ({ id: m[1], status: m[2] }));
  const increments = listed(readA, "increment").map((id) => {
    const text = read(readA, `read-${id}.txt`) ?? "";
    return { id, arc: /^arc: (arc_[0-9a-f]+)/m.exec(text)?.[1], status: /^status: (\w+)/m.exec(text)?.[1], landed: /"disposition": "landed"/.test(text) };
  });
  const onArcs = increments.filter((increment) => arcs.some((arc) => arc.id === increment.arc));
  check("2.7", "the library holds an arc with the increments of the work", arcs.length > 0 && onArcs.length > 0, `arcs ${arcs.length} (${arcs.map((arc) => arc.status).join(", ")}), increments on them ${onArcs.length}`);

  // The build turns are 2 and 3; their sessions' lines are those between turn 2's start and turn 3's end.
  const from = Date.parse(journey("turn-2-started.txt"));
  const until = Date.parse(journey("turn-3-ended.txt")) + 1000;
  const lines = logLines(readA).filter((line) => line.at >= from && line.at <= until);
  // The set-up session started before the folder was a project, so its hooks reach the project from the next one.
  const starts = lines.filter((line) => line.kind === "session-started" && line.harness === "Claude Code");
  check("2.7", "the build sessions show up: the project's activity log has their start, from Claude Code", starts.length > 0, `session starts: ${starts.length}`);
  const claimed = lines.filter((line) => line.kind === "claimed");
  check("2.7", "the build sessions took claims: the activity log has their claimed lines", claimed.length > 0, `claimed: ${claimed.map((line) => line.about).join(", ") || "none"}`);

  // Red then green: every state each contract's reported health was written with, oldest first, so a red and
  // a green moments apart are both seen. A history not read leaves it not observed unless another contract shows it.
  const histories = contracts.map((id) => reportedStates(read(readA, `history-${id}.txt`)));
  const redThenGreen = histories.filter(wentRedThenGreen).length;
  const neverRed = histories.filter((states) => states !== undefined && !states.includes("failing")).length;
  const unread = histories.filter((states) => states === undefined).length;
  check(
    "2.7",
    "a contract was reported red, then green (its reported health history has failing, then passing)",
    redThenGreen > 0 ? true : unread > 0 ? undefined : false,
    `red then green: ${redThenGreen} of ${contracts.length}; never red: ${neverRed}; history not read: ${unread}`,
  );
  const landed = increments.filter((increment) => increment.status === "closed" && increment.landed);
  check("2.7", "an increment was closed as landed", landed.length > 0, `closed as landed: ${landed.length} of ${increments.length}`);

  const board = read(readA, "board.txt");
  const units = [...new Set(claimed.map((line) => line.about))];
  const ended = units.filter((unit) => logLines(readA).some((line) => line.about.startsWith(unit) && ["released", "landed", "closed", "merged"].includes(line.kind)));
  check("2.7", "every claim they took ended: storytree's board says nobody holds anything", board === undefined ? undefined : board.includes("Nobody holds anything right now."), `claimed units ${units.length}, ended by a release, landing or closing line ${ended.length}`);
}

console.log(JSON.stringify({ story: "The app setup", release: values.release, commit: values.commit, evidence: values.evidence, note: `Run on the old Windows test laptop (MicksOldLaptop) against the installed app ${before}, Claude Code with the laptop's own sign-in.`, checks }, null, 2));
