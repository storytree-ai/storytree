// Capability 1 · A Mint lane runs on the engine its allowance allows. node packages/agent-pool/src/runner.mjs run <brief-file> <log> <err> [add-dir ...]
// node packages/agent-pool/src/runner.mjs status
import { execFile, spawn } from "node:child_process";
import { constants, homedir } from "node:os";
import { appendFile, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { FUNCTION_HOOKS, PLUGIN_FOLDER, SESSION_FILE } from "./claude-code-mod/index.mjs";

import { LANE_FAILURES, recordLaneFailure } from "./feed.mjs";
import { assessAllowance, detectLimitHit, engineControls, iso, laneSettings, pickEngine, pickFresh, readLatestAllowance, readOptional } from "./engine.mjs";

async function loginEnvironment(home, env) {
  const login = { ...env };
  const names = ["CLAUDE_CODE_OAUTH_TOKEN"];
  if (names.some((name) => !login[name])) {
    const source = await readOptional(join(home, ".storytree", "secrets.json"));
    let secrets;
    try { secrets = source ? JSON.parse(source) : {}; }
    catch { throw new Error("Could not read lane login settings from secrets.json"); }
    for (const name of names) if (!login[name]) login[name] = secrets[name] ?? "";
  }
  for (const name of ["OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN", "ANTHROPIC_API_KEY"]) delete login[name];
  // A lane runs only on the lane token, never the box's stored claude.ai login, and loads no claude.ai tool servers;
  // both engines carry that, so a claude nested in a Codex lane does too (ADR-1175 D1).
  if (!login.CLAUDE_CODE_OAUTH_TOKEN.trim()) throw Object.assign(new Error("no lane token (CLAUDE_CODE_OAUTH_TOKEN, in the environment or ~/.storytree/secrets.json): the lane does not start"), { code: "lane-token" });
  login.ENABLE_CLAUDEAI_MCP_SERVERS = "false";
  return login;
}

/** The file in the lanes folder naming the question that asks the owner for a new lane token, empty while one runner asks it. */
const TOKEN_QUESTION = "lane-token.question";
/** Where the question goes for a run with no increment (a watcher's fix session): the arc that built the rule. */
const TOKEN_ARC = "arc_cae8dffd9fe7";

/**
 * A lane refused for want of its token asks the owner to mint a new one (ADR-1175 D2): once, on its increment's arc,
 * while that question stands open, however often the pool retries; once it is settled, a token still missing asks again.
 */
async function askForToken({ lanesDir, increment, storytree, dated }) {
  const file = join(lanesDir, TOKEN_QUESTION);
  const asked = await readFile(file, "utf8").catch(() => null);
  if (asked !== null) {
    const id = asked.trim();
    // Another runner is asking; an empty file left by one that died while asking is set aside after ten minutes.
    if (!id && await stat(file).then((found) => Date.now() - found.mtimeMs < 10 * 60_000, () => true)) return;
    const open = id && await storytree(["question", "show", id]).then((text) => !/, (settled|retired)\b/.test(text.split("\n")[1] ?? ""), () => true);
    if (open) { dated(`no lane token: the owner was asked in ${id}`); return; }
    await rm(file, { force: true });
  }
  try { await writeFile(file, "", { flag: "wx" }); } catch { return; }
  try {
    const arc = increment ? (await storytree(["library", "read", increment, "--field", "arc"])).trim() : "";
    const raised = await storytree(["question", "new", "--arc", arc || TOKEN_ARC, "--title", "Mint a new lane token for the Mint box",
      "--stakes", "No pool lane, fix session or release fix on the Mint box starts until it has its own lane token: lanes run only on that token, never on the box's claude.ai login (ADR-1175).",
      "--statement", "The lane runner found no lane token (CLAUDE_CODE_OAUTH_TOKEN, in its environment or ~/.storytree/secrets.json), or an empty one, so it started no lane. Will you mint a new one and put it there?",
      "--context", `Lanes stay queued and start again on their own once the token is in place. The runner asks this once, while this question stands open, however often it retries.${increment ? ` First refused: ${increment}.` : ""}`,
      "--options", "A. Mint a new token with `claude setup-token` on the box and save it as CLAUDE_CODE_OAUTH_TOKEN in ~/.storytree/secrets.json, then settle this question. B. Leave the pool stopped for now: write pool-stop in the lanes folder."]);
    const id = /question_\w+/.exec(raised)?.[0];
    if (!id) throw new Error("no question id in its answer");
    await writeFile(file, id);
    dated(`no lane token: asked the owner to mint one in ${id}`);
  } catch (error) {
    await rm(file, { force: true });
    dated(`no lane token, and asking the owner for one failed: ${String(error.message).split("\n")[0]}`);
  }
}

const run = promisify(execFile);

/**
 * A Claude lane loads storytree's Claude Code mod from the checkout (ADR-1056 D3), its hooks module switched on while that is early access,
 * and is told the file beside its log where the mod writes the session's id at start. A Codex lane is given none of the mod's
 * variables, even when the runner itself was started from a Claude Code session that carries them.
 */
const MOD = ["--plugin-dir", PLUGIN_FOLDER];
const MOD_VARIABLES = [...Object.keys(FUNCTION_HOOKS), "CLAUDE_CODE_PLUGIN_DIRS", SESSION_FILE];
const sessionFile = (log) => `${log.replace(/\.log$/, "")}.session`;
function engineEnvironment(engine, login, log) {
  if (engine === "claude") return { ...login, ...FUNCTION_HOOKS, [SESSION_FILE]: sessionFile(log) };
  const codex = { ...login };
  for (const name of MOD_VARIABLES) delete codex[name];
  return codex;
}

function argumentsFor(engine, brief, addDirs, resume, model) {
  const adds = [...addDirs.flatMap((directory) => ["--add-dir", directory]), ...(engine === "claude" ? MOD : [])];
  const models = model ? ["--model", model] : [];
  if (resume) return engine === "codex"
    ? ["exec", "resume", resume, brief, ...models, "--dangerously-bypass-approvals-and-sandbox", "--dangerously-bypass-hook-trust", "--json"]
    : ["-p", brief, "--resume", resume, ...models, "--permission-mode", "bypassPermissions", ...adds, "--output-format", "stream-json", "--verbose"];
  return engine === "codex"
    ? ["exec", brief, ...models, "--sandbox", "danger-full-access", "--dangerously-bypass-hook-trust", ...adds, "--json"]
    : ["-p", brief, ...models, "--permission-mode", "bypassPermissions", ...adds, "--output-format", "stream-json", "--verbose"];
}

/**
 * Await the child and its output files; no shell, background launch or real engine in tests. Given a watch, an engine whose log
 * has not grown for quietMs while `online` says the library and GitHub do not answer is stopped as stalled (1.20).
 */
async function runEngine(command, args, { cwd, env, log, err, watch }) {
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
      let failure, stalled = false, timer;
      if (watch) {
        let size = -1, quietSince = performance.now(), checking = false;
        timer = setInterval(async () => {
          if (checking || stalled) return;
          checking = true;
          try {
            const grown = await stat(log).then((found) => found.size, () => 0);
            if (grown !== size) { size = grown; quietSince = performance.now(); return; }
            if (performance.now() - quietSince < watch.quietMs) return;
            if (await watch.online()) { quietSince = performance.now(); return; }
            stalled = true;
            child.kill("SIGTERM");
            setTimeout(() => child.kill("SIGKILL"), 30_000).unref();
          } finally { checking = false; }
        }, watch.everyMs);
      }
      child.on("error", (error) => { failure = error; });
      child.on("close", async (code, signal) => {
        clearInterval(timer);
        process.off("SIGINT", interrupt); process.off("SIGTERM", terminate);
        if (failure) await errors.write(`${failure.message}\n`);
        done({ code: failure ? 127 : code ?? 128 + (constants.signals[signal] ?? 1), interrupted, signaled: signal !== null, stalled });
      });
    });
  } finally { await output.close(); await errors?.close(); }
}

