// Capability 1 · Leak, secret and push scans
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { gunzipSync, inflateRawSync } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";

import { redactionsIn } from "@storytree/forest/evidence-seed";

import { changedFiles } from "@storytree/base-dev-loop/test-scope";

export const OWNER_WORDS = [{ what: "the owner's username", hash: "eae1206e68ff609dc03e5b25c4b2c2c4868d80901fa7319560f3a6469fcab8ff", length: 5, exact: false }];

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

export function nameWords(names, what = "a private name") {
  return names.flatMap((name) => String(name).match(/[A-Za-z0-9]+/g) ?? []).map((token) => ({ what, hash: sha256(token), length: token.length, exact: true }));
}

export function isThirdParty(file) {
  return /(^|\/)licenses\//i.test(file) || /(^|\/)(?:LICEN[CS]E|NOTICE|COPYING|OFL|ThirdPartyNotices)[^/]*$/i.test(file) || file === "pnpm-lock.yaml";
}

const PLACEHOLDER_HOME = /^(?:[a-z]|runner(?:~\d)?|user|username|someone|somebody|me|you|name|owner|synthetic|tester|alice|bob|carol|example|ubuntu|node|vscode|dev|backups|[<$%{*].*)$/i;
const PLACEHOLDER_TAILNET = /(?:^|[.-])example(?:[.-]|$)|(?:^|\.)tail(?:0000|1234)\./i;
const PLACEHOLDER_DOMAINS = ["storytree.dev", "example", "example.com", "example.org", "example.net", "test", "invalid", "localhost", "local"];

function placeholderEmail(address) {
  const lower = address.toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at < 0) return false;
  const [local, domain] = [lower.slice(0, at), lower.slice(at + 1)];
  if (local === "noreply" || local === "no-reply" || domain === "users.noreply.github.com") return true;
  if (lower.endsWith(".iam") || lower.endsWith(".iam.gserviceaccount.com")) return true;
  return PLACEHOLDER_DOMAINS.some((placeholder) => domain === placeholder || (domain.endsWith(`.${placeholder}`) && domain.length > placeholder.length + 1));
}

function withoutTrailingPunctuation(name) {
  let end = name.length;
  while (end > 0 && ".,;:!?)]}`".includes(name[end - 1])) end--;
  return name.slice(0, end);
}

const TAILNET_RANGE = "100.64.0.0";

function placeholder(what, match) {
  if (/home folder/.test(what)) return PLACEHOLDER_HOME.test(withoutTrailingPunctuation(match.split(/[\\/]+/).filter(Boolean).at(-1) ?? ""));
  if (what === "an email address") return placeholderEmail(match);
  if (what === "a tailnet name") return PLACEHOLDER_TAILNET.test(match);
  if (what === "a tailnet address") return match === TAILNET_RANGE;
  return false;
}

export function leakCounts(text, words = OWNER_WORDS) {
  const counts = {};
  const add = (what) => (counts[what] = (counts[what] ?? 0) + 1);
  for (const [what, match] of redactionsIn(text)) if (!placeholder(what, match)) add(what);
  if (words.length > 0) {
    const lengths = new Set(words.map((word) => word.length));
    const byHash = new Map(words.map((word) => [`${word.exact ? "=" : "~"}${word.hash}`, word.what]));
    for (const [token] of text.matchAll(/[A-Za-z0-9]+/g)) {
      if (!lengths.has(token.length)) continue;
      const what = byHash.get(`~${sha256(token.toLowerCase())}`) ?? byHash.get(`=${sha256(token)}`);
      if (what !== undefined) add(what);
    }
  }
  return counts;
}

const zerosAt = (bytes, start) => {
  let zeros = 0;
  let seen = 0;
  for (let i = start; i < Math.min(bytes.length, 4096); i += 2, seen++) if (bytes[i] === 0) zeros++;
  return seen > 0 ? zeros / seen : 0;
};
const unmarked = (bytes, high) => bytes.length >= 4 && zerosAt(bytes, high) > 0.9 && zerosAt(bytes, 1 - high) < 0.05;

function zipEntries(bytes) {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
  let end = -1;
  for (let i = view.length - 22; i >= Math.max(0, view.length - 65_557); i--) if (view.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end === -1) return [];
  const entries = [];
  let at = view.readUInt32LE(end + 16);
  for (let n = view.readUInt16LE(end + 10); n > 0 && view.readUInt32LE(at) === 0x02014b50; n--) {
    const method = view.readUInt16LE(at + 10);
    const size = view.readUInt32LE(at + 20);
    const local = view.readUInt32LE(at + 42);
    const data = local + 30 + view.readUInt16LE(local + 26) + view.readUInt16LE(local + 28);
    const raw = view.subarray(data, data + size);
    entries.push(method === 8 ? inflateRawSync(raw) : raw);
    at += 46 + view.readUInt16LE(at + 28) + view.readUInt16LE(at + 30) + view.readUInt16LE(at + 32);
  }
  return entries;
}

