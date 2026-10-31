// The push check (packages/dev-loop/src/push-check.mjs): git's pre-push hook refuses a push that adds a credential
// this machine holds, read from a home folder's credential files, without ever saying the value.
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { removeTemp } from "@storytree/test-waits";

import { installPushHook } from "@storytree/base-dev-loop/provision-worktree";
import { checkPush, machineSecrets } from "./push-check.mjs";

const script = fileURLToPath(new URL("./push-check.mjs", import.meta.url));
const ZEROS = "0".repeat(40);
const utf16 = (text) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
/** Every run of six characters of `value`, none of which a refusal may hold. */
const pieces = (value) => Array.from({ length: value.length - 5 }, (_, at) => value.slice(at, at + 6));

/** A home folder holding two credentials, made at run time so no file holds them, and a repository with a remote. */
function machine(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "push-check-"));
  t.after(() => removeTemp(dir));
  const home = path.join(dir, "home");
  const lane = randomBytes(24).toString("hex");
  const github = randomBytes(20).toString("base64url");
  mkdirSync(path.join(home, ".storytree"), { recursive: true });
  writeFileSync(path.join(home, ".storytree", "secrets.json"), JSON.stringify({ LANE_LOGIN_TOKEN: lane, name: "not a secret value at all" }));
  mkdirSync(path.join(home, ".config", "gh"), { recursive: true });
  writeFileSync(path.join(home, ".config", "gh", "hosts.yml"), `github.com:\n    oauth_token: ${github}\n    git_protocol: https\n`);
  const pg = randomBytes(16).toString("hex");
  writeFileSync(path.join(home, ".pgpass"), `# host:port:database:user:a-comment-not-a-password\n\nbox:5432:library:me:${pg}\n`);
  const root = path.join(dir, "repo");
  const remote = path.join(dir, "remote.git");
  execFileSync("git", ["init", "-q", "--bare", remote]);
  mkdirSync(root);
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "t");
  git("config", "user.email", "t@example.com");
  git("remote", "add", "origin", remote);
  writeFileSync(path.join(root, "readme.md"), "a project\n");
  git("add", ".");
  git("commit", "-q", "-m", "main");
  git("push", "-q", "--no-verify", "origin", "main");
  return { dir, home, root, git, lane, github };
}

test("7.21 · the push check refuses a push whose commits add a credential this machine holds, even inside gzip, UTF-16 or a damaged archive, naming the file and kind but no part of the value, and passes a push without one", (t) => {
  const { home, root, git, lane, github } = machine(t);
  assert.deepEqual(machineSecrets({ home }).map(({ what }) => what).sort(), ["a Postgres password (~/.pgpass)", "storytree's lane login (~/.storytree/secrets.json)", "the GitHub command line's token (~/.config/gh/hosts.yml)"], "a .pgpass comment or blank line holds no password");
  git("checkout", "-q", "-b", "leaky");
  mkdirSync(path.join(root, "evidence"));
  writeFileSync(path.join(root, "evidence", "run.json.gz"), gzipSync(JSON.stringify({ env: { TOKEN: lane } })));
  git("add", ".");
  git("commit", "-q", "-m", "one");
  writeFileSync(path.join(root, "evidence", "log.txt"), utf16(`signed in with ${github}\n`));
  writeFileSync(path.join(root, "evidence", "cut.gz"), Buffer.concat([Buffer.from([0x1f, 0x8b]), Buffer.from(` ${github} `)]));
  git("add", ".");
  git("commit", "-q", "-m", "two");
  const head = git("rev-parse", "HEAD").trim();
  const said = [];
  assert.equal(checkPush({ root, remote: "origin", stdin: `refs/heads/leaky ${head} refs/heads/leaky ${ZEROS}\n`, home, error: (line) => said.push(line) }), 1);
  const refusal = said.join("\n");
  assert.match(refusal, /evidence\/run\.json\.gz \(commit \w+\) adds the value of storytree's lane login \(~\/\.storytree\/secrets\.json\)/);
  assert.match(refusal, /evidence\/log\.txt \(commit \w+\) adds the value of the GitHub command line's token \(~\/\.config\/gh\/hosts\.yml\)/);
  assert.match(refusal, /evidence\/cut\.gz \(commit \w+\) adds the value of the GitHub command line's token/, "a damaged archive is still searched");
  for (const piece of [...pieces(lane), ...pieces(github)]) assert.ok(!refusal.includes(piece), "the refusal holds no part of a value");

  git("checkout", "-q", "main");
  git("checkout", "-q", "-b", "clean");
  writeFileSync(path.join(root, "notes.md"), "nothing secret here\n");
  git("add", ".");
  git("commit", "-q", "-m", "clean");
  const clean = git("rev-parse", "HEAD").trim();
  assert.equal(checkPush({ root, remote: "origin", stdin: `refs/heads/clean ${clean} refs/heads/clean ${ZEROS}\n`, home, error: (line) => said.push(line) }), 0);
  assert.equal(checkPush({ root, remote: "origin", stdin: `refs/heads/leaky ${ZEROS} refs/heads/leaky ${head}\n`, home }), 0, "deleting a branch pushes no text");
});

/** Run git to its end without blocking this process, so the runner hears the test's reports on every platform. */
function push(root, home, ...args) {
  return new Promise((resolve) => {
    execFile("git", ["push", ...args], { cwd: root, encoding: "utf8", env: { ...process.env, HOME: home, USERPROFILE: home } }, (error, stdout, stderr) => resolve({ status: error ? 1 : 0, stderr }));
  });
}

test("7.21 · a git push through the installed hook is refused when it adds a machine credential, without the value, and goes through when it adds none", async (t) => {
  const { home, root, git, lane } = machine(t);
  assert.match(installPushHook({ root, fallback: script }), /push check installed/);
  git("checkout", "-q", "-b", "leaky");
  writeFileSync(path.join(root, "config.txt"), `token=${lane}\n`);
  git("add", ".");
  git("commit", "-q", "-m", "leak");
  const refused = await push(root, home, "origin", "leaky");
  assert.equal(refused.status, 1, refused.stderr);
  assert.match(refused.stderr, /config\.txt \(commit \w+\) adds the value of storytree's lane login/);
  for (const piece of pieces(lane)) assert.ok(!refused.stderr.includes(piece), "the refusal holds no part of the value");
  assert.equal(git("ls-remote", "origin", "leaky").trim(), "", "nothing reached the remote");
  git("checkout", "-q", "main");
  writeFileSync(path.join(root, "notes.md"), "words\n");
  git("add", ".");
  git("commit", "-q", "-m", "clean");
  const passed = await push(root, home, "origin", "main");
  assert.equal(passed.status, 0, passed.stderr);
});