const PROBE = "Reply with the single word OK. Do not run any command or read any file.";

/** One tiny Codex turn, so Codex writes a fresh allowance reading into its session files. */
async function probeCodex(command, { cwd, env, log, model, timeoutMs = 180_000 }) {
  const output = await open(log, "w");
  try {
    await new Promise((done, fail) => {
      const child = spawn(command[0], [...command.slice(1), ...argumentsFor("codex", PROBE, [], undefined, model)], { cwd, env, stdio: ["ignore", output.fd, output.fd] });
      const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
      child.on("error", (error) => { clearTimeout(timer); fail(error); });
      child.on("close", () => { clearTimeout(timer); done(); });
    });
  } finally { await output.close(); }
}

/** How a lane carrying another's work on finds what that one left, and takes over its claims. */
const CARRY_ON = `Before anything else, find what it left: its worktree and branch for this increment (\`git worktree list\` in ~/code/storytree03),
commits and any pull request on that branch whose head is on this repository (\`gh pr list --head <branch> --state all --json number,state,isCrossRepository\`,
keeping only those with isCrossRepository false: a fork's pull request on a branch of the same name is never this lane's), and the last lines of its log.
Carry on from that work rather than starting again. If a claim is refused as held by that session, it has stopped:
a claim whose holder has gone idle is taken over by claiming it again, so retry once it reads idle; never build without the claim.`;

