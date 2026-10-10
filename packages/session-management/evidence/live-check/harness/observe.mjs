// observe.mjs <dir> <out> <commit>: turn journey.sh's run into the checks of setup check 8.6, as
// `pnpm record:acceptance` reads them. It reads only what storytree recorded (the throwaway home's library
// and activity log) and what storytree's command said; the sessions' replies are never read.
// Run from this checkout: node --import tsx packages/session-management/evidence/live-check/harness/observe.mjs …
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { connect } from "@storytree/library";
import { attributeFrom, openActivityLog } from "../../../src/index.ts";

const [dir, out, commit] = process.argv.slice(2);
const read = (name) => readFileSync(path.join(out, name), "utf8");
const storytreeHome = path.join(dir, "home", ".storytree", "0.3");
const { port } = JSON.parse(readFileSync(path.join(storytreeHome, "pgdata.owner.json"), "utf8"));
const storytree = await connect({ url: `postgres://postgres@127.0.0.1:${port}/postgres` });
const log = await openActivityLog(storytree);
const checks = [];
const check = (name, passed, detail) => checks.push({ contract: "8.6", name, observed: passed ? "pass" : "fail", ...(detail === undefined ? {} : { detail }) });

async function linesOf(project) {
  const lines = [];
  for (let cursor = 0; ;) {
    const page = await log.since(project, cursor);
    if (page.lines.length === 0) return lines;
    lines.push(...page.lines);
    cursor = page.cursor;
  }
}

for (const [agent, label] of [["claude-code", "Claude Code"], ["codex", "Codex"]]) {
  const project = read(`${agent}-project.txt`).trim();
  const since = read(`${agent}-session-started.txt`).trim();
  check(`${label}: the new folder was not a project before it was set up`, /not a storytree project/i.test(read(`${agent}-doctor-before.txt`)));
  check(`${label}: after the session, storytree's command says the folder is project "${project}"`, read(`${agent}-doctor-after.txt`).includes(`storytree project "${project}"`));

  const lines = (await linesOf(project)).filter((line) => Date.parse(line.at) >= Date.parse(since));
  const sessions = [...new Set(lines.filter((line) => line.harness === agent && line.kind === "session-started").map((line) => line.session))];
  check(`${label}: its session shows up live: the activity log has its session start, from ${label}`, sessions.length > 0, `sessions started: ${sessions.length}`);
  const own = lines.filter((line) => sessions.includes(line.session));
  const kinds = (kind) => own.filter((line) => line.kind === kind);

  const library = await storytree.openProject(project);
  try {
    const tree = await library.projectTree();
    const capabilities = tree.stories.flatMap((story) => story.capabilities);
    const contracts = capabilities.flatMap((capability) => capability.contracts);
    check(`${label}: it planned: the library holds a story, a capability and a contract`, tree.stories.length > 0 && capabilities.length > 0 && contracts.length > 0, `stories ${tree.stories.length}, capabilities ${capabilities.length}, contracts ${contracts.length}`);
    check(`${label}: it claimed: the activity log has its claim`, kinds("claimed").length > 0, kinds("claimed").map((line) => line.capability ?? line.increment).join(", ") || "none");
    let redThenGreen = 0;
    for (const contract of contracts) {
      const reported = (await library.healthHistory(contract.id)).filter((entry) => entry.column === "reported");
      const red = reported.findIndex((entry) => entry.state === "failing");
      if (red >= 0 && reported.slice(red + 1).some((entry) => entry.state === "passing")) redThenGreen++;
    }
    check(`${label}: it reported a contract red, then green`, redThenGreen > 0, `contracts reported red then green: ${redThenGreen} of ${contracts.length}`);
    const landed = kinds("landed").length + kinds("closed").filter((line) => line.disposition === "landed").length;
    check(`${label}: it landed: the activity log has a capability landed or an increment closed as landed`, landed > 0, `landed lines: ${landed}`);
    // Its work: the files it edited and the commands it ran (an agent may write files with a shell command).
    const work = attributeFrom(own).filter(({ line }) => line.kind === "file-edited" || line.kind === "command-run");
    const edits = work.filter(({ line }) => line.kind === "file-edited").length;
    check(`${label}: the activity log shows its work: its file edits and the commands it ran`, work.length > 0, `edits ${edits}, commands ${work.length - edits}; counted toward planned work: ${work.filter((one) => one.capability !== undefined || one.increment !== undefined).length} of ${work.length}`);
  } finally {
    await library.close();
  }
}

// The session that ignores storytree, in the Claude Code folder: its edit shows up, counted toward no planned work.
{
  const since = read("unplanned-session-started.txt").trim();
  const until = read("unplanned-session-ended.txt").trim();
  const lines = (await linesOf(read("unplanned-project.txt").trim())).filter((line) => Date.parse(line.at) >= Date.parse(since) && Date.parse(line.at) <= Date.parse(until) + 999);
  const sessions = new Set(lines.filter((line) => line.kind === "session-started").map((line) => line.session));
  const edits = attributeFrom(lines.filter((line) => sessions.has(line.session))).filter(({ line }) => line.kind === "file-edited");
  const unplanned = edits.filter((edit) => edit.capability === undefined && edit.increment === undefined);
  check("a second session that ignores storytree and only edits a file shows up as unplanned activity", edits.length > 0 && unplanned.length === edits.length, `its edits: ${edits.length}, unplanned: ${unplanned.length}`);
}

await log.close();
await storytree.close();
const observations = {
  story: "The agent link",
  commit,
  evidence: "packages/session-management/evidence/live-check/" + path.basename(out),
  note: "Run on the Mint box (Linux) against this checkout's dev build, through app setup's dev-home: a throwaway home and database, the agents' own sign-ins.",
  checks,
};
writeFileSync(path.join(out, "observations.json"), `${JSON.stringify(observations, null, 2)}\n`);
for (const { observed, name, detail } of checks) console.log(`${observed.padEnd(5)} ${name}${detail === undefined ? "" : ` (${detail})`}`);
