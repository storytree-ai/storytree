import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { removeTemp, waitUntil } from "@storytree/test-waits";

import { main, runLane } from "./runner.mjs";

const exec = promisify(execFile);
const start = Date.parse("2026-10-06T00:00:00Z");
const command = (script) => [process.execPath, "-e", script, "--"];
const receipt = `console.log(JSON.stringify({args:process.argv.slice(1),cwd:process.cwd(),token:process.env.CLAUDE_CODE_OAUTH_TOKEN,keys:['OPENAI_API_KEY','CODEX_API_KEY','CODEX_ACCESS_TOKEN','ANTHROPIC_API_KEY'].filter(k=>process.env[k]),stdin:require('node:fs').readFileSync(0,'utf8')})); console.error('engine stderr');`;

async function lane(t) {
  const home = await mkdtemp(join(tmpdir(), "lane-runner-"));
  t.after(() => removeTemp(home));
  const lanesDir = join(home, "lanes"), cwd = join(home, "worktree");
  await mkdir(lanesDir); await mkdir(cwd); await mkdir(join(home, ".storytree"));
  await writeFile(join(home, ".storytree", "secrets.json"), JSON.stringify({ CLAUDE_CODE_OAUTH_TOKEN: "test-login" }));
  const brief = join(home, "brief.md"), log = join(lanesDir, "lane.log"), err = join(lanesDir, "lane.err");
  await writeFile(brief, "Build this increment. Preserve `literal` $text and \"quotes\".\n");
  const lines = [];
  // Run from a Claude lane, the runner's own environment already carries what it gives a Claude engine.
  const { CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: _hooks, STORYTREE_SESSION_FILE: _file, ...inherited } = process.env;
  return { home, lanesDir, cwd, brief, log, err, addDirs: [join(home, "directory with spaces"), "another"],
    env: { ...inherited, LANES_DIR: lanesDir, CODEX_STOP_AT: "95", FAST_FAIL_S: "120", CLAUDE_CODE_OAUTH_TOKEN: "", OPENAI_API_KEY: "test-api", CODEX_API_KEY: "test-api", CODEX_ACCESS_TOKEN: "test-api", ANTHROPIC_API_KEY: "test-api" },
    commands: { codex: command(receipt), claude: command(receipt) }, now: () => start, say: (line) => lines.push(line), lines, failed: async () => [] };
}

test("1.6 · foreground engines receive the exact brief, model, directories and login environment in the current folder", async (t) => {
  const options = await lane(t);
  for (const engine of ["codex", "claude"]) {
    await writeFile(join(options.lanesDir, "engine-override"), engine);
    assert.equal(await runLane(options), 0);
    const result = JSON.parse(await readFile(options.log, "utf8"));
    const adds = options.addDirs.flatMap((path) => ["--add-dir", path]);
    const brief = await readFile(options.brief, "utf8");
    assert.deepEqual(result.args, engine === "codex"
      ? ["exec", brief, "--model", "gpt-6-astra", "--sandbox", "danger-full-access", "--dangerously-bypass-hook-trust", ...adds, "--json"]
      : ["-p", brief, "--model", "claude-opus-5-5", "--permission-mode", "bypassPermissions", ...adds, "--plugin-dir", fileURLToPath(new URL("./claude-code-mod/plugin", import.meta.url)), "--output-format", "stream-json", "--verbose"]);
    assert.equal(await realpath(result.cwd), await realpath(options.cwd));
    assert.equal(result.token, "test-login");
    assert.deepEqual(result.keys, []); assert.equal(result.stdin, "");
    assert.equal(await readFile(options.err, "utf8"), "engine stderr\n");
    assert.match(options.lines.at(-2), new RegExp(`^2026-10-06T00:00:00Z engine ${engine} forced by `));
    assert.equal(options.lines.at(-1), `2026-10-06T00:00:00Z engine ${engine} exit 0`);
  }
  options.env.CLAUDE_CODE_OAUTH_TOKEN = "existing-login";
  await rm(join(options.home, ".storytree", "secrets.json"));
  assert.equal(await runLane(options), 0);
  const result = JSON.parse(await readFile(options.log, "utf8"));
  assert.equal(result.token, "existing-login");
  assert.equal(options.env.OPENAI_API_KEY, "test-api", "the caller's environment is not mutated");
});