function handoverBrief(log, original) {
  return `# Handover: Codex's weekly allowance ran out mid-lane

A Codex lane on this box started the brief below and stopped when Codex's weekly allowance ran out (its log: ${log}).
You are Claude Code, carrying the same lane on (owner, 2026-10-06: Mint lanes switch to Claude when Codex's allowance is used up).
${CARRY_ON}

${original}`;
}

function reconnectBrief(logs, original) {
  return `# Handover: a lane lost its connection and its session could not be resumed

A lane on this machine started the brief below and lost its network connection; once the library and GitHub answered again,
its own session was resumed and ended with the work unfinished (its logs: ${logs.join(", ")}).
You are a fresh lane carrying the same work on (decision_5b03e773d46b D4).
${CARRY_ON}

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

/** The engine's session id: as the mod wrote it beside the log, or else from the log's first event that names one (Claude's session_id, Codex's thread_id). */
async function sessionOf(log) {
  return (await readOptional(sessionFile(log)))?.trim() || /"(?:session_id|thread_id)":"([^"]+)"/.exec(await readOptional(log) ?? "")?.[1];
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

/**
 * A lane that failed (1.17): recorded by `failed`, which gives back the increment's failures so far, or null for a lane refused a claim,
 * which is no failure. At the LANE_FAILURES-th, residue on the increment names each, since the pool offers it no more (2.27).
 */
async function laneFailed({ increment, why, logs, lane, started, failed, storytree, day, dated }) {
  const failures = await Promise.resolve().then(() => failed({ increment, why, logs, ...(lane ? { lane } : {}), started }))
    .catch((error) => { dated(`failed lane on ${increment} not recorded: ${String(error.message).split("\n")[0]}`); return null; });
  if (!failures) return;
  dated(`lane on ${increment} failed (${why}): ${failures.length} of ${LANE_FAILURES}`);
  if (failures.length !== LANE_FAILURES) return;
  const tell = (args) => storytree(args).catch((error) => { dated(`storytree ${args.slice(0, 3).join(" ")} refused: ${String(error.message).split("\n")[0]}`); return ""; });
  const body = (await tell(["library", "read", increment, "--field", "body"])).trimEnd();
  const residue = `Residue (lane runner, ${day}): this increment's pool lanes failed ${failures.length} times, so the pool offers it no more (Agent runner 2.27) until a session that fixed the cause offers it again: node packages/agent-pool/src/feed.mjs reoffer ${increment} --reason "what was fixed" (2.28).`
    + ` Each failure: ${failures.map((one, n) => `${n + 1}. ${one.at}: ${one.why}${one.logs?.length ? ` (${one.logs.join(", ")})` : ""}`).join("; ")}.`
    + " Read those logs and any worktree they left before starting again.";
  await tell(["arc", "increment", "edit", increment, "--body", body ? `${body}\n\n${residue}` : residue]);
  dated(`residue written on ${increment}: the pool offers it no more`);
}

