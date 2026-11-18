// Capability 1 · Leak, secret and push scans
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { CODE_FILE, describe, sanitizationHits } from "./codeql-patterns.mjs";
import { ruleHits } from "./eslint.mjs";
import { textsOf } from "./leak-scan.mjs";

const SECRET_KEY = /token|secret|passw|key|credential|auth/i;
const LINK_PASSWORD = /[a-z][a-z0-9+.-]*:\/\/[^\s:/@"'\\]+:([^\s@"'\\/]+)@/gi;
const MIN_LENGTH = 12;

const linkPasswords = (text) => [...text.matchAll(LINK_PASSWORD)].map((match) => decodeURIComponent(match[1]));

function jsonValues(text) {
  const values = [];
  const walk = (value, key) => {
    if (typeof value === "string") values.push(...(SECRET_KEY.test(key) ? [value] : []), ...linkPasswords(value));
    else if (value !== null && typeof value === "object") for (const [name, inner] of Object.entries(value)) walk(inner, Array.isArray(value) ? key : name);
  };
  walk(JSON.parse(text), "");
  return values;
}

function lineValues(text) {
  const values = linkPasswords(text);
  for (const line of text.split(/\r?\n/)) {
    const pair = /^\s*(?:export\s+)?["']?([^\s=]+?)["']?\s*(?:=\s*|:\s+)["']?([^\s"']+)["']?\s*$/.exec(line);
    if (pair !== null && SECRET_KEY.test(pair[1])) values.push(pair[2]);
  }
  return values;
}

const pgpassValues = (text) => text.split(/\r?\n/).filter((line) => line.trim() && !line.startsWith("#")).map((line) => line.split(/(?<!\\):/).at(-1));

const READERS = { whole: (text) => [text.trim()], json: jsonValues, lines: lineValues, pgpass: pgpassValues };

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

const patternHits = (file, text) => [
  ...sanitizationHits(file, text).map((hit) => ({ line: hit.line, said: describe(hit) })),
  ...ruleHits(file, text).map(({ line, rule, message }) => ({ line, said: `${rule}: ${message}` })),
];

const occurrences = (texts, value) => texts.reduce((n, text) => n + text.split(value).length - 1, 0);

const ZERO = /^0+$/;
const ZEROS = "0".repeat(40);

function readable(bytes) {
  try {
    return textsOf(bytes);
  } catch {
    return [bytes.toString("latin1")];
  }
}

export function pushProblems({ root, remote, updates, secrets }) {
  const git = (args, encoding = "utf8") => execFileSync("git", args, { cwd: root, encoding, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });
  const textCache = new Map();
  const textsAt = (blob) => {
    if (ZERO.test(blob)) return [];
    if (!textCache.has(blob)) textCache.set(blob, readable(git(["cat-file", "blob", blob], "buffer")));
    return textCache.get(blob);
  };
  const problems = [];
  const patterns = [];
  const seen = new Set();
  const notPushed = git(["remote"]).split("\n").includes(remote) ? `--remotes=${remote}` : "--remotes";
  for (const { localSha, remoteSha } of updates) {
    if (ZERO.test(localSha)) continue;
    const known = !ZERO.test(remoteSha) && spawnSync("git", ["cat-file", "-e", `${remoteSha}^{commit}`], { cwd: root }).status === 0;
    const range = [localSha, ...(known ? [`^${remoteSha}`] : []), "--not", notPushed];
    for (const commit of git(["rev-list", ...range]).split("\n").filter(Boolean)) {
      if (seen.has(commit)) continue;
      seen.add(commit);
      const others = git(["rev-list", "--parents", "-n", "1", commit]).trim().split(" ").slice(2);
      const blobAt = (parent, file) => spawnSync("git", ["rev-parse", "--verify", "-q", `${parent}:${file}`], { cwd: root, encoding: "utf8" }).stdout.trim();
      const raw = git(["diff-tree", "-r", "-z", "--root", "-m", "--first-parent", "--no-renames", "--no-commit-id", "--diff-filter=AM", commit]).split("\0");
      for (let at = 0; at + 1 < raw.length; at += 2) {
        const [, , before, after] = raw[at].split(" ");
        const file = raw[at + 1];
        const added = textsAt(after);
        if (added.length === 0) continue;
        const priors = [textsAt(before), ...others.map((parent) => textsAt(blobAt(parent, file) || ZEROS))];
        const most = (count) => Math.max(...priors.map(count));
        const kinds = new Set(secrets.filter(({ value }) => occurrences(added, value) > most((prior) => occurrences(prior, value))).map(({ what }) => what));
        for (const what of kinds) problems.push(`${file} (commit ${commit.slice(0, 10)}) adds the value of ${what}`);
        if (!CODE_FILE.test(file)) continue;
        const hits = added.flatMap((text) => patternHits(file, text));
        if (hits.length <= most((prior) => prior.flatMap((text) => patternHits(file, text)).length)) continue;
        for (const { line, said } of hits) patterns.push(`${file}:${line} (commit ${commit.slice(0, 10)}) ${said}`);
      }
    }
  }
  return { secrets: problems, patterns };
}

export function parseUpdates(stdin) {
  return stdin.split(/\r?\n/).map((line) => line.trim().split(/\s+/)).filter((fields) => fields.length === 4).map(([, localSha, , remoteSha]) => ({ localSha, remoteSha }));
}

export function checkPush({ root, remote, stdin, home = homedir(), sources, error = console.error }) {
  const { secrets, patterns } = pushProblems({ root, remote, updates: parseUpdates(stdin), secrets: machineSecrets({ home, sources }) });
  if (secrets.length > 0) {
    error(
      "push check: the push adds a credential this machine holds (the value is not shown). Take it out of the commits " +
        `and push again, and replace the credential if the commits were shared:\n${secrets.map((problem) => `  ${problem}`).join("\n")}`,
    );
  }
  if (patterns.length > 0) {
    error(
      "push check: the push adds a pattern CodeQL refuses. Each unpushed commit is checked for the text it adds, so a later fix " +
        "does not clear it: fix it and fold the unpushed commits into one (for example `git reset --soft` to the remote branch or " +
        `the merge base, then commit again), and push again:\n${patterns.map((problem) => `  ${problem}`).join("\n")}`,
    );
  }
  return secrets.length + patterns.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  process.exitCode = checkPush({ root, remote: process.argv[2] ?? "origin", stdin: readFileSync(0, "utf8") });
}
