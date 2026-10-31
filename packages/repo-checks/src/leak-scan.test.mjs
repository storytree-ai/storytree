import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { deflateRawSync, gzipSync } from "node:zlib";

import { removeTemp } from "@storytree/test-waits";

import { addedLeaks, checkLeaks, checkSecrets, credentialCounts, fileCounts, leakReport, nameWords, scanTree, SECRET_EXEMPTIONS } from "./leak-scan.mjs";

// Each leak is put together at run time, so this file holds none of them for the scan to find.
const join = (...parts) => parts.join("");
const LEAKS = {
  "a link to a claude.ai artifact, code session or share": join("https://claude", ".ai/share/", "abc123"),
  "a Google Drive or Docs link": join("https://docs", ".google.com/document/d/", "xyz"),
  "an email address": join("jo.bloggs", "@", "mailbox.com"),
  "a user@host": join("jo", "@", "win", "lap"),
  "a Windows home folder": join("C:", "\\", "Users", "\\", "jobloggs", "\\code"),
  "a Linux home folder": join("/", "home", "/", "jobloggs", "/code"),
  "a tailnet name": ["box", "tail9f3k2", "ts", "net"].join("."),
  "a machine name": join("ran on ", "win", "lap", " today"),
  "a tailnet address": ["100", "101", "2", "3"].join("."),
  "the cloud project id": join("storytree", "-", "123456"),
};
const WORDS = [...nameWords(["Zorbo"]), { what: "the owner's username", hash: createHash("sha256").update("quux").digest("hex"), length: 4, exact: false }];
const CLEAN = `${join("/", "home", "/", "runner", "/work")} (${join("/", "home", "/", "me")}), ${join("C:", "\\", "Users", "\\", "dev")} ${join("someone", "@", "example.com")} ${["box", "tail0000", "ts", "net"].join(".")} the tailnet range ${["100", "64", "0", "0"].join(".")}/10, the zorbo word, lower case\n`;

const utf16 = (text) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);

function zip(name, body) {
  const data = deflateRawSync(body);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(body.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(body.length, 24);
  central.writeUInt16LE(name.length, 28);
  const entries = Buffer.concat([local, Buffer.from(name), data]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + name.length, 12);
  end.writeUInt32LE(entries.length, 16);
  return Buffer.concat([entries, central, Buffer.from(name), end]);
}

/** A tar archive of the entries given, in order. */
function tar(...entries) {
  const parts = entries.flatMap(([name, body]) => {
    const header = Buffer.alloc(512);
    header.write(name, 0);
    header.write(body.length.toString(8).padStart(11, "0"), 124);
    header.write("ustar", 257);
    return [header, body, Buffer.alloc(512 - (body.length % 512))];
  });
  return Buffer.concat([...parts, Buffer.alloc(1024)]);
}

test("1.1 · the leak scan finds each personal path, name, address and link in a plain, gzipped or UTF-16 file, or as JSON inside a zip or tar archive, and passes a clean file", () => {
  for (const [what, leak] of Object.entries(LEAKS)) {
    const json = Buffer.from(JSON.stringify({ note: leak }));
    for (const [form, bytes] of Object.entries({ plain: Buffer.from(`x ${leak} y\n`), gzip: gzipSync(`x ${leak} y\n`), utf16: utf16(`x ${leak} y\n`), "utf16 unmarked": Buffer.from(`x ${leak} y\n`, "utf16le"), zip: zip("a.json", json), "tar.gz": gzipSync(tar(["readme.txt", Buffer.from("x".repeat(700))], ["a.json", json])) })) {
      assert.ok((fileCounts(bytes, WORDS)[what] ?? 0) >= 1, `${what} as ${form}: ${JSON.stringify(fileCounts(bytes, WORDS))}`);
    }
  }
  for (const [what, word] of [["a private name", "Zorbo"], ["the owner's username", "QUUX"]]) {
    for (const bytes of [Buffer.from(`said ${word}.`), gzipSync(`said ${word}.`), utf16(`said ${word}.`)]) assert.equal(fileCounts(bytes, WORDS)[what], 1, what);
  }
  for (const bytes of [Buffer.from(CLEAN), gzipSync(CLEAN), utf16(CLEAN), zip("a.txt", Buffer.from(CLEAN))]) assert.deepEqual(fileCounts(bytes, WORDS), {});
  assert.deepEqual(fileCounts(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0x0d, ...Buffer.from(LEAKS["a Linux home folder"])]), WORDS), {}, "a picture is not read as text");
});