/** Claude's and Codex's own words for requests that never reached their server (read from each engine's build, 2026-10-27). */
const CUT_OFF = /^API Error: (?:Unable to connect to API|Connection dropped|Connection refused|Can't reach the API server|No internet route|Request timed out)|stream disconnected before completion|error sending request for url/;

/** Whether a failing engine was cut off by a lost connection: its log's last error event, or its err, says so in its own words. */
async function lostConnection({ log, err }) {
  const said = [];
  for (const line of (await readOptional(log)).trimEnd().split("\n").slice(-20)) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type === "result" && event.is_error) said.push(String(event.result ?? ""));
    if (event.type === "error") said.push(String(event.message ?? ""));
    if (event.type === "turn.failed") said.push(String(event.error?.message ?? ""));
  }
  said.push(...(await readOptional(err)).trimEnd().split("\n").slice(-5));
  return said.some((text) => CUT_OFF.test(text.trim()));
}

/** Whether both the library and GitHub answer: a library read and a GitHub API call, each within a minute. */
async function bothAnswer({ increment, cwd, env }) {
  const answers = (file, args) => run(file, args, { cwd, env, timeout: 60_000, maxBuffer: 16 * 1024 * 1024 }).then(() => true, () => false);
  const [library, github] = await Promise.all([answers("pnpm", ["-s", "storytree", "library", "read", increment ?? TOKEN_ARC, "--field", "title"]), answers("gh", ["api", "rate_limit"])]);
  return library && github;
}

/** How long a lane is held for the network, how often it looks, and how long a quiet log means a stall while offline. */
const OFFLINE = { ceilingMs: 12 * 3_600_000, pollMs: 60_000, quietMs: 15 * 60_000, everyMs: 60_000 };

/** Append residue to an increment's body; a refusal is said, never thrown. */
async function appendResidue({ increment, residue, storytree, dated }) {
  const tell = (args) => storytree(args).catch((error) => { dated(`storytree ${args.slice(0, 3).join(" ")} refused: ${String(error.message).split("\n")[0]}`); return ""; });
  const body = (await tell(["library", "read", increment, "--field", "body"])).trimEnd();
  await tell(["arc", "increment", "edit", increment, "--body", body ? `${body}\n\n${residue}` : residue]);
}

/** Poll until the library and GitHub answer, or the ceiling passes (false); a signal to the runner ends the hold too ("interrupted"). */
async function holdForNetwork({ reachable, sleep, now, offline }) {
  const began = now();
  let interrupted = false;
  const stop = () => { interrupted = true; };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  try {
    for (;;) {
      if (interrupted) return { interrupted };
      if (await reachable()) return { back: true, waited: now() - began };
      if (now() - began >= offline.ceilingMs) return { back: false };
      await sleep(offline.pollMs);
    }
  } finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); }
}

