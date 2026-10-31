// Capability 1 · Leak, secret and push scans. The push check: the exact-value half of the secret check, run only on this machine as
// git's pre-push hook, which provision-worktree.mjs installs (installPushHook). It reads the credentials already held in
// this machine's own files (MACHINE_CREDENTIALS: storytree's, the GitHub command line's, the coding agents' logins,
// git's and Postgres's password files), and refuses a push whose commits add one to a file, read through leak-scan's
// textsOf, so a value inside gzip, an archive or UTF-16 is found. It names the file, the commit and the kind of value
// (where it was read from), never the value: values stay in this process, and a credential file that cannot be read
// or parsed is passed over without its error, which can quote the file. CI and the gate never see a real value; they
// run the shapes-only check:secrets (leak-scan.mjs).
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { textsOf } from "./leak-scan.mjs";

/** A credential's key: a name that holds a token, secret, password or key. */
const SECRET_KEY = /token|secret|passw|key|credential|auth/i;
/** A link's password (scheme://user:password@host). */
const LINK_PASSWORD = /[a-z][a-z0-9+.-]*:\/\/[^\s:/@"'\\]+:([^\s@"'\\/]+)@/gi;
/** Shorter than this, a value is too likely to be an ordinary word to be matched exactly. */
const MIN_LENGTH = 12;

const linkPasswords = (text) => [...text.matchAll(LINK_PASSWORD)].map((match) => decodeURIComponent(match[1]));

/** Every string a JSON file holds under a credential's key, and every link password in any of its strings. */
function jsonValues(text) {
  const values = [];
  const walk = (value, key) => {
    if (typeof value === "string") values.push(...(SECRET_KEY.test(key) ? [value] : []), ...linkPasswords(value));
    else if (value !== null && typeof value === "object") for (const [name, inner] of Object.entries(value)) walk(inner, Array.isArray(value) ? key : name);
  };
  walk(JSON.parse(text), "");
  return values;
}

/** Each `key: value` or `key = value` line under a credential's key, and every link password. */
function lineValues(text) {
  const values = linkPasswords(text);
  for (const line of text.split(/\r?\n/)) {
    const pair = /^\s*(?:export\s+)?["']?([^\s=]+?)["']?\s*(?:=|:(?=\s))\s*["']?([^\s"']+)["']?\s*$/.exec(line);
    if (pair !== null && SECRET_KEY.test(pair[1])) values.push(pair[2]);
  }
  return values;
}

/** The password, the last field of each host:port:database:user:password line. */
const pgpassValues = (text) => text.split(/\r?\n/).filter((line) => line.trim() && !line.startsWith("#")).map((line) => line.split(/(?<!\\):/).at(-1));

const READERS = { whole: (text) => [text.trim()], json: jsonValues, lines: lineValues, pgpass: pgpassValues };

/** The files on a machine that hold credentials: where (under the home folder), what they hold, and how to read them. */
export const MACHINE_CREDENTIALS = [
  { file: ".storytree/secrets.json", what: "storytree's lane login", read: "json" },
  { file: ".storytree/0.3/auth.json", what: "storytree's library key", read: "json" },
  { file: ".storytree/0.3/settings.json", what: "storytree's library password", read: "json" },
  { file: ".storytree/library-host/postgres-password", what: "the library host's database password", read: "whole" },
  { file: ".storytree/library-host/ci-health-password", what: "the library host's CI health password", read: "whole" },
  { file: ".storytree/pixellab-token", what: "the PixelLab token", read: "whole" },
  { file: ".config/gh/hosts.yml", what: "the GitHub command line's token", read: "lines" },
  { file: ".codex/auth.json", what: "Codex's login", read: "json" },
  { file: ".claude/.credentials.json", what: "Claude Code's login", read: "json" },
  { file: ".git-credentials", what: "a git password", read: "lines" },
  { file: ".pgpass", what: "a Postgres password", read: "pgpass" },
  { file: ".npmrc", what: "an npm token", read: "lines" },
];

/**
 * The credential values this machine holds, each with what it is and the file it came from: `sources` read under
 * `home`. A file that is missing, unreadable or unparsable is passed over in silence, since a parser's error can
 * quote the file's text.
 */
export function machineSecrets({ home = homedir(), sources = MACHINE_CREDENTIALS } = {}) {
  const secrets = new Map();
  for (const { file, what, read } of sources) {
    let values;
    try {
      values = READERS[read](readFileSync(path.join(home, file), "utf8"));
    } catch {
      continue;
    }
    for (const value of values) if (value.length >= MIN_LENGTH && !secrets.has(value)) secrets.set(value, `${what} (~/${file})`);
  }
  return [...secrets].map(([value, what]) => ({ value, what }));
}

const occurrences = (texts, value) => texts.reduce((n, text) => n + text.split(value).length - 1, 0);

const ZERO = /^0+$/;

/** A blob's texts; one textsOf cannot open (a damaged archive) is read as its raw bytes, so it is still searched. */
function readable(bytes) {
  try {
    return textsOf(bytes);
  } catch {
    return [bytes.toString("latin1")];
  }
}

/**
 * The refusals for a push: for each update git hands the hook (local sha, remote sha), each commit not yet on
 * `remote`, and each file it adds or changes whose count of a machine value rises against the commit's first parent.
 * One line a hit, naming the file, the commit and the kind; never the value.
 */
export function pushProblems({ root, remote, updates, secrets }) {
  if (secrets.length === 0) return [];
  const git = (args, encoding = "utf8") => execFileSync("git", args, { cwd: root, encoding, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });
  const textCache = new Map();
  const textsAt = (blob) => {
    if (ZERO.test(blob)) return [];
    if (!textCache.has(blob)) textCache.set(blob, readable(git(["cat-file", "blob", blob], "buffer")));
    return textCache.get(blob);
  };
  const problems = [];
  const seen = new Set();
  for (const { localSha, remoteSha } of updates) {
    if (ZERO.test(localSha)) continue; // a deletion pushes no text
    const known = !ZERO.test(remoteSha) && spawnSync("git", ["cat-file", "-e", `${remoteSha}^{commit}`], { cwd: root }).status === 0;
    const range = known ? [localSha, `^${remoteSha}`] : [localSha, "--not", `--remotes=${remote}`];
    for (const commit of git(["rev-list", ...range]).split("\n").filter(Boolean)) {
      if (seen.has(commit)) continue;
      seen.add(commit);
      const raw = git(["diff-tree", "-r", "-z", "--root", "-m", "--first-parent", "--no-renames", "--no-commit-id", "--diff-filter=AM", commit]).split("\0");
      for (let at = 0; at + 1 < raw.length; at += 2) {
        const [, , before, after] = raw[at].split(" ");
        const file = raw[at + 1];
        const added = textsAt(after);
        if (added.length === 0) continue;
        const prior = textsAt(before);
        const kinds = new Set(secrets.filter(({ value }) => occurrences(added, value) > occurrences(prior, value)).map(({ what }) => what));
        for (const what of kinds) problems.push(`${file} (commit ${commit.slice(0, 10)}) adds the value of ${what}`);
      }
    }
  }
  return problems;
}

/** The updates git writes to a pre-push hook's stdin: `<local ref> <local sha> <remote ref> <remote sha>` a line. */
export function parseUpdates(stdin) {
  return stdin.split(/\r?\n/).map((line) => line.trim().split(/\s+/)).filter((fields) => fields.length === 4).map(([, localSha, , remoteSha]) => ({ localSha, remoteSha }));
}

/** The hook's run: 1 with the refusal said through `error` when the push adds a machine value, else 0. */
export function checkPush({ root, remote, stdin, home = homedir(), sources, error = console.error }) {
  const problems = pushProblems({ root, remote, updates: parseUpdates(stdin), secrets: machineSecrets({ home, sources }) });
  if (problems.length === 0) return 0;
  error(
    "push check: the push adds a credential this machine holds (the value is not shown). Take it out of the commits " +
      `and push again, and replace the credential if the commits were shared:\n${problems.map((problem) => `  ${problem}`).join("\n")}`,
  );
  return 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  process.exitCode = checkPush({ root, remote: process.argv[2] ?? "origin", stdin: readFileSync(0, "utf8") });
}
