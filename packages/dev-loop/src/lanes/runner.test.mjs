import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { main, runLane } from "./runner.mjs";

const exec = promisify(execFile);
const start = Date.parse("2026-10-06T00:00:00Z");
const command = (script) => [process.execPath, "-e", script, "--"];
const receipt = `console.log(JSON.stringify({args:process.argv.slice(1),cwd:process.cwd(),token:process.env.CLAUDE_CODE_OAUTH_TOKEN,db:process.env.STORYTREE_DB_USER,keys:['OPENAI_API_KEY','CODEX_API_KEY','CODEX_ACCESS_TOKEN','ANTHROPIC_API_KEY'].filter(k=>process.env[k]),stdin:require('node:fs').readFileSync(0,'utf8')})); console.error('engine stderr');`;

async function lane(t) {
  const home = await mkdtemp(join(tmpdir(), "lane-runner-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const lanesDir = join(home, "lanes"), cwd = join(home, "worktree");
  await mkdir(lanesDir); await mkdir(cwd); await mkdir(join(home, ".storytree"));
  await writeFile(join(home, ".storytree", "secrets.json"), JSON.stringify({ CLAUDE_CODE_OAUTH_TOKEN: "test-login", STORYTREE_DB_USER: "test-db" }));
  const brief = join(home, "brief.md"), log = join(lanesDir, "lane.log"), err = join(lanesDir, "lane.err");
  await writeFile(brief, "Build this increment. Preserve `literal` $text and \"quotes\".\n");
  const lines = [];
  return { home, lanesDir, cwd, brief, log, err, addDirs: [join(home, "directory with spaces"), "another"],
    env: { ...process.env, LANES_DIR: lanesDir, CODEX_STOP_AT: "95", FAST_FAIL_S: "120", CLAUDE_CODE_OAUTH_TOKEN: "", STORYTREE_DB_USER: "", OPENAI_API_KEY: "test-api", CODEX_API_KEY: "test-api", CODEX_ACCESS_TOKEN: "test-api", ANTHROPIC_API_KEY: "test-api" },
    commands: { codex: command(receipt), claude: command(receipt) }, now: () => start, say: (line) => lines.push(line), lines };
}

test("10.6 · foreground engines receive the exact brief, model, directories and login environment in the current folder", async (t) => {
  const options = await lane(t);
  for (const engine of ["codex", "claude"]) {
    await writeFile(join(options.lanesDir, "engine-override"), engine);
    assert.equal(await runLane(options), 0);
    const result = JSON.parse(await readFile(options.log, "utf8"));
    const adds = options.addDirs.flatMap((path) => ["--add-dir", path]);
    const brief = await readFile(options.brief, "utf8");
    assert.deepEqual(result.args, engine === "codex"
      ? ["exec", brief, "--model", "gpt-6-astra", "--sandbox", "danger-full-access", "--dangerously-bypass-hook-trust", ...adds, "--json"]
      : ["-p", brief, "--model", "claude-opus-5-5", "--permission-mode", "bypassPermissions", ...adds, "--output-format", "stream-json", "--verbose"]);
    assert.equal(await realpath(result.cwd), await realpath(options.cwd));
    assert.equal(result.token, "test-login"); assert.equal(result.db, "test-db");
    assert.deepEqual(result.keys, []); assert.equal(result.stdin, "");
    assert.equal(await readFile(options.err, "utf8"), "engine stderr\n");
    assert.match(options.lines.at(-2), new RegExp(`^2026-10-06T00:00:00Z engine ${engine} forced by `));
    assert.equal(options.lines.at(-1), `2026-10-06T00:00:00Z engine ${engine} exit 0`);
  }
  options.env.CLAUDE_CODE_OAUTH_TOKEN = "existing-login";
  options.env.STORYTREE_DB_USER = "existing-db";
  await rm(join(options.home, ".storytree", "secrets.json"));
  assert.equal(await runLane(options), 0);
  const result = JSON.parse(await readFile(options.log, "utf8"));
  assert.equal(result.token, "existing-login"); assert.equal(result.db, "existing-db");
  assert.equal(options.env.OPENAI_API_KEY, "test-api", "the caller's environment is not mutated");
});

test("10.7 · a Codex limit stop hands over once, preserving the original brief and separate logs", async (t) => {
  const options = await lane(t);
  options.env.FAST_FAIL_S = "0";
  options.commands.codex = command(`console.log(JSON.stringify({type:'turn.failed',error:{message:'usage limit'}}));process.exitCode=1;`);
  options.commands.claude = command(receipt + `console.error('usage limit');process.exitCode=9;`);
  assert.equal(await runLane(options), 9);
  const original = await readFile(options.brief, "utf8");
  const handover = await readFile(join(options.lanesDir, "lane.claude-brief.md"), "utf8");
  assert.ok(handover.endsWith(original));
  assert.match(handover, /git worktree list/); assert.match(handover, /gh pr list --head <branch> --state all/);
  assert.match(handover, /idle.*claiming it again/); assert.match(handover, /never build without the claim/);
  assert.equal(JSON.parse(await readFile(join(options.lanesDir, "lane.claude.log"), "utf8")).args[1], handover);
  assert.match(await readFile(join(options.lanesDir, "lane.claude.err"), "utf8"), /usage limit/);
  assert.equal(JSON.parse(await readFile(options.log, "utf8")).type, "turn.failed");
  assert.equal(Number(await readFile(join(options.lanesDir, "codex-exhausted-until"), "utf8")), start / 1000 + 3600);
  assert.equal(options.lines.filter((line) => line.includes("engine claude")).length, 2);
  assert.equal(options.lines.at(-1), "2026-10-06T00:00:00Z engine claude exit 9");
});

test("10.7 · a completed or externally stopped Codex turn is not handed over, even with a spent reading", async (t) => {
  const options = await lane(t);
  await writeFile(join(options.lanesDir, "engine-override"), "codex");
  const day = join(options.home, ".codex", "sessions", "2026", "10", "06");
  await mkdir(day, { recursive: true });
  await writeFile(join(day, "rollout-lane.jsonl"), JSON.stringify({ timestamp: new Date(start).toISOString(), payload: { type: "token_count", rate_limits: { primary: { used_percent: 100, resets_at: start / 1000 + 500 } } } }));
  for (const type of ["turn.completed", "turn.started"]) {
    options.commands.codex = command(`console.log(JSON.stringify({type:${JSON.stringify(type)}}));`);
    assert.equal(await runLane(options), 0);
    await assert.rejects(readFile(join(options.lanesDir, "lane.claude.log")), { code: "ENOENT" });
  }
});

test("10.8 · a lane stopped by a signal to its runner exits 75, so its queue keeps it, and is not handed over", async (t) => {
  const options = await lane(t);
  options.env.FAST_FAIL_S = "0";
  await writeFile(join(options.lanesDir, "engine-override"), "codex");
  options.commands.codex = command("console.log('started'); setTimeout(() => {}, 60_000);");
  const running = runLane(options);
  while (!(await readFile(options.log, "utf8").catch(() => "")).includes("started")) await new Promise((wake) => setTimeout(wake, 50));
  process.emit("SIGTERM", "SIGTERM");
  assert.equal(await running, 75);
  assert.match(options.lines.at(-1), /stopped by a signal: exit 75 so the runner keeps this lane queued$/);
  await assert.rejects(readFile(join(options.lanesDir, "lane.claude.log")), { code: "ENOENT" });
});

test("10.8 · the last engine's failure is 75 only before FAST_FAIL_S, defaulting to 120 seconds", async (t) => {
  const options = await lane(t);
  for (const [exit, seconds, threshold, expected] of [[0, 0, undefined, 0], [2, 119, undefined, 75], [2, 120, undefined, 2], [2, 4, "5", 75], [2, 5, "5", 2], [2, 0, "0", 2]]) {
    let clock = start;
    options.now = () => clock;
    options.say = (line) => { if (line.includes(" exit ")) clock += seconds * 1000; };
    if (threshold === undefined) delete options.env.FAST_FAIL_S;
    else options.env.FAST_FAIL_S = threshold;
    options.commands.codex = command(`process.exitCode=${exit};`);
    assert.equal(await runLane(options), expected);
  }
  options.env.FAST_FAIL_S = "120";
  options.commands.codex = [join(options.home, "missing-engine")];
  options.now = () => start;
  assert.equal(await runLane(options), 75);
  assert.match(await readFile(options.err, "utf8"), /ENOENT/);
});

test("10.8 · the fast-failure timer restarts for Claude after a long Codex run", async (t) => {
  const options = await lane(t);
  let clock = start;
  options.now = () => clock;
  options.say = (line) => {
    if (line.includes("engine codex exit")) clock += 600_000;
    if (line.includes("engine claude exit")) clock += 1_000;
  };
  options.commands.codex = command(`console.error('usage limit');process.exitCode=1;`);
  options.commands.claude = command("process.exitCode=2;");
  assert.equal(await runLane(options), 75);
});

test("10.9 · status shows both windows, reset, reached and credits, override and marker, and the next engine", async (t) => {
  const options = await lane(t);
  const day = join(options.home, ".codex", "sessions", "2026", "10", "06");
  await mkdir(day, { recursive: true });
  await writeFile(join(day, "rollout-test.jsonl"), JSON.stringify({ timestamp: new Date(start).toISOString(), payload: { type: "token_count", rate_limits: {
    primary: { used_percent: 40, window_minutes: 300, resets_at: start / 1000 + 300 },
    secondary: { used_percent: 95, window_minutes: 10080, resets_at: start / 1000 + 7200 },
    rate_limit_reached_type: "weekly", credits: { balance: 123, has_credits: true },
  } } }));
  assert.equal(await main(["status"], options), 0);
  const status = options.lines.join("\n");
  for (const fragment of ["override: none (automatic)", "exhausted marker: none", "primary 40%", "300 min", "secondary 95%", "10080 min", "2026-10-06T02:00Z", "weekly", "123", "next lane: claude", "switch at 95%"]) assert.ok(status.includes(fragment), fragment);
  await writeFile(join(options.lanesDir, "engine-override"), "codex");
  await writeFile(join(options.lanesDir, "codex-exhausted-until"), String(start / 1000 + 3600));
  options.lines.length = 0;
  await main(["status"], options);
  assert.match(options.lines.join("\n"), /exhausted marker: until 2026-10-06T01:00Z/);
  assert.match(options.lines.join("\n"), /next lane: codex \(forced by/);
});

test("10.6 · the command front door runs a brief, refuses empty input and supports status without starting an engine", async (t) => {
  const options = await lane(t);
  assert.equal(await main(["run", options.brief, options.log, options.err, ...options.addDirs], options), 0);
  assert.equal(await main(["run"], options), 2);
  assert.equal(await main(["unknown"], options), 2);
  await writeFile(options.brief, "");
  assert.equal(await main(["run", options.brief, options.log, options.err], options), 75, "a lane that cannot start stays queued");
  const runner = fileURLToPath(new URL("./runner.mjs", import.meta.url));
  const result = await exec(process.execPath, [runner, "status"], { cwd: options.cwd, env: { ...options.env, HOME: options.home, USERPROFILE: options.home } });
  assert.match(result.stdout, /latest reading: none/);
  assert.match(result.stdout, /next lane: codex/);
});

test("10.10 · a lane whose newest reading is stale and spent runs one Codex probe for a fresh reading, then picks from it", async (t) => {
  const options = await lane(t);
  const day = join(options.home, ".codex", "sessions", "2026", "10", "06");
  await mkdir(day, { recursive: true });
  const event = (at, used) => JSON.stringify({ timestamp: new Date(at).toISOString(), payload: { rate_limits: { secondary: { used_percent: used, window_minutes: 10080, resets_at: start / 1000 + 86400 } } } });
  await writeFile(join(day, "rollout-old.jsonl"), event(start - 3 * 3_600_000, 97));
  const fresh = join(day, "rollout-fresh.jsonl");
  options.commands.codex = command(`const fs=require('node:fs'); if (process.argv.some(a=>a.startsWith('Reply with the single word OK.'))) fs.writeFileSync(${JSON.stringify(fresh)}, ${JSON.stringify(event(start, 1))}); else console.log('lane ran');`);
  options.commands.claude = command("process.exit(9)");
  assert.equal(await runLane(options), 0);
  assert.match(options.lines[0], /engine codex Codex weekly allowance 1% used, resets .* \(refreshed a reading 3h old\)$/);
  assert.equal((await readFile(options.log, "utf8")).trim(), "lane ran");
  await assert.doesNotReject(readFile(options.log.replace(/\.log$/, ".probe.log")));
  options.lines.length = 0;
  await main(["status"], options);
  assert.doesNotMatch(options.lines.join("\n"), /over an hour old/, "a fresh Codex reading needs no refresh");
  await writeFile(fresh, event(start - 2 * 3_600_000, 98));
  options.lines.length = 0;
  await main(["status"], options);
  assert.match(options.lines.at(-1), /next lane: claude .*the next lane takes a fresh one first$/);
});

test("10.11 · a lane that exits 0 having left no report or push is resumed once, then its claims are released and residue written", async (t) => {
  const options = await lane(t);
  const session = "1aeed14e-4eef-44a7-a5a0-55f748d0a4b5";
  const runs = join(options.home, "runs");
  // A Claude engine that names its session, records each call, and with WRITE_REPORT set writes the lane's report.
  options.commands.claude = command(`const fs=require('node:fs'); fs.appendFileSync(${JSON.stringify(runs)}, JSON.stringify(process.argv.slice(1))+'\\n');`
    + ` console.log(JSON.stringify({type:'system',subtype:'init',session_id:${JSON.stringify(session)}}));`
    + ` if (process.env.WRITE_REPORT && process.argv.includes('--resume')) fs.writeFileSync(${JSON.stringify(join(options.lanesDir, "pool-increment_abc.report.md"))}, 'done');`);
  await writeFile(join(options.lanesDir, "engine-override"), "claude");
  const told = [];
  options.increment = "increment_abc";
  options.heads = async () => ({ "claude/increment-abc-old": "1111" });
  options.storytree = async (args) => {
    told.push(args);
    if (args[0] === "noticeboard") return `2 claims now:\n  - increment increment_abc  Claude Code ${session} (idle, on claude/increment-abc-x), since 2026-10-06T00:00:00Z: build\n  - capability capability_other  Claude Code someone-else (live), since 2026-10-06T00:00:00Z: other\n`;
    if (args[0] === "library") return "The breakdown.";
    return "";
  };
  const calls = async () => (await readFile(runs, "utf8")).trim().split("\n").map((line) => JSON.parse(line));

  assert.equal(await runLane(options), 1, "a lane that left nothing twice is not counted done");
  const [first, second] = await calls();
  assert.equal(first[1], await readFile(options.brief, "utf8"));
  assert.equal(second[0], "-p"); assert.match(second[1], /ended your turn while your work was unfinished: continue/);
  assert.deepEqual(second.slice(2, 4), ["--resume", session]);
  assert.deepEqual(told.find((args) => args[1] === "release"), ["workspace", "release", "increment_abc", "--holder", session, "--reason", told.find((args) => args[1] === "release")[6]]);
  assert.equal(told.filter((args) => args[1] === "release").length, 1, "only the lane's own claims are released");
  const edit = told.find((args) => args[0] === "arc");
  assert.deepEqual(edit.slice(0, 4), ["arc", "increment", "edit", "increment_abc"]);
  assert.match(edit[5], /^The breakdown\.\n\nResidue \(lane runner, 2026-10-06\): .*no report.*twice/s);
  assert.match(edit[5], new RegExp(options.log.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")));

  await rm(runs); told.length = 0;
  options.env.WRITE_REPORT = "1";
  assert.equal(await runLane(options), 0, "a resumed lane that then writes its report is done");
  assert.equal((await calls()).length, 2);
  assert.deepEqual(told, []);

  await rm(runs);
  delete options.env.WRITE_REPORT;
  let pushed = false;
  options.heads = async () => (pushed = !pushed) ? { "claude/increment-abc-old": "1111" } : { "claude/increment-abc-old": "1111", "claude/increment-abc-new": "2222" };
  assert.equal(await runLane(options), 0, "a lane that pushed a branch for its increment is done at once");
  assert.equal((await calls()).length, 1);
  assert.deepEqual(told, []);
});