export async function runLane({ brief, log, err, addDirs = [], cwd = process.cwd(), home = homedir(), env = process.env,
  commands = { codex: ["codex"], claude: ["claude"] }, now = Date.now, say = console.log, increment,
  heads = (id) => remoteHeads(id, cwd), failed = (failure) => recordLaneFailure(failure),
  storytree = async (args) => (await run("pnpm", ["-s", "storytree", ...args], { cwd, env, maxBuffer: 16 * 1024 * 1024 })).stdout,
  reachable = () => bothAnswer({ increment, cwd, env }), sleep = (ms) => new Promise((done) => setTimeout(done, ms)), offline: limits = {} }) {
  const original = await readFile(brief, "utf8");
  if (!original.trim()) throw new Error(`brief ${brief} is empty`);
  const settings = laneSettings({ home, env });
  const dated = (message) => say(`${new Date(now()).toISOString().replace(/\.\d{3}Z$/, "Z")} ${message}`);
  const login = await loginEnvironment(home, env).catch(async (error) => {
    if (error.code === "lane-token") await askForToken({ lanesDir: settings.lanesDir, increment, storytree, dated });
    throw error;
  });
  const refresh = () => probeCodex(commands.codex, { cwd, env: engineEnvironment("codex", login, log), model: settings.models.codex, log: `${log.replace(/\.log$/, "")}.probe.log` });
  const picked = await pickFresh({ ...settings, now: now() / 1000, refresh });
  dated(`engine ${picked.engine} ${picked.reason}`);
  const began = new Date(now()).toISOString();
  const day = began.slice(0, 10);
  const before = increment ? await traces({ increment, lanesDir: settings.lanesDir, heads }) : null;
  const offline = { ...OFFLINE, ...limits };
  const watch = { quietMs: offline.quietMs, everyMs: offline.everyMs, online: reachable };
  let last = { engine: picked.engine, log, err };
  let started = now();
  let result = await runEngine(commands[picked.engine], argumentsFor(picked.engine, original, addDirs, undefined, settings.models[picked.engine]), { cwd, env: engineEnvironment(picked.engine, login, log), log, err, watch });
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
    result = await runEngine(commands.claude, argumentsFor("claude", handover, addDirs, undefined, settings.models.claude), { cwd, env: engineEnvironment("claude", login, last.log), log: last.log, err: last.err, watch });
    dated(`engine claude exit ${result.code}`);
  }
  if (result.interrupted) {
    dated(`lane runner stopped by a signal: exit 75 so the runner keeps this lane queued`);
    return 75;
  }
  // A lane cut off by a lost connection is held, not failed: resumed in its own session once the network is back, else a fresh lane (1.20).
  if (result.stalled || (result.code !== 0 && !result.signaled && await lostConnection(last))) {
    const session = await sessionOf(last.log);
    const base = last.log.replace(/\.log$/, "");
    const logs = [last.log];
    let why = result.stalled ? "its log stopped growing while the library and GitHub did not answer" : `it exited ${result.code} on a connection error`;
    for (let n = 1; ; n++) {
      const holding = `lane on ${increment ?? "its brief"} lost its connection (${why}): holding until the library and GitHub answer, for up to ${offline.ceilingMs / 3_600_000} h`;
      dated(holding);
      await appendFile(logs.at(-1), `\n${new Date(now()).toISOString()} lane runner: ${holding}\n`).catch(() => {});
      const held = await holdForNetwork({ reachable, sleep, now, offline });
      if (held.interrupted) {
        dated(`lane runner stopped by a signal: exit 75 so the runner keeps this lane queued`);
        return 75;
      }
      if (!held.back) {
        dated(`the library and GitHub did not answer within ${offline.ceilingMs / 3_600_000} h: exit 75 so the runner keeps this lane queued`);
        if (increment) await appendResidue({ increment, storytree, dated, residue: `Residue (lane runner, ${new Date(now()).toISOString().slice(0, 10)}): a pool lane lost its connection (${why}), and the library and GitHub did not answer within ${offline.ceilingMs / 3_600_000} h, so it was not resumed${session ? ` (its session ${session})` : ""}. Logs: ${logs.join(", ")}. Read the logs and any worktree it left before starting again.` });
        return 75;
      }
      if (!session) break;
      const resumed = { log: `${base}.reconnect${n > 1 ? `-${n}` : ""}.log`, err: `${base}.reconnect${n > 1 ? `-${n}` : ""}.err` };
      logs.push(resumed.log);
      dated(`connection back after ${Math.round(held.waited / 60_000)} min: resuming session ${session}, log ${resumed.log}`);
      started = now();
      result = await runEngine(commands[last.engine], argumentsFor(last.engine, CONTINUE, addDirs, session, settings.models[last.engine]), { cwd, env: engineEnvironment(last.engine, login, resumed.log), ...resumed, watch });
      dated(`engine ${last.engine} exit ${result.code}`);
      if (result.interrupted) {
        dated(`lane runner stopped by a signal: exit 75 so the runner keeps this lane queued`);
        return 75;
      }
      if (result.stalled || (result.code !== 0 && !result.signaled && await lostConnection(resumed))) {
        why = result.stalled ? "its log stopped growing while the library and GitHub did not answer" : `it exited ${result.code} on a connection error`;
        continue;
      }
      if (result.code === 0 && (!before || leftSomething(before, await traces({ increment, lanesDir: settings.lanesDir, heads })))) return 0;
      break;
    }
    // The resume failed or left the work unfinished (or there was no session to resume): residue, and a fresh lane that starts from what it left.
    if (increment) await appendResidue({ increment, storytree, dated, residue: `Residue (lane runner, ${new Date(now()).toISOString().slice(0, 10)}): a pool lane lost its connection; ${session ? `its session ${session} was resumed once the library and GitHub answered and ended with the work unfinished` : "its session id was not in its log, so it could not be resumed"}, so a fresh lane carries it on from its worktree, branch, pull request and logs (${logs.join(", ")}).` });
    const fresh = { engine: last.engine, log: `${base}.fresh.log`, err: `${base}.fresh.err` };
    const brief = reconnectBrief(logs, original);
    await writeFile(`${base}.fresh-brief.md`, brief);
    dated(`handing the lane to a fresh ${fresh.engine} session, log ${fresh.log}`);
    last = fresh;
    started = now();
    result = await runEngine(commands[fresh.engine], argumentsFor(fresh.engine, brief, addDirs, undefined, settings.models[fresh.engine]), { cwd, env: engineEnvironment(fresh.engine, login, fresh.log), log: fresh.log, err: fresh.err, watch });
    dated(`engine ${fresh.engine} exit ${result.code}`);
    if (result.interrupted) {
      dated(`lane runner stopped by a signal: exit 75 so the runner keeps this lane queued`);
      return 75;
    }
  }
  // An engine that exits 0 having left nothing ended its turn mid-work: resume its session once, then leave residue.
  if (before && result.code === 0 && !leftSomething(before, await traces({ increment, lanesDir: settings.lanesDir, heads }))) {
    const session = await sessionOf(last.log);
    const base = last.log.replace(/\.log$/, "");
    const resumed = { log: `${base}.resume.log`, err: `${base}.resume.err` };
    dated(`engine ${last.engine} exit 0 having left no report or push for ${increment}: ${session ? `resuming session ${session}` : "restarting"} once, log ${resumed.log}`);
    result = await runEngine(commands[last.engine], argumentsFor(last.engine, session ? CONTINUE : `${CONTINUE}\n\n${original}`, addDirs, session, settings.models[last.engine]), { cwd, env: engineEnvironment(last.engine, login, resumed.log), ...resumed });
    dated(`engine ${last.engine} exit ${result.code}`);
    if (result.interrupted) {
      dated(`lane runner stopped by a signal: exit 75 so the runner keeps this lane queued`);
      return 75;
    }
    if (!leftSomething(before, await traces({ increment, lanesDir: settings.lanesDir, heads }))) {
      await leaveResidue({ increment, session, logs: [last.log, resumed.log], storytree, day, dated });
      // A resume an operator stopped (a signal) is no failure of the lane's.
      if (!result.signaled) await laneFailed({ increment, why: `exit 0 with no report and no push, twice (started, then resumed once; the resume exited ${result.code})`, logs: [last.log, resumed.log],
        lane: session, started: began, failed, storytree, day, dated });
      return 1;
    }
    return result.code;
  }
  const fastFail = Number(env.FAST_FAIL_S ?? 120);
  if (result.code !== 0 && (now() - started) / 1000 < fastFail) {
    dated(`engine failed within ${fastFail}s: exit 75 so the runner keeps this lane queued`);
    return 75;
  }
  // A slow failing exit of the engine's own (not a signal: an operator's stop) that left nothing is a failed lane.
  if (before && result.code !== 0 && !result.signaled && !leftSomething(before, await traces({ increment, lanesDir: settings.lanesDir, heads }))) {
    await laneFailed({ increment, why: `exit ${result.code} with no report and no push`, logs: [last.log], lane: await sessionOf(last.log), started: began, failed, storytree, day, dated });
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
    // A lane that could not start (an empty brief, unreadable login settings, no lane token) stays queued: 75 stops its runner.
    complain(`lane runner: ${error.message}; exit 75 so the runner keeps this lane queued`);
    return 75;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