test("1.14 · A Claude lane loads the Claude Code mod from its plugin folder with function hooks turned on; a Codex lane is given neither", async (t) => {
  const options = await lane(t);
  // Started from a Claude Code session with the mod loaded, as a dispatcher on the Mint box may be.
  Object.assign(options.env, { CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: "1", CLAUDE_CODE_PLUGIN_DIRS: "/parent/plugin", STORYTREE_SESSION_FILE: "/parent.session" });
  const told = `console.log(JSON.stringify({args:process.argv.slice(1),hooks:process.env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS??null,plugins:process.env.CLAUDE_CODE_PLUGIN_DIRS??null,file:process.env.STORYTREE_SESSION_FILE??null}));`;
  options.commands = { codex: command(told), claude: command(told) };
  const ran = {};
  for (const engine of ["codex", "claude"]) {
    await writeFile(join(options.lanesDir, "engine-override"), engine);
    assert.equal(await runLane(options), 0);
    ran[engine] = JSON.parse(await readFile(options.log, "utf8"));
  }
  const folder = ran.claude.args[ran.claude.args.indexOf("--plugin-dir") + 1];
  assert.equal(JSON.parse(await readFile(join(folder, ".claude-plugin", "plugin.json"), "utf8")).name, "storytree", "the folder is the mod's");
  assert.equal(ran.claude.hooks, "1");
  assert.equal(ran.codex.args.includes("--plugin-dir"), false);
  assert.equal(ran.codex.hooks, null);
  assert.equal(ran.codex.plugins, null);
  assert.equal(ran.codex.file, null);
});

