import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { removeTemp } from "@storytree/test-waits";

// The stable routine (fortnight.sh) and its judge (judge.sh) run on the Mint box, from a weekly timer. Here each runs
// from a copy in a git folder of its own, with storytree's command line (pnpm), the acceptance run (run.sh) and Claude
// Code (claude) stood in for by scripts that record how they were called and answer as each case needs.
const harness = fileURLToPath(new URL("../../testing/stable-acceptance/harness/", import.meta.url));
const skip = process.platform === "win32" && "platform:posix: the routine runs under bash on the Mint box, which Windows CI does not provide";
const NONE = "No build newer than stable's 0.3.1482 is fit to pin yet.";
const UNAPPROVED = `/home/u/runner names storytree project "storytree", but it is not approved as "storytree"'s checkout on this machine, so storytree opens nothing and records nothing here.`;
const CANDIDATE = { text: "Stable candidate: storytree 0.3.2164 (stable is 0.3.1482).\n  Published 30 hours ago.\n\nPin it with: storytree release pin 0.3.2164\n\n# notes" };

interface Routine { root: string; home: string; calls: string[]; runs: string[] }

/** Runs the routine, its `release candidate` answering each of `candidates` in turn (the last again after), and returns what it called. */
function routine(candidates: { text: string; status?: number }[], { runLog = "", runStatus = 1, filing = 0 } = {}): Routine {
  const root = mkdtempSync(path.join(tmpdir(), "storytree-stable-routine-"));
  const repo = path.join(root, "repo"), home = path.join(root, "home"), stub = path.join(root, "stub"), bin = path.join(root, "bin");
  for (const dir of [repo, home, stub, bin]) mkdirSync(dir, { recursive: true });
  spawnSync("git", ["init", "-q", repo]);
  for (const file of ["fortnight.sh", "cost.mjs"]) copyFileSync(path.join(harness, file), path.join(repo, file));
  candidates.forEach((one, i) => {
    writeFileSync(path.join(stub, `candidate-${i + 1}`), one.text + "\n");
    writeFileSync(path.join(stub, `candidate-${i + 1}.status`), String(one.status ?? 0));
  });
  writeFileSync(path.join(stub, "run.log"), runLog);
  const script = (file: string, body: string) => { writeFileSync(file, `#!/bin/bash\n${body}\n`); chmodSync(file, 0o755); };
  script(path.join(bin, "pnpm"), `echo "$*" >> "${stub}/calls"
case "$*" in
  *"release candidate"*) n=$(( $(cat "${stub}/n" 2>/dev/null || echo 0) + 1 )); echo $n > "${stub}/n"
    f="${stub}/candidate-$n"; [[ -f $f ]] || f="${stub}/candidate-${candidates.length}"; cat "$f"; exit $(cat "$f.status") ;;
  *"friction new"*) echo "filed"; exit ${filing} ;;
esac`);
  script(path.join(repo, "run.sh"), `echo "$1" >> "${stub}/runs"; mkdir -p "$2"; cp "${stub}/run.log" "$2/run.log"; exit ${runStatus}`);
  const env = { ...process.env, HOME: home, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` };
  const result = spawnSync("bash", [path.join(repo, "fortnight.sh"), "--now"], { encoding: "utf8", env });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const lines = (file: string) => existsSync(path.join(stub, file)) ? readFileSync(path.join(stub, file), "utf8").trim().split("\n") : [];
  return { root, home, calls: lines("calls"), runs: lines("runs") };
}

const lastRun = (r: Routine) => existsSync(path.join(r.home, "storytree-lanes", "stable-acceptance", "last-run"));
const filed = (r: Routine) => r.calls.filter((call) => call.includes("friction new"));
const asked = (r: Routine) => r.calls.filter((call) => call.includes("release candidate")).length;
/** The text of the file a call passed as `--<flag> @file`. */
const fileOf = (call: string, flag: string) => readFileSync(new RegExp(`--${flag} @(\\S+)`).exec(call)![1]!, "utf8");
const done = (r: Routine) => removeTemp(r.root);

test("1.17 the stable routine approves its own clone as storytree's checkout when `release candidate` refuses it as unapproved, and asks again", { skip }, async () => {
  const r = routine([{ text: UNAPPROVED, status: 1 }, { text: NONE }]);
  try {
    const join = r.calls.findIndex((call) => call.includes("doctor --join storytree"));
    assert.ok(join > 0, r.calls.join("\n"));
    assert.equal(asked(r), 2, "asked again after the join");
    assert.deepEqual(filed(r), [], "an answer of no candidate files nothing");
    assert.equal(lastRun(r), false, "no run happened, so the fortnight is not counted");
  } finally { await done(r); }
});

test("1.17 the stable routine files a friction when `release candidate` refuses for another reason, and does not count the fortnight", { skip }, async () => {
  const r = routine([{ text: "the library at mint:5432 does not answer", status: 1 }]);
  try {
    assert.equal(filed(r).length, 1, r.calls.join("\n"));
    assert.match(fileOf(filed(r)[0]!, "evidence"), /the library at mint:5432 does not answer/);
    assert.doesNotMatch(fileOf(filed(r)[0]!, "title"), /regression/);
    assert.deepEqual(r.runs, []);
    assert.equal(lastRun(r), false);
  } finally { await done(r); }
});

test("1.17 a run that ends with no verdict from its judge files a friction about the harness, not a regression in the build, and tries no other candidate", { skip }, async () => {
  const r = routine([CANDIDATE, { text: "Stable candidate: storytree 0.3.2163 (stable is 0.3.1482)." }], { runLog: "VERDICT: FAIL: the judge gave no verdict  (judge ?, $0.00, 0 s)\n" });
  try {
    assert.deepEqual(r.runs, ["0.3.2164"], "one run only");
    assert.equal(filed(r).length, 1, r.calls.join("\n"));
    assert.doesNotMatch(fileOf(filed(r)[0]!, "title"), /regression/);
    assert.match(fileOf(filed(r)[0]!, "title"), /0\.3\.2164/);
    assert.equal(lastRun(r), false, "a run the harness could not judge is tried again at the next timer");
  } finally { await done(r); }
});

test("1.17 a build the judge failed files a regression friction linking a note the library accepts, counts the fortnight, and asks for the next candidate", { skip }, async () => {
  const r = routine([CANDIDATE, { text: NONE }], { runLog: "VERDICT: FAIL: criterion 3, no test passed\n" });
  try {
    assert.equal(filed(r).length, 1, r.calls.join("\n"));
    assert.match(fileOf(filed(r)[0]!, "title"), /a regression in 0\.3\.2164/);
    assert.match(filed(r)[0]!, /--links process_[0-9a-f]{12}(\s|$)/, "links the Moving stable process note, not an arc");
    assert.equal(asked(r), 2);
    assert.equal(lastRun(r), true);
  } finally { await done(r); }
});

test("1.17 when a build's regression friction cannot be filed, the routine stops rather than run the same build again", { skip }, async () => {
  const r = routine([CANDIDATE], { runLog: "VERDICT: FAIL: criterion 3, no test passed\n", filing: 1 });
  try {
    assert.deepEqual(r.runs, ["0.3.2164"]);
  } finally { await done(r); }
});

test("1.17 a passed build raises its pin question on the arc open for it", { skip }, async () => {
  const r = routine([CANDIDATE], { runLog: "VERDICT: PASS\n", runStatus: 0 });
  try {
    const questions = r.calls.filter((call) => call.includes("question new"));
    assert.equal(questions.length, 1, r.calls.join("\n"));
    assert.match(questions[0]!, /--arc arc_e75e343c4afe /);
    assert.equal(lastRun(r), true);
  } finally { await done(r); }
});

test("1.17 the judge signs in with the routine's long-lived token, its whitespace stripped, needing no sign-in on the box", { skip }, async () => {
  const root = mkdtempSync(path.join(tmpdir(), "storytree-stable-judge-"));
  try {
    const bin = path.join(root, "bin"), out = path.join(root, "out"), here = path.join(root, "harness");
    for (const dir of [bin, out, here]) mkdirSync(dir);
    copyFileSync(path.join(harness, "judge.sh"), path.join(here, "judge.sh"));
    writeFileSync(path.join(here, "criteria.md"), "judge it\n");
    const token = path.join(root, "token");
    writeFileSync(token, "sk-ant-oat01-abc\n  def\n");
    writeFileSync(path.join(bin, "claude"), `#!/bin/bash\nprintf '{"result":"VERDICT: PASS","token":"%s"}' "$CLAUDE_CODE_OAUTH_TOKEN"\n`);
    chmodSync(path.join(bin, "claude"), 0o755);
    const { CLAUDE_CODE_OAUTH_TOKEN: _, ...rest } = process.env;
    const result = spawnSync("bash", [path.join(here, "judge.sh"), out], { encoding: "utf8", env: { ...rest, STABLE_ACCEPTANCE_TOKEN_FILE: token, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` } });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(readFileSync(path.join(out, "judge.json"), "utf8")).token, "sk-ant-oat01-abcdef");
  } finally { await removeTemp(root); }
});

test("1.17 a run whose acceptance user's Claude Code is not signed in files a friction about the run's precondition, not a regression in the build, and does not count the fortnight", { skip }, async () => {
  const r = routine([CANDIDATE, { text: NONE }], { runLog: "PRECONDITION: the run user's Claude Code is not signed in: Invalid API key\n", runStatus: 4 });
  try {
    assert.deepEqual(r.runs, ["0.3.2164"], "one run only");
    assert.equal(filed(r).length, 1, r.calls.join("\n"));
    assert.doesNotMatch(fileOf(filed(r)[0]!, "title"), /regression/);
    assert.match(fileOf(filed(r)[0]!, "statement"), /not signed in: Invalid API key/);
    assert.equal(lastRun(r), false);
  } finally { await done(r); }
});

/** Runs the acceptance run's named phases against a laptop stood in for by ssh and scp, its sign-in step saying `signin`. */
function acceptance(signin: string, phases: string[]) {
  const root = mkdtempSync(path.join(tmpdir(), "storytree-stable-run-"));
  const here = path.join(root, "harness"), bin = path.join(root, "bin"), out = path.join(root, "out");
  for (const dir of [here, path.join(here, "steps"), bin]) mkdirSync(dir, { recursive: true });
  spawnSync("git", ["init", "-q", here]);
  for (const file of ["run.sh", "user.ps1", "state.ps1", "steps/prepare.ps1", "steps/signin.ps1", "steps/install.ps1"]) copyFileSync(path.join(harness, file), path.join(here, file));
  writeFileSync(path.join(here, "judge.sh"), `echo judged >> "${root}/calls"; echo "VERDICT: PASS" | tee -a "$1/run.log"`);
  const token = path.join(root, "token");
  writeFileSync(token, "sk-ant-oat01-abc\n");
  const script = (name: string, body: string) => { writeFileSync(path.join(bin, name), `#!/bin/bash\n${body}\n`); chmodSync(path.join(bin, name), 0o755); };
  script("ssh", `echo "ssh $*" >> "${root}/calls"; case "$*" in *signin.ps1*) printf '%s\\n' ${JSON.stringify(signin)} ;; esac; exit 0`);
  script("scp", `echo "scp $*" >> "${root}/calls"; exit 0`);
  script("curl", "echo STORYTREE_ACCEPTANCE_VERSION");
  script("pnpm", "exit 0");
  const env = { ...process.env, STABLE_ACCEPTANCE_HOST: "laptop", STABLE_ACCEPTANCE_TOKEN_FILE: token, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` };
  const result = spawnSync("bash", [path.join(here, "run.sh"), "0.3.2167", out, ...phases], { encoding: "utf8", env });
  const calls = readFileSync(path.join(root, "calls"), "utf8").trim().split("\n");
  return { root, status: result.status, calls, log: readFileSync(path.join(out, "run.log"), "utf8") };
}

test("1.17 the acceptance run checks its user's Claude Code sign-in before it installs the build: signed out, it notes the precondition, removes the user and judges nothing", { skip }, async () => {
  const r = acceptance("signed in: no (Invalid API key)", ["before", "user", "prepare", "signin", "install", "judge"]);
  try {
    assert.equal(r.status, 4, r.log);
    assert.match(r.log, /^PRECONDITION: the run user's Claude Code is not signed in: \(Invalid API key\)$/m);
    assert.ok(r.calls.some((call) => call.includes("user.ps1 remove")), "the user is removed: " + r.calls.join("\n"));
    assert.ok(!r.calls.some((call) => call.includes("install.ps1")), "the build is not installed");
    assert.ok(!r.calls.includes("judged"), "the run is not judged");
    assert.doesNotMatch(r.log, /^VERDICT:/m);
  } finally { await removeTemp(r.root); }
});

test("1.17 an acceptance user whose Claude Code is signed in goes on to install the build", { skip }, async () => {
  const r = acceptance("signed in: yes", ["before", "user", "prepare", "signin", "install"]);
  try {
    assert.equal(r.status, 0, r.log);
    assert.ok(r.calls.some((call) => call.includes("install.ps1")), r.calls.join("\n"));
    assert.doesNotMatch(r.log, /PRECONDITION/);
  } finally { await removeTemp(r.root); }
});
