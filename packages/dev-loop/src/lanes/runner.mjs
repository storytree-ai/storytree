// Capability 10 · A Mint lane runs on the engine its allowance allows. node packages/dev-loop/src/lanes/runner.mjs run <brief-file> <log> <err> [add-dir ...]
// node packages/dev-loop/src/lanes/runner.mjs status
import { execFile, spawn } from "node:child_process";
import { constants, homedir } from "node:os";
import { open, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { assessAllowance, detectLimitHit, engineControls, iso, laneSettings, pickEngine, pickFresh, readLatestAllowance, readOptional } from "./engine.mjs";

async function loginEnvironment(home, env) {
  const login = { ...env };
  const names = ["CLAUDE_CODE_OAUTH_TOKEN", "STORYTREE_DB_USER"];
  if (names.some((name) => !login[name])) {
    const source = await readOptional(join(home, ".storytree", "secrets.json"));
    let secrets;
    try { secrets = source ? JSON.parse(source) : {}; }
    catch { throw new Error("Could not read lane login settings from secrets.json"); }
    for (const name of names) if (!login[name]) login[name] = secrets[name] ?? "";
  }
  for (const name of ["OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN", "ANTHROPIC_API_KEY"]) delete login[name];
  return login;
}

const run = promisify(execFile);

function argumentsFor(engine, brief, addDirs, resume) {
  const adds = addDirs.flatMap((directory) => ["--add-dir", directory]);
  if (resume) return engine === "codex"
    ? ["exec", "resume", resume, brief, "--model", "gpt-6-astra", "--dangerously-bypass-approvals-and-sandbox", "--dangerously-bypass-hook-trust", "--json"]
    : ["-p", brief, "--resume", resume, "--model", "claude-opus-5-5", "--permission-mode", "bypassPermissions", ...adds, "--output-format", "stream-json", "--verbose"];
  return engine === "codex"
    ? ["exec", brief, "--model", "gpt-6-astra", "--sandbox", "danger-full-access", "--dangerously-bypass-hook-trust", ...adds, "--json"]
    : ["-p", brief, "--model", "claude-opus-5-5", "--permission-mode", "bypassPermissions", ...adds, "--output-format", "stream-json", "--verbose"];
}

/** Await the child and its output files; no shell, background launch or real engine in tests. */
async function runEngine(command, args, { cwd, env, log, err }) {
  const output = await open(log, "w");
  let errors;
  try {
    errors = await open(err, "w");
    return await new Promise((done) => {
      const child = spawn(command[0], [...command.slice(1), ...args], { cwd, env, stdio: ["ignore", output.fd, errors.fd] });
      let interrupted = false;
      const forward = (signal) => { interrupted = true; child.kill(signal); };
      const interrupt = () => forward("SIGINT"), terminate = () => forward("SIGTERM");
      process.on("SIGINT", interrupt); process.on("SIGTERM", terminate);
      let failure;
      child.on("error", (error) => { failure = error; });
      child.on("close", async (code, signal) => {
        process.off("SIGINT", interrupt); process.off("SIGTERM", terminate);
        if (failure) await errors.write(`${failure.message}\n`);
        done({ code: failure ? 127 : code ?? 128 + (constants.signals[signal] ?? 1), interrupted });
      });
    });
  } finally { await output.close(); await errors?.close(); }
}

const PROBE = "Reply with the single word OK. Do not run any command or read any file.";

/** One tiny Codex turn, so Codex writes a fresh allowance reading into its session files. */
async function probeCodex(command, { cwd, env, log, timeoutMs = 180_000 }) {
  const output = await open(log, "w");
  try {
    await new Promise((done, fail) => {
      const child = spawn(command[0], [...command.slice(1), ...argumentsFor("codex", PROBE, [])], { cwd, env, stdio: ["ignore", output.fd, output.fd] });
      const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
      child.on("error", (error) => { clearTimeout(timer); fail(error); });
      child.on("close", () => { clearTimeout(timer); done(); });
    });
  } finally { await output.close(); }
}

function handoverBrief(log, original) {
  return `# Handover: Codex's weekly allowance ran out mid-lane

A Codex lane on this box started the brief below and stopped when Codex's weekly allowance ran out (its log: ${log}).
You are Claude Code, carrying the same lane on (owner, 2026-10-06: Mint lanes switch to Claude when Codex's allowance is used up).
Before anything else, find what it left: its worktree and branch for this increment (\`git worktree list\` in ~/code/storytree03),
commits and any pull request on that branch (\`gh pr list --head <branch> --state all\`), and the last lines of its log.
Carry on from that work rather than starting again. If a claim is refused as held by that Codex session, it has stopped:
a claim whose holder has gone idle is taken over by claiming it again, so retry once it reads idle; never build without the claim.

${original}`;
}

const CONTINUE = "You ended your turn while your work was unfinished: continue. You left no report and pushed no branch for your increment."
  + " Pick up where you stopped, carry the brief you were given through to its end (a handed-over pull request and your report, or residue and a report), and never end a turn to wait for something you started.";

/** The remote branches named for an increment (`…increment-<hex>-…`), by name, with their commits. */
async function remoteHeads(increment, cwd) {
  const { stdout } = await run("git", ["ls-remote", "--heads", "origin"], { cwd, maxBuffer: 64 * 1024 * 1024 });
  const mark = `increment-${increment.replace(/^increment_/, "")}`;
  const heads = {};
  for (const line of stdout.split("\n")) {
    const [sha, ref] = line.split("\t");
    if (ref?.includes(mark)) heads[ref.replace(/^refs\/heads\//, "")] = sha;
  }
  return heads;
}

/** What a lane's increment has before and after a run: its report's mtime and the remote branches named for it (null when unreadable). */
async function traces({ increment, lanesDir, heads }) {
  const report = await stat(join(lanesDir, `pool-${increment}.report.md`)).then((found) => found.mtimeMs, () => null);
  return { report, heads: await heads(increment).catch(() => null) };
}

/** Whether the run between two readings left anything: a report written, or a branch pushed or moved. An unreadable remote counts as left. */
function leftSomething(before, after) {
  if (after.report !== null && after.report !== before.report) return true;
  if (!before.heads || !after.heads) return true;
  return Object.entries(after.heads).some(([name, sha]) => before.heads[name] !== sha);
}

/** The engine's session id, from its log's first event that names one (Claude's session_id, Codex's thread_id). */
async function sessionOf(log) {
  return /"(?:session_id|thread_id)":"([^"]+)"/.exec(await readOptional(log) ?? "")?.[1];
}

/** The lane left nothing twice: release what its session holds, and write residue on its increment for the next lane. */
async function leaveResidue({ increment, session, logs, storytree, day, dated }) {
  const tell = (args) => storytree(args).catch((error) => { dated(`storytree ${args.slice(0, 3).join(" ")} refused: ${String(error.message).split("\n")[0]}`); return ""; });
  let released = [];
  if (session) {
    for (const line of (await tell(["noticeboard"])).split("\n")) {
      const held = /^\s*- (?:increment|capability) (\S+)\s/.exec(line);
      if (held && line.includes(` ${session} `)) {
        await tell(["workspace", "release", held[1], "--holder", session, "--reason", "the lane ended twice having left nothing; released by the lane runner"]);
        released.push(held[1]);
      }
    }
  }
  const body = (await tell(["library", "read", increment, "--field", "body"])).trimEnd();
  const residue = `Residue (lane runner, ${day}): a pool lane's engine exited 0 having left no report and pushed no branch for this increment, twice (started, then resumed once).`
    + ` ${session ? `Released its session ${session}'s claims${released.length ? ` (${released.join(", ")})` : " (none held)"}.` : "Its session id was not in its log, so no claim was released."}`
    + ` Logs: ${logs.join(", ")}. Read the logs and any worktree it left before starting again.`;
  await tell(["arc", "increment", "edit", increment, "--body", body ? `${body}\n\n${residue}` : residue]);
  dated(`residue written on ${increment}${released.length ? `; released ${released.join(", ")}` : ""}`);
}

export async function runLane({ brief, log, err, addDirs = [], cwd = process.cwd(), home = homedir(), env = process.env,
  commands = { codex: ["codex"], claude: ["claude"] }, now = Date.now, say = console.log, increment,
  heads = (id) => remoteHeads(id, cwd),
  storytree = async (args) => (await run("pnpm", ["-s", "storytree", ...args], { cwd, env, maxBuffer: 16 * 1024 * 1024 })).stdout }) {
  const original = await readFile(brief, "utf8");
  if (!original.trim()) throw new Error(`brief ${brief} is empty`);
  const settings = laneSettings({ home, env });
  const login = await loginEnvironment(home, env);
  const dated = (message) => say(`${new Date(now()).toISOString().replace(/\.\d{3}Z$/, "Z")} ${message}`);
  const refresh = () => probeCodex(commands.codex, { cwd, env: login, log: `${log.replace(/\.log$/, "")}.probe.log` });
  const picked = await pickFresh({ ...settings, now: now() / 1000, refresh });
  dated(`engine ${picked.engine} ${picked.reason}`);
  const before = increment ? await traces({ increment, lanesDir: settings.lanesDir, heads }) : null;
  let last = { engine: picked.engine, log, err };
  let started = now();
  let result = await runEngine(commands[picked.engine], argumentsFor(picked.engine, original, addDirs), { cwd, env: login, log, err });
  dated(`engine ${picked.engine} exit ${result.code}`);
  // Read again: the just-finished Codex run can have spent the allowance since we picked it.
  if (picked.engine === "codex" && !result.interrupted && await detectLimitHit({ ...settings, log, err,
    reading: await readLatestAllowance(settings.sessionsDir), now: now() / 1000 })) {
    const base = log.replace(/\.log$/, "");
    const handover = handoverBrief(log, original);
    await writeFile(`${base}.claude-brief.md`, handover);
    dated(`engine claude (Codex stopped on its usage limit; handing over, log ${base}.claude.log)`);
    last = { engine: "claude", log: `${base}.claude.log`, err: `${base}.claude.err` };
    started = now();
    result = await runEngine(commands.claude, argumentsFor("claude", handover, addDirs), { cwd, env: login, log: last.log, err: last.err });
    dated(`engine claude exit ${result.code}`);
  }
  if (result.interrupted) {
    dated(`lane runner stopped by a signal: exit 75 so the runner keeps this lane queued`);
    return 75;
  }
  // An engine that exits 0 having left nothing ended its turn mid-work: resume its session once, then leave residue.
  if (before && result.code === 0 && !leftSomething(before, await traces({ increment, lanesDir: settings.lanesDir, heads }))) {
    const session = await sessionOf(last.log);
    const base = last.log.replace(/\.log$/, "");
    const resumed = { log: `${base}.resume.log`, err: `${base}.resume.err` };
    dated(`engine ${last.engine} exit 0 having left no report or push for ${increment}: ${session ? `resuming session ${session}` : "restarting"} once, log ${resumed.log}`);
    result = await runEngine(commands[last.engine], argumentsFor(last.engine, session ? CONTINUE : `${CONTINUE}\n\n${original}`, addDirs, session), { cwd, env: login, ...resumed });
    dated(`engine ${last.engine} exit ${result.code}`);
    if (result.interrupted) {
      dated(`lane runner stopped by a signal: exit 75 so the runner keeps this lane queued`);
      return 75;
    }
    if (!leftSomething(before, await traces({ increment, lanesDir: settings.lanesDir, heads }))) {
      await leaveResidue({ increment, session, logs: [last.log, resumed.log], storytree, day: new Date(now()).toISOString().slice(0, 10), dated });
      return 1;
    }
    return result.code;
  }
  const fastFail = Number(env.FAST_FAIL_S ?? 120);
  if (result.code !== 0 && (now() - started) / 1000 < fastFail) {
    dated(`engine failed within ${fastFail}s: exit 75 so the runner keeps this lane queued`);
    return 75;
  }
  return result.code;
}

async function showStatus({ home, env, now = Date.now, say = console.log }) {
  const settings = laneSettings({ home, env });
  const seconds = now() / 1000;
  const { override, until } = await engineControls(settings.lanesDir, seconds);
  say(`override: ${override || "none (automatic)"}`);
  say(`exhausted marker: ${until === null ? "none" : `until ${iso(until)}`}`);
  const reading = await readLatestAllowance(settings.sessionsDir);
  if (reading === null) say("latest reading: none");
  else {
    const live = assessAllowance(reading, seconds);
    const windows = ["primary", "secondary"].map((name) => {
      const window = reading[name];
      return `${name} ${window?.used_percent ?? "?"}% (window ${window?.window_minutes ?? "?"} min, resets ${Number.isFinite(window?.resets_at) ? iso(window.resets_at) : "?"})`;
    }).join("; ");
    say(`latest reading: ${reading.at} ${windows}; live used ${live.used} resets ${live.resets === null ? "?" : iso(live.resets)} reached ${live.reached} (${reading.rate_limit_reached_type ?? "none"}) credits ${JSON.stringify(reading.credits ?? null)}`);
  }
  const picked = await pickEngine({ ...settings, reading, now: seconds });
  const stale = picked.basis === "reading" && picked.engine === "claude" && !reading.rate_limit_reached_type && seconds - Date.parse(reading.at) / 1000 > 3600;
  say(`next lane: ${picked.engine} (${picked.reason}); switch at ${settings.stopAt}%${stale ? "; the reading is over an hour old, so the next lane takes a fresh one first" : ""}`);
}

export async function main(args, options = {}) {
  const complain = options.say ?? console.error;
  try {
    if (args[0] === "status" || args.length === 0) { await showStatus(options); return 0; }
    if (args[0] !== "run" || args.length < 4) {
      complain("usage: runner.mjs run <brief-file> <log> <err> [add-dir ...] | status");
      return 2;
    }
    return await runLane({ ...options, brief: args[1], log: args[2], err: args[3], addDirs: args.slice(4) });
  } catch (error) {
    // A lane that could not start (an empty brief, unreadable login settings) stays queued: 75 stops its runner.
    complain(`lane runner: ${error.message}; exit 75 so the runner keeps this lane queued`);
    return 75;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