test("1.7 · a Codex limit stop hands over once, preserving the original brief and separate logs", async (t) => {
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

test("1.7 · a completed or externally stopped Codex turn is not handed over, even with a spent reading", async (t) => {
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

test("1.8 · a lane stopped by a signal to its runner exits 75, so its queue keeps it, and is not handed over", async (t) => {
  const options = await lane(t);
  options.env.FAST_FAIL_S = "0";
  await writeFile(join(options.lanesDir, "engine-override"), "codex");
  options.commands.codex = command("console.log('started'); setTimeout(() => {}, 60_000);");
  const running = runLane(options);
  await waitUntil(async () => (await readFile(options.log, "utf8").catch(() => "")).includes("started"), 10_000, "the engine to say it started");
  process.emit("SIGTERM", "SIGTERM");
  assert.equal(await running, 75);
  assert.match(options.lines.at(-1), /stopped by a signal: exit 75 so the runner keeps this lane queued$/);
  await assert.rejects(readFile(join(options.lanesDir, "lane.claude.log")), { code: "ENOENT" });
});

test("1.8 · the last engine's failure is 75 only before FAST_FAIL_S, defaulting to 120 seconds", async (t) => {
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

test("1.8 · the fast-failure timer restarts for Claude after a long Codex run", async (t) => {
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

test("1.9 · status shows both windows, reset, reached and credits, override and marker, and the next engine", async (t) => {
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

test("1.6 · the command front door runs a brief, refuses empty input and supports status without starting an engine", async (t) => {
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

test("1.10 · a lane whose newest reading is stale and spent runs one Codex probe for a fresh reading, then picks from it", async (t) => {
  const options = await lane(t);
  const day = join(options.home, ".codex", "sessions", "2026", "10", "06");
  await mkdir(day, { recursive: true });
  const event = (at, used) => JSON.stringify({ timestamp: new Date(at).toISOString(), payload: { rate_limits: { secondary: { used_percent: used, window_minutes: 10080, resets_at: start / 1000 + 86400 } } } });
  await writeFile(join(day, "rollout-old.jsonl"), event(start - 3 * 3_600_000, 97));
  const fresh = join(day, "rollout-fresh.jsonl"), hooks = join(options.home, "probe-hooks");
  options.env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS = "1";
  options.commands.codex = command(`const fs=require('node:fs'); if (process.argv.some(a=>a.startsWith('Reply with the single word OK.'))) { fs.writeFileSync(${JSON.stringify(fresh)}, ${JSON.stringify(event(start, 1))}); fs.writeFileSync(${JSON.stringify(hooks)}, String(process.env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS ?? null)); } else console.log('lane ran');`);
  options.commands.claude = command("process.exit(9)");
  assert.equal(await runLane(options), 0);
  assert.match(options.lines[0], /engine codex Codex weekly allowance 1% used, resets .* \(refreshed a reading 3h old\)$/);
  assert.equal((await readFile(options.log, "utf8")).trim(), "lane ran");
  await assert.doesNotReject(readFile(options.log.replace(/\.log$/, ".probe.log")));
  assert.equal(await readFile(hooks, "utf8"), "null", "the probe is a Codex run, so it is given no Claude Code function hooks either");
  options.lines.length = 0;
  await main(["status"], options);
  assert.doesNotMatch(options.lines.join("\n"), /over an hour old/, "a fresh Codex reading needs no refresh");
  await writeFile(fresh, event(start - 2 * 3_600_000, 98));
  options.lines.length = 0;
  await main(["status"], options);
  assert.match(options.lines.at(-1), /next lane: claude .*the next lane takes a fresh one first$/);
});

test("1.11 · a lane that exits 0 having left no report or push is resumed once, then its claims are released and residue written", async (t) => {
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

test("1.16 · A Claude lane is told a file beside its log to write its session id in; the runner resumes the session that file names, and searches the log only when the file is absent", async (t) => {
  const options = await lane(t);
  const runs = join(options.home, "runs");
  // A Claude engine that writes its session id where it is told, as the mod does, and names a different one in its log.
  options.commands.claude = command(`const fs=require('node:fs'); fs.appendFileSync(${JSON.stringify(runs)}, JSON.stringify({args:process.argv.slice(1),file:process.env.STORYTREE_SESSION_FILE??null})+'\\n');`
    + ` if (process.env.STORYTREE_SESSION_FILE && !process.env.NO_FILE) fs.writeFileSync(process.env.STORYTREE_SESSION_FILE, 'from-the-mod\\n');`
    + ` console.log(JSON.stringify({type:'system',subtype:'init',session_id:'from-the-log'}));`);
  await writeFile(join(options.lanesDir, "engine-override"), "claude");
  options.increment = "increment_abc";
  options.heads = async () => ({});
  options.storytree = async () => "";
  const calls = async () => (await readFile(runs, "utf8")).trim().split("\n").map((line) => JSON.parse(line));

  assert.equal(await runLane(options), 1);
  const [first, second] = await calls();
  assert.equal(first.file, join(options.lanesDir, "lane.session"), "the file is the log's, beside it");
  assert.deepEqual(second.args.slice(2, 4), ["--resume", "from-the-mod"], "the mod's own word wins over the log");

  await rm(runs);
  await rm(join(options.lanesDir, "lane.session"));
  options.env.NO_FILE = "1";
  assert.equal(await runLane(options), 1);
  assert.deepEqual((await calls())[1].args.slice(2, 4), ["--resume", "from-the-log"], "without the file, the log's first session id");

  await rm(runs);
  await writeFile(join(options.lanesDir, "engine-override"), "codex");
  options.commands.codex = command(`require('node:fs').appendFileSync(${JSON.stringify(runs)}, JSON.stringify({file:process.env.STORYTREE_SESSION_FILE??null})+'\\n');`);
  await runLane(options);
  assert.equal((await calls())[0].file, null, "a Codex lane is told no file");
});

test("1.12 · each engine runs the model the pool's configuration names, and its own default when it names none", async (t) => {
  const options = await lane(t);
  const config = join(options.home, "agent-pool.json");
  options.env.AGENT_POOL_CONFIG = config;
  for (const [engines, models] of [[{ codex: { model: "codex-x" }, claude: { model: "claude-y" } }, { codex: ["--model", "codex-x"], claude: ["--model", "claude-y"] }],
    [{}, { codex: [], claude: [] }]]) {
    await writeFile(config, JSON.stringify({ lanes: options.lanesDir, engines }));
    for (const engine of ["codex", "claude"]) {
      await writeFile(join(options.lanesDir, "engine-override"), engine);
      assert.equal(await runLane(options), 0);
      const { args } = JSON.parse(await readFile(options.log, "utf8"));
      const at = args.indexOf("--model");
      assert.deepEqual(at < 0 ? [] : args.slice(at, at + 2), models[engine], `${engine}: ${args.join(" ")}`);
    }
  }
});

test("1.17 · a lane that ends by its engine's own exit with no report or push is recorded failed; at the third, residue names each failure; a report, a push, a signal, a fast failure or a refused claim is no failure", async (t) => {
  const options = await lane(t);
  const session = "5b0c3c1e-0000-4000-8000-00000000abcd";
  options.commands.claude = command(`console.log(JSON.stringify({type:'system',subtype:'init',session_id:${JSON.stringify(session)}})); process.exitCode=Number(process.env.EXIT ?? 0);`);
  await writeFile(join(options.lanesDir, "engine-override"), "claude");
  options.increment = "increment_abc";
  let heads = {};
  options.heads = async () => heads;
  const told = [];
  options.storytree = async (args) => { told.push(args); return args[0] === "library" ? "The breakdown." : ""; };
  const recorded = [];
  let earlier = [];
  options.failed = async (failure) => { recorded.push(failure); return [...earlier, { ...failure, at: "2026-10-06T00:00:00.000Z" }]; };
  let clock = start;
  options.now = () => clock;
  options.say = (line) => { if (line.includes(" exit ")) clock += 600_000; };

  assert.equal(await runLane(options), 1);
  assert.equal(recorded.length, 1, "left nothing twice: recorded failed");
  assert.equal(recorded[0].increment, "increment_abc");
  assert.equal(recorded[0].lane, session);
  assert.equal(recorded[0].started, new Date(start).toISOString());
  assert.match(recorded[0].why, /exit 0.*no report.*no push.*twice/);
  assert.deepEqual(recorded[0].logs, [options.log, join(options.lanesDir, "lane.resume.log")]);
  assert.ok(!told.some((args) => args[0] === "arc" && /offers it no more/.test(args[5])), "one failure writes only the runner's own residue");

  recorded.length = 0; told.length = 0;
  options.env.EXIT = "3";
  assert.equal(await runLane(options), 3, "a slow non-zero exit keeps its code");
  assert.equal(recorded.length, 1, "and leaving nothing, is recorded failed");
  assert.match(recorded[0].why, /exit 3.*no report.*no push/);

  recorded.length = 0; told.length = 0;
  earlier = [{ at: "2026-10-04T00:00:00.000Z", why: "exit 0 with no report and no push, twice", logs: ["/lanes/one.log"] },
    { at: "2026-10-05T00:00:00.000Z", why: "exit 2 with no report and no push", logs: ["/lanes/two.log"] }];
  assert.equal(await runLane(options), 3);
  const edit = told.find((args) => args[0] === "arc" && args[2] === "edit");
  assert.ok(edit, "the third failure writes residue on the increment");
  assert.match(edit[5], /^The breakdown\.\n\nResidue \(lane runner, \d{4}-\d\d-\d\d\): this increment's pool lanes failed 3 times, so the pool offers it no more/);
  assert.match(edit[5], /reoffer increment_\w+ --reason "what was fixed" \(2\.28\)\. Each failure: 1\. 2026-10-04T00:00:00.000Z: exit 0 with no report and no push, twice \(\/lanes\/one\.log\); 2\. /);
  assert.match(edit[5], /2026-10-05T00:00:00.000Z: exit 2/);
  assert.match(edit[5], /exit 3/);
  earlier = [];

  for (const [what, set] of [["a report", () => { options.commands.claude = command(`require('node:fs').writeFileSync(${JSON.stringify(join(options.lanesDir, "pool-increment_abc.report.md"))}, 'r'); process.exitCode=3;`); }],
    ["a push", () => { options.commands.claude = command("process.exitCode=3;"); let n = 0; options.heads = async () => (n++ ? { "claude/increment-abc-x": "9" } : {}); }],
    // Windows ends a process that signals itself with exit 1 and no signal, so the signal case runs where signals exist.
    ...(process.platform === "win32" ? [] : [["a signal", () => { options.commands.claude = command("process.kill(process.pid, 'SIGTERM');"); options.heads = async () => ({}); }]]),
    ["a fast failure", () => { options.commands.claude = command("process.exitCode=3;"); options.heads = async () => ({}); options.say = () => {}; }]]) {
    recorded.length = 0;
    set();
    await runLane(options);
    assert.equal(recorded.length, 0, `${what} is no failure`);
  }

  options.commands.claude = command("process.exitCode=3;");
  options.say = (line) => { if (line.includes(" exit ")) clock += 600_000; };
  options.failed = async (failure) => (recorded.push(failure), null);
  told.length = 0;
  assert.equal(await runLane(options), 3, "a lane refused a claim (the recorder writes nothing) keeps its code");
  assert.ok(!told.some((args) => args[0] === "arc"), "and leaves no residue");
});

test("1.18 · A lane with no lane token of its own does not start: no engine runs and it stays queued; an engine that starts is told to load no claude.ai tool servers", async (t) => {
  const options = await lane(t);
  const told = `console.log(JSON.stringify({token:process.env.CLAUDE_CODE_OAUTH_TOKEN,connectors:process.env.ENABLE_CLAUDEAI_MCP_SERVERS??null}));`;
  options.commands = { codex: command(told), claude: command(told) };
  for (const engine of ["codex", "claude"]) {
    await writeFile(join(options.lanesDir, "engine-override"), engine);
    assert.equal(await runLane(options), 0);
    assert.deepEqual(JSON.parse(await readFile(options.log, "utf8")), { token: "test-login", connectors: "false" }, engine);
  }
  options.storytree = async () => "";
  for (const secrets of [{}, { CLAUDE_CODE_OAUTH_TOKEN: "" }, { CLAUDE_CODE_OAUTH_TOKEN: "  " }]) {
    await writeFile(join(options.home, ".storytree", "secrets.json"), JSON.stringify(secrets));
    await rm(options.log, { force: true });
    await assert.rejects(runLane(options), /lane token/);
    assert.equal(await main(["run", options.brief, options.log, options.err], options), 75, JSON.stringify(secrets));
    await assert.rejects(readFile(options.log, "utf8"), { code: "ENOENT" }, "no engine ran");
  }
});

test("1.19 · A lane refused for want of its token asks the owner once, on its increment's arc, to mint a new one; it asks again only once that question is settled", async (t) => {
  const options = await lane(t);
  await writeFile(join(options.home, ".storytree", "secrets.json"), "{}");
  const told = [];
  let settled = false;
  options.increment = "increment_abc";
  options.storytree = async (args) => {
    told.push(args);
    if (args[0] === "library") return "arc_lanes\n";
    if (args[0] === "question" && args[1] === "new") return `Raised question_${told.length} on arc_lanes.\n`;
    if (args[0] === "question" && args[1] === "show") return `${args[2]}  Lanes need a new lane token\n  question, ${settled ? "settled" : "open"}\n`;
    return "";
  };
  const asked = () => told.filter((args) => args[0] === "question" && args[1] === "new");
  for (let n = 0; n < 3; n++) assert.equal(await main(["run", options.brief, options.log, options.err], options), 75);
  assert.equal(asked().length, 1, "asked once, not once per retry");
  const question = asked()[0];
  assert.equal(question[question.indexOf("--arc") + 1], "arc_lanes");
  assert.match(question[question.indexOf("--title") + 1], /lane token/);
  assert.ok(!question.includes("--hold"), "no work is held on it");
  settled = true;
  assert.equal(await main(["run", options.brief, options.log, options.err], options), 75);
  assert.equal(asked().length, 2, "a settled question with the token still missing is asked again");
  settled = false;
  assert.equal(await main(["run", options.brief, options.log, options.err], options), 75);
  assert.equal(asked().length, 2);
});