test("1.2 · the leak scan reports a tree's leaks by folder and its worst files without the matched text, and the gate's check refuses only a file whose count of a pattern rises against the merge base", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "leak-scan-"));
  t.after(() => removeTemp(root));
  const files = {
    "packages/a/src/old.ts": `${LEAKS["a Linux home folder"]}\n`,
    "packages/a/src/more.ts": `${LEAKS["a Linux home folder"]}\n${LEAKS["a Linux home folder"]}\nZorbo\n`,
    "docs/new.md": `${LEAKS["a tailnet address"]}\n`,
    "README.md": CLEAN,
  };
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), body);
  }
  const found = scanTree(root, Object.keys(files), WORDS);
  assert.deepEqual(found.map((f) => [f.file, f.total]), [["packages/a/src/more.ts", 3], ["docs/new.md", 1], ["packages/a/src/old.ts", 1]]);
  const report = leakReport(found);
  assert.match(report, /5 leaks in 3 files/);
  assert.match(report, /4 {2}packages\/a \(2 files\)/);
  assert.match(report, /packages\/a\/src\/more\.ts: 2 × a Linux home folder, 1 × a private name/);
  for (const leak of [...Object.values(LEAKS), "Zorbo"].filter((leak) => files["packages/a/src/more.ts"].includes(leak) || files["docs/new.md"].includes(leak))) assert.ok(!report.includes(leak), "the report never quotes a leak");
  const base = { "packages/a/src/old.ts": Buffer.from(files["packages/a/src/old.ts"]), "packages/a/src/more.ts": Buffer.from(`${LEAKS["a Linux home folder"]}\n`), "README.md": Buffer.from("") };
  const problems = addedLeaks(root, [...Object.keys(files), "packages/gone.ts"], { before: (file) => base[file], words: WORDS });
  assert.deepEqual(problems, ["packages/a/src/more.ts adds 1 more × a Linux home folder, 1 more × a private name", "docs/new.md adds 1 more × a tailnet address"]);
});

test("1.3 · check:leaks refuses a branch that adds a leak or a private name to a file, against origin/main, says when the private names could not be read, and passes a clean branch", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "leak-check-"));
  t.after(() => removeTemp(root));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q");
  git("config", "user.name", "t");
  git("config", "user.email", "t@example.com");
  writeFileSync(path.join(root, "old.md"), `${LEAKS["a tailnet address"]}\n`);
  git("add", ".");
  git("commit", "-q", "-m", "main");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  writeFileSync(path.join(root, "old.md"), `${LEAKS["a tailnet address"]}\nmore words\n`);
  const lines = [];
  const capture = { log: (line) => lines.push(line), error: (line) => lines.push(line) };
  const named = async () => ({ words: nameWords(["Zorbo"]) });
  assert.equal(await checkLeaks({ root, readWords: named, ...capture }), 0, lines.join("\n"));
  writeFileSync(path.join(root, "new.md"), "Zorbo was here\n");
  assert.equal(await checkLeaks({ root, readWords: named, ...capture }), 1);
  assert.match(lines.at(-1), /new\.md adds 1 more × a private name/);
  assert.equal(await checkLeaks({ root, readWords: async () => ({ why: "the library is out of reach" }), ...capture }), 0);
  assert.match(lines.join("\n"), /private names not checked: the library is out of reach/);
  assert.equal(await checkLeaks({ root, tree: root, readWords: named, ...capture }), 1, "a tree with a leak fails its report");
  assert.match(lines.at(-1), /1 leaks in 1 files/, "only tracked files are the tree");
  git("update-ref", "-d", "refs/remotes/origin/main");
  assert.equal(await checkLeaks({ root, readWords: named, ...capture }), 1, "a branch whose changes cannot be read fails");
  assert.match(lines.at(-1), /could not be read \(fatal: /);
  const clean = mkdtempSync(path.join(tmpdir(), "leak-tree-"));
  t.after(() => removeTemp(clean));
  execFileSync("git", ["init", "-q"], { cwd: clean });
  writeFileSync(path.join(clean, "a.md"), CLEAN);
  execFileSync("git", ["add", "."], { cwd: clean });
  assert.equal(await checkLeaks({ root, tree: clean, readWords: named, ...capture }), 0);
  assert.match(lines.at(-1), /no leaks/);
});

test("1.3 · check:leaks reads a branch holding an untracked folder, catching a leak in an ordinary folder's files and passing over a nested repository git lists as one folder", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "leak-folder-"));
  t.after(() => removeTemp(root));
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git(root, "init", "-q");
  git(root, "config", "user.name", "t");
  git(root, "config", "user.email", "t@example.com");
  writeFileSync(path.join(root, "old.md"), CLEAN);
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "main");
  git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
  mkdirSync(path.join(root, "tmp", "nested"), { recursive: true });
  git(path.join(root, "tmp", "nested"), "init", "-q");
  writeFileSync(path.join(root, "tmp", "nested", "notes.md"), "Zorbo was here\n");
  const lines = [];
  const capture = { log: (line) => lines.push(line), error: (line) => lines.push(line) };
  const named = async () => ({ words: nameWords(["Zorbo"]) });
  assert.equal(await checkLeaks({ root, readWords: named, ...capture }), 0, lines.join("\n"));
  mkdirSync(path.join(root, "drafts"));
  writeFileSync(path.join(root, "drafts", "new.md"), "Zorbo was here\n");
  assert.equal(await checkLeaks({ root, readWords: named, ...capture }), 1);
  assert.match(lines.at(-1), /drafts\/new\.md adds 1 more × a private name/);
});