function tarEntries(bytes) {
  const entries = [];
  for (let at = 0; at + 512 <= bytes.length && bytes[at] !== 0; ) {
    const size = parseInt(Buffer.from(bytes.subarray(at + 124, at + 136)).toString("latin1").replace(/\0.*$/s, "").trim() || "0", 8);
    entries.push(bytes.subarray(at + 512, at + 512 + size));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

export function textsOf(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return textsOf(gunzipSync(bytes));
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4) return zipEntries(bytes).flatMap(textsOf);
  if (bytes.length >= 262 && Buffer.from(bytes.subarray(257, 262)).toString("latin1") === "ustar") return tarEntries(bytes).flatMap(textsOf);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return [new TextDecoder("utf-16le").decode(bytes.subarray(2))];
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return [new TextDecoder("utf-16be").decode(bytes.subarray(2))];
  if (unmarked(bytes, 1)) return [new TextDecoder("utf-16le").decode(bytes)];
  if (unmarked(bytes, 0)) return [new TextDecoder("utf-16be").decode(bytes)];
  if (bytes.subarray(0, 8192).includes(0)) return [];
  return [new TextDecoder("utf-8").decode(bytes)];
}

export const CREDENTIALS = [
  ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ["a bearer token", /\bBearer\s+[A-Za-z0-9\-._~+/]{20,}=*/g],
  ["an OAuth token", /\b(?:ya29\.[A-Za-z0-9_-]{20,}|gho_[A-Za-z0-9]{36,})/g],
  ["an Anthropic or OpenAI key", /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/g],
  ["a GitHub token", /\b(?:gh[psur]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/g],
  ["a Google API key", /\bAIza[0-9A-Za-z_-]{35}/g],
  ["a Google OAuth client secret", /\bGOCSPX-[A-Za-z0-9_-]{20,}/g],
  ["an AWS access key", /\bAKIA[0-9A-Z]{16}\b/g],
  ["a Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
  ["a GitLab token", /\bglpat-[A-Za-z0-9_-]{20,}/g],
  ["a Tailscale key", /\btskey-[A-Za-z0-9-]{16,}/g],
  ["a password in a link", /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@"'\\]+:([^\s@"'\\/]+)@/gi],
];

const PLACEHOLDER_PASSWORD = /^(?:[$<{*%[].*|password|pass|pw|secret|x+|\.+)$/i;

export function credentialCounts(text) {
  const counts = {};
  for (const [what, shape] of CREDENTIALS) {
    for (const match of text.matchAll(shape)) {
      if (what === "a password in a link" && PLACEHOLDER_PASSWORD.test(match[1])) continue;
      counts[what] = (counts[what] ?? 0) + 1;
    }
  }
  return counts;
}

const sum = (counts) => Object.values(counts).reduce((a, b) => a + b, 0);

export function fileCounts(bytes, words = OWNER_WORDS, count = leakCounts) {
  const counts = {};
  for (const text of textsOf(bytes)) for (const [what, n] of Object.entries(count(text, words))) counts[what] = (counts[what] ?? 0) + n;
  return counts;
}

export function folderOf(file) {
  const parts = file.split("/");
  if (parts.length === 1) return "(root)";
  return ["packages", "apps"].includes(parts[0]) && parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts[0];
}

export function scanTree(root, files, words = OWNER_WORDS) {
  return files
    .filter((file) => !isThirdParty(file))
    .map((file) => ({ file, counts: fileCounts(readFileSync(path.join(root, file)), words) }))
    .map((found) => ({ ...found, total: sum(found.counts) }))
    .filter((found) => found.total > 0)
    .sort((a, b) => b.total - a.total || (a.file < b.file ? -1 : 1));
}

const countsLine = (counts) => Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([what, n]) => `${n} × ${what}`).join(", ");

export function leakReport(found, { worst = 20 } = {}) {
  if (found.length === 0) return "no leaks: every file is clean";
  const folders = new Map();
  for (const { file, total } of found) {
    const folder = folders.get(folderOf(file)) ?? { files: 0, total: 0 };
    folders.set(folderOf(file), { files: folder.files + 1, total: folder.total + total });
  }
  const lines = [`${sum(Object.fromEntries(found.map((f) => [f.file, f.total])))} leaks in ${found.length} files`, "", "by folder:"];
  for (const [folder, { files, total }] of [...folders].sort((a, b) => b[1].total - a[1].total)) lines.push(`  ${String(total).padStart(6)}  ${folder} (${files} file${files === 1 ? "" : "s"})`);
  lines.push("", `worst ${Math.min(worst, found.length)} files:`);
  for (const { file, total, counts } of found.slice(0, worst)) lines.push(`  ${String(total).padStart(6)}  ${file}: ${countsLine(counts)}`);
  return lines.join("\n");
}

export function addedLeaks(root, files, { before, words = OWNER_WORDS, count = leakCounts }) {
  const problems = [];
  for (const file of files) {
    if (isThirdParty(file) || !statSync(path.join(root, file), { throwIfNoEntry: false })?.isFile()) continue;
    const after = fileCounts(readFileSync(path.join(root, file)), words, count);
    const prior = before(file);
    const was = prior === undefined ? {} : fileCounts(prior, words, count);
    const rose = Object.entries(after).filter(([what, n]) => n > (was[what] ?? 0)).map(([what, n]) => `${n - (was[what] ?? 0)} more × ${what}`);
    if (rose.length > 0) problems.push(`${file} adds ${rose.join(", ")}`);
  }
  return problems;
}

export async function libraryWords(root) {
  const connection = spawnSync(process.execPath, ["--import", "tsx", "packages/cli/src/bins/storytree.ts", "auth", "connection", "--database", "storytree_storytree"], { cwd: root, encoding: "utf8", timeout: 30_000 });
  const url = connection.stdout?.trim();
  if (connection.status !== 0 || !url) return { why: "the library's address could not be read" };
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const { rows } = await client.query("select name from invitations.invitation where name is not null");
    return { words: nameWords(rows.map((row) => row.name)) };
  } catch {
    return { why: "the library's invitations could not be read" };
  } finally {
    await client.end().catch(() => {});
  }
}

const git = (root, args, encoding = "utf8") => execFileSync("git", args, { cwd: root, encoding, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });

export function trackedFiles(root) {
  return git(root, ["ls-files", "-z"]).split("\0").filter(Boolean).filter((file) => existsSync(path.join(root, file)));
}

function branchChanges(root, check, error) {
  let files;
  let base;
  try {
    files = changedFiles(root);
    base = git(root, ["merge-base", "origin/main", "HEAD"]).trim();
  } catch (failure) {
    error(`${check}: the changes against origin/main could not be read (${String(failure.stderr ?? failure.message).trim().split("\n")[0]})`);
    return undefined;
  }
  const before = (file) => {
    try {
      return git(root, ["show", `${base}:${file}`], "buffer");
    } catch {
      return undefined;
    }
  };
  return { files, before };
}

export const SECRET_EXEMPTIONS = ".github/secret-check-exemptions.txt";

export function secretExemptions(root) {
  const file = path.join(root, SECRET_EXEMPTIONS);
  if (!existsSync(file)) return new Set();
  return new Set(readFileSync(file, "utf8").split(/\r?\n/).map((line) => line.replace(/#.*/, "").trim()).filter(Boolean));
}

export function checkSecrets({ root, log = console.log, error = console.error }) {
  const changes = branchChanges(root, "check:secrets", error);
  if (changes === undefined) return 1;
  const exempt = secretExemptions(root);
  const files = changes.files.filter((file) => !exempt.has(file));
  const problems = addedLeaks(root, files, { before: changes.before, words: [], count: credentialCounts });
  if (problems.length > 0) {
    error(`The branch adds what looks like a credential (the value is not shown). Take it out of the branch's history, and revoke it if it is real:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
    return 1;
  }
  const passed = changes.files.length - files.length;
  log(`${files.length} changed file${files.length === 1 ? "" : "s"}, none adding a credential${passed > 0 ? ` (${passed} on the owner's exemptions list passed over)` : ""}`);
  return 0;
}

export async function checkLeaks({ root, tree, readWords = libraryWords, log = console.log, error = console.error }) {
  const read = await readWords(root);
  const words = [...OWNER_WORDS, ...(read.words ?? [])];
  if (read.words === undefined) log(`Note: private names not checked: ${read.why} (CI cannot read them).`);
  if (tree !== undefined) {
    const found = scanTree(tree, trackedFiles(tree), words);
    log(leakReport(found));
    return found.length > 0 ? 1 : 0;
  }
  const changes = branchChanges(root, "check:leaks", error);
  if (changes === undefined) return 1;
  const { files, before } = changes;
  const problems = addedLeaks(root, files, { before, words });
  if (problems.length > 0) {
    error(`The branch adds personal paths, names, addresses or links a public repository must not hold:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
    return 1;
  }
  log(`${files.length} changed file${files.length === 1 ? "" : "s"}, none adding a leak`);
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  process.exitCode = args[0] === "--secrets" ? checkSecrets({ root }) : await checkLeaks({ root, tree: args[0] === "--tree" ? path.resolve(args[1] ?? root) : undefined });
}
