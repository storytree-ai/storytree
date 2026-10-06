// node packages/dev-loop/src/lanes/runner.mjs run <brief-file> <log> <err> [add-dir ...]
// node packages/dev-loop/src/lanes/runner.mjs status
import { spawn } from "node:child_process";
import { constants, homedir } from "node:os";
import { open, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assessAllowance, detectLimitHit, engineControls, iso, laneSettings, pickEngine, readLatestAllowance, readOptional } from "./engine.mjs";

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

function argumentsFor(engine, brief, addDirs) {
  const adds = addDirs.flatMap((directory) => ["--add-dir", directory]);
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

export async function runLane({ brief, log, err, addDirs = [], cwd = process.cwd(), home = homedir(), env = process.env,
  commands = { codex: ["codex"], claude: ["claude"] }, now = Date.now, say = console.log }) {
  const original = await readFile(brief, "utf8");
  if (!original.trim()) throw new Error(`brief ${brief} is empty`);
  const settings = laneSettings({ home, env });
  const login = await loginEnvironment(home, env);
  const dated = (message) => say(`${new Date(now()).toISOString().replace(/\.\d{3}Z$/, "Z")} ${message}`);
  const reading = await readLatestAllowance(settings.sessionsDir);
  const picked = await pickEngine({ ...settings, reading, now: now() / 1000 });
  dated(`engine ${picked.engine} ${picked.reason}`);
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
    started = now();
    result = await runEngine(commands.claude, argumentsFor("claude", handover, addDirs), {
      cwd, env: login, log: `${base}.claude.log`, err: `${base}.claude.err`,
    });
    dated(`engine claude exit ${result.code}`);
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
  say(`next lane: ${picked.engine} (${picked.reason}); switch at ${settings.stopAt}%`);
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
  } catch (error) { complain(`lane runner: ${error.message}`); return 2; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