// Each stand-in credential is put together at run time too, so this file holds no credential's shape.
const CREDENTIALS = {
  "a private key": join("-----BEGIN ", "OPENSSH PRIVATE", " KEY-----\nb3Blbn\n-----END ", "OPENSSH PRIVATE", " KEY-----"),
  "a bearer token": join("Authorization: Bear", "er ", "q".repeat(32)),
  "an OAuth token": join("ya", "29.", "a".repeat(40)),
  "an Anthropic or OpenAI key": join("sk-", "ant-", "api03-", "b".repeat(40)),
  "a GitHub token": join("gh", "p_", "c".repeat(36)),
  "a Google API key": join("AI", "za", "d".repeat(35)),
  "a Google OAuth client secret": join("GOC", "SPX-", "e".repeat(28)),
  "an AWS access key": join("AK", "IA", "F".repeat(16)),
  "a Slack token": join("xo", "xb-", "1".repeat(12)),
  "a GitLab token": join("gl", "pat-", "g".repeat(20)),
  "a Tailscale key": join("ts", "key-", "auth-", "h".repeat(24)),
  "a password in a link": join("postgres", "://ci:", "Zx9", "qPw", "@db.internal:5432/x"),
};
const FINE_GRAINED = join("github", "_pat_", "i".repeat(60));
const STAND_INS = `${join("postgres", "://u:", "${password}", "@h")} ${join("postgres", "://u:", "<password>", "@h")} ${join("postgres", "://u:", "password", "@h")} Bearer \${token} ${join("sk-", "short")}\n`;

test("1.4 · the secret scan finds each credential's shape in a plain, gzipped or UTF-16 file, or inside a zip or tar archive, by its kind, and passes a link's placeholder password", () => {
  for (const [what, credential] of Object.entries(CREDENTIALS)) {
    const json = Buffer.from(JSON.stringify({ env: credential }));
    for (const [form, bytes] of Object.entries({ plain: Buffer.from(`x ${credential} y\n`), gzip: gzipSync(`x ${credential} y\n`), utf16: utf16(`x ${credential} y\n`), "utf16 unmarked": Buffer.from(`x ${credential} y\n`, "utf16le"), zip: zip("a.json", json), "tar.gz": gzipSync(tar(["a.json", json])) })) {
      assert.deepEqual(fileCounts(bytes, [], credentialCounts), { [what]: 1 }, `${what} as ${form}`);
    }
  }
  assert.deepEqual(credentialCounts(FINE_GRAINED), { "a GitHub token": 1 });
  assert.deepEqual(credentialCounts(STAND_INS), {});
  assert.deepEqual(fileCounts(Buffer.from(CREDENTIALS["a GitHub token"])), {}, "the leak scan's own count holds no credential, so check:leaks never fails on one");
});

test("1.5 · check:secrets refuses a branch that adds a credential, even inside gzip or UTF-16 evidence, naming the file and kind but never the value, passes a file on the owner's exemptions list, and passes a clean branch", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "secret-check-"));
  t.after(() => removeTemp(root));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q");
  git("config", "user.name", "t");
  git("config", "user.email", "t@example.com");
  writeFileSync(path.join(root, "old.md"), `${CREDENTIALS["a Tailscale key"]}\n`);
  git("add", ".");
  git("commit", "-q", "-m", "main");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  const lines = [];
  const capture = { log: (line) => lines.push(line), error: (line) => lines.push(line) };
  writeFileSync(path.join(root, "old.md"), `${CREDENTIALS["a Tailscale key"]}\nmore words ${STAND_INS}`);
  assert.equal(checkSecrets({ root, ...capture }), 0, "a credential already on main is not the branch's");
  assert.match(lines.at(-1), /1 changed file, none adding a credential/);
  mkdirSync(path.join(root, "evidence"));
  writeFileSync(path.join(root, "evidence", "run.json.gz"), gzipSync(JSON.stringify({ env: CREDENTIALS["a Google API key"] })));
  writeFileSync(path.join(root, "evidence", "log.txt"), utf16(`token ${CREDENTIALS["an Anthropic or OpenAI key"]}\n`));
  assert.equal(checkSecrets({ root, ...capture }), 1);
  const said = lines.at(-1);
  assert.match(said, /evidence\/run\.json\.gz adds 1 more × a Google API key/);
  assert.match(said, /evidence\/log\.txt adds 1 more × an Anthropic or OpenAI key/);
  for (const credential of Object.values(CREDENTIALS)) assert.ok(!said.includes(credential) && !said.includes(credential.slice(4, 16)), "the refusal never quotes a value");
  mkdirSync(path.join(root, ".github"));
  writeFileSync(path.join(root, SECRET_EXEMPTIONS), "# stand-in keys a test reads\nevidence/run.json.gz\n  evidence/log.txt  # a captured stand-in\n");
  assert.equal(checkSecrets({ root, ...capture }), 0, lines.at(-1));
  assert.match(lines.at(-1), /2 on the owner's exemptions list passed over/);
  git("update-ref", "-d", "refs/remotes/origin/main");
  assert.equal(checkSecrets({ root, ...capture }), 1, "a branch whose changes cannot be read fails");
  assert.match(lines.at(-1), /check:secrets: the changes against origin\/main could not be read/);
});
