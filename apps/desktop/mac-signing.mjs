// The Mac build's signing mode, chosen from the release's signing secrets (contract 4.20). Without a
// Developer ID certificate (CSC_LINK) the build is ad-hoc signed, as every pull request's is. With one,
// Apple's notarisation key must come too: a signed but un-notarised app is still refused by Gatekeeper.
// The repository is public, so nothing here prints a secret's value, only the names of missing ones.
//
// The certificate and Apple's key reach only jobs that install nothing (release-package.yml): this file and the ones it
// imports use node's built-ins and Apple's tools alone. `mode` (a job of its own) says which mode the secrets give, so the
// package job, which holds none, builds the app ad-hoc but records that mode in its archive, which no later step can
// change. The signing job then runs `prepare` (the certificate into a temporary keychain, Apple's key into a file,
// STORYTREE_MAC_IDENTITY exported), `sign` (the app re-signed inside-out, notarised and stapled, zipped again and its
// update feed and delivery entry rewritten) and `cleanup` (the keychain and the key file deleted). Apple's answer is
// waited for only until a bound, so a release never waits on Apple; a build Apple has not accepted by then ships signed
// but not notarised, and its release note says so. `blockmap` (the install check's job, which has the install and no
// secret) writes the signed zip's blockmap with electron-builder's own code. `history` prints Apple's answers to past
// submissions (the notary workflow), and one submission's log when given its id.
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createHash } from "node:crypto";
import { appendFileSync, closeSync, existsSync, lstatSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { macDeliveryAssets } from "./delivery-assets.mjs";

const APPLE = ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"];

/** Ad-hoc ("-", no keychain, no notarisation) without a certificate; Developer ID with one and Apple's key. */
export function macSigning(env) {
  if (!env.CSC_LINK) return { mode: "ad-hoc", identity: "-", keychain: false, notarize: false };
  const missing = APPLE.filter((name) => !env[name]);
  if (missing.length > 0) throw new Error(`CSC_LINK is set but ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not: a Developer ID build that is not notarised is still blocked by Gatekeeper`);
  return { mode: "developer-id", keychain: true, notarize: true };
}

/** The environment electron-builder builds the Mac app in: ad-hoc whatever the secrets, which the signing job alone uses,
 * so no certificate variable at all. CSC_FOR_PULL_REQUEST: electron-builder skips signing a pull request's build by
 * default, and Apple Silicon runs no unsigned code. */
export function builderEnv(env) {
  return { ...unsignedEnv(env), CSC_FOR_PULL_REQUEST: "true" };
}

/** The signing mode the packaged app records (updates 4.21: only a Developer ID build follows releases), as the `mode`
 * job read it from the secrets: ad-hoc when the build is not told one, as on a developer's machine. */
export function packagedSigning(value) {
  if (value === undefined) return "ad-hoc";
  if (value === "ad-hoc" || value === "developer-id") return value;
  throw new Error("STORYTREE_MAC_SIGNING is neither ad-hoc nor developer-id: the job that reads the signing secrets gave no mode");
}

/** The environment an unsigned build (Windows, Linux, an ad-hoc Mac) runs electron-builder in: no certificate
 * variable at all (CSC_*, WIN_CSC_*), so neither electron-builder nor anything it loads holds a signing secret. */
export function unsignedEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !/^(WIN_)?CSC_/.test(name)));
}

/** Submits the build and asks Apple for its answer every pollMs until waitMs has passed. Only "Accepted" is
 * notarised, and its ticket is then stapled to the app, so Gatekeeper accepts it offline; a ticket that will not
 * staple leaves it notarised, Gatekeeper asking Apple online. "In Progress" at the bound, or a refusal ("Invalid",
 * "Rejected"), leaves the build signed but not notarised. A later acceptance of the same submission still
 * notarises this very build, unstapled: Gatekeeper asks Apple online. */
export async function notarise({ submit, info, staple, sleep, now, waitMs, pollMs }) {
  const id = submit();
  const deadline = now() + waitMs;
  let status = info(id);
  while (status === "In Progress" && now() < deadline) {
    await sleep(pollMs);
    status = info(id);
  }
  const notarised = status === "Accepted";
  return { id, status, notarised, stapled: notarised && staple() };
}

/** Why the install check skips Gatekeeper's assessment, or undefined when it runs: Gatekeeper refuses an ad-hoc build and a
 * Developer ID build Apple had not accepted by the bound ("Unnotarized Developer ID", rehearsal run 38635048881), and
 * both ship by design, so only a notarised build is asked. answer is release/mac-notarisation.json, absent for ad-hoc. */
export function gatekeeperSkip({ adHoc, answer }) {
  if (adHoc) return "the app is ad-hoc signed, so not notarised";
  if (answer && !answer.notarised) return `Apple's answer to submission ${answer.id} was "${answer.status}" at the bound, so the build ships signed but not notarised`;
  return undefined;
}

/** Why the install check skips `stapler validate`, or undefined when it runs: only a notarised build whose ticket was
 * stapled carries one. answer is release/mac-notarisation.json, absent for ad-hoc. */
export function staplerSkip({ adHoc, answer }) {
  const unasked = gatekeeperSkip({ adHoc, answer });
  if (unasked) return unasked;
  if (answer && !answer.stapled) return `Apple accepted submission ${answer.id} but its ticket did not staple, so Gatekeeper confirms it online`;
  return undefined;
}

/** Apple's submission history as one line per submission: id, date and status, nothing else it returned. */
export function historyLines(json) {
  const { history } = JSON.parse(json);
  if (history.length === 0) return ["No submissions."];
  return history.map((entry) => `${entry.id}  ${entry.createdDate}  ${entry.status}`);
}

/** The line `history` prints for a submission Apple has not yet answered, whose log notarytool cannot give yet; null once it has. */
export function pendingLine(id, status) {
  return status === "In Progress" ? `Submission ${id} is still In Progress: Apple's log for it comes once Apple answers.` : null;
}

/** The Developer ID Application identity `security find-identity -v -p codesigning` lists, by its SHA-1. */
export function identityFrom(listing) {
  const match = /^\s*\d+\)\s+([0-9A-F]{40})\s+"Developer ID Application: [^"]+"/m.exec(listing);
  if (!match) throw new Error("No Developer ID Application identity in the signing keychain");
  return match[1];
}

const MAC_NOTES = {
  "ad-hoc": "The macOS (Apple Silicon) zip is built and ad-hoc signed on the same commit, but not yet notarised: macOS refuses to open it until a release that is.",
  notarised: "The macOS (Apple Silicon) zip is built on the same commit, signed with storytree's Developer ID and notarised by Apple.",
  pending: "The macOS (Apple Silicon) zip is built on the same commit and signed with storytree's Developer ID, but not yet notarised: Apple had not accepted it when this release was made, and macOS opens it once Apple does.",
};

/** The release page's sentence about the Mac build: "ad-hoc", "notarised" or "pending" (signed, Apple not yet accepted). */
export function macReleaseNote(mode) {
  return MAC_NOTES[mode];
}

/** The release page's text with its Mac sentence, whichever it was, replaced by the one for this mode. */
export function withMacNote(body, mode) {
  return Object.values(MAC_NOTES).reduce((text, note) => text.replace(note, macReleaseNote(mode)), body);
}

const BUNDLE = /\.(app|framework|xpc|appex|bundle)$/;

function isMachO(file) {
  const header = Buffer.alloc(4);
  const fd = openSync(file, "r");
  try { if (readSync(fd, header, 0, 4, 0) < 4) return false; } finally { closeSync(fd); }
  // 64-bit Mach-O in either byte order, or a universal (fat) binary.
  return [0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca].includes(header.readUInt32BE(0));
}

/** What codesign signs in the app, inside-out: each Mach-O file and nested bundle before the bundle holding it, the app
 * last. Links are skipped (a framework's Versions/Current and its top-level links name what is signed through them). */
export function signingOrder(app) {
  const found = [];
  // A bundle is listed after everything under it, as the walk leaves it.
  const visit = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const item = path.join(folder, entry.name);
      if (lstatSync(item).isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        visit(item);
        if (BUNDLE.test(entry.name)) found.push(item);
      } else if (entry.isFile() && isMachO(item)) found.push(item);
    }
  };
  visit(app);
  return [...found, app];
}

/** Rewrites the tool payload's manifest with its files' digests as signed: the app checks them before it hands out its
 * tools (verifyPayload), and signing rewrites each binary. */
function refreshPayload(app) {
  const dir = path.join(app, "Contents", "Resources", "agent-tools");
  const manifest = path.join(dir, "payload.json");
  if (!existsSync(manifest)) return;
  const payload = JSON.parse(readFileSync(manifest, "utf8"));
  for (const name of Object.keys(payload.files)) payload.files[name] = createHash("sha256").update(readFileSync(path.join(dir, name))).digest("hex");
  writeFileSync(manifest, JSON.stringify(payload, null, 2) + "\n");
}

/** Signs the app as identity ("-" for ad-hoc) inside-out, with the hardened runtime and the app's entitlements, as
 * notarisation requires of every binary, and a secure timestamp for a Developer ID; the tool payload's manifest is
 * rewritten before the app's own signature seals it. */
export function signApp(app, identity, entitlements, codesign = (args) => execFileSync("codesign", args, { stdio: "inherit" })) {
  const order = signingOrder(app);
  const sign = (item) => codesign(["--force", "--sign", identity, "--options", "runtime", "--entitlements", entitlements, ...(identity === "-" ? [] : ["--timestamp"]), item]);
  for (const item of order.slice(0, -1)) sign(item);
  refreshPayload(app);
  sign(app);
}

/** latest-mac.yml naming the re-made zip: each sha512 and size line rewritten, nothing else. */
export function withZipDigest(feed, sha512, size) {
  if (!/^\s*sha512: /m.test(feed) || !/^\s*size: /m.test(feed)) throw new Error("latest-mac.yml names no zip digest and size");
  return feed.replace(/^(\s*sha512: ).*$/gm, `$1${sha512}`).replace(/^(\s*size: ).*$/gm, `$1${size}`);
}

function notarytool(env, ...args) {
  return execFileSync("xcrun", ["notarytool", ...args, "--key", env.APPLE_API_KEY, "--key-id", env.APPLE_API_KEY_ID, "--issuer", env.APPLE_API_ISSUER, "--output-format", "json"], { encoding: "utf8" });
}

/** Notarises a Developer ID build's signed .app within the bound, submitted as a zip of it, and staples the ticket
 * to the app once Apple accepts; Apple's answer is written to outcomeFile for the upload. */
export async function notariseApp(app, outcomeFile, env = process.env) {
  const submitted = mkdtempSync(path.join(tmpdir(), "storytree-notarise-"));
  const zip = path.join(submitted, `${path.basename(app)}.zip`);
  let outcome;
  try {
    execFileSync("ditto", ["-c", "-k", "--keepParent", app, zip]);
    outcome = await notarise({
      submit: () => JSON.parse(notarytool(env, "submit", zip)).id,
      info: (id) => JSON.parse(notarytool(env, "info", id)).status,
      staple: () => spawnSync("xcrun", ["stapler", "staple", app], { stdio: "inherit" }).status === 0,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
      waitMs: 10 * 60_000,
      pollMs: 30_000,
    });
  } finally {
    rmSync(submitted, { recursive: true, force: true });
  }
  writeFileSync(outcomeFile, JSON.stringify(outcome) + "\n");
  if (outcome.stapled) console.log(`Apple notarised submission ${outcome.id}; its ticket is stapled to the app.`);
  else if (outcome.notarised) console.log(`::warning::Apple notarised submission ${outcome.id} but its ticket did not staple: Gatekeeper confirms the Mac build online.`);
  else console.log(`::warning::Apple's answer to submission ${outcome.id} is "${outcome.status}": the Mac build ships signed but not notarised. Read it with the notary workflow.`);
  return outcome;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const MAC_ZIP = /^storytree-0\.3-(\d+\.\d+\.\d+)-mac-arm64\.zip$/;

function releaseZip(release) {
  const name = readdirSync(release).find((file) => MAC_ZIP.test(file));
  if (!name) throw new Error("No Mac zip in the release folder");
  return { name, version: MAC_ZIP.exec(name)[1], file: path.join(release, name) };
}

/** The signing job's work on the package job's unsigned build: re-sign, notarise and staple a Developer ID build, zip
 * it again as electron-builder does (symlinks kept), and rewrite the update feed and the delivery entry for that zip.
 * The zip's old blockmap is removed; the install check's job writes the new one. */
export async function signRelease(env, release = path.join(here, "release"), codesign = undefined) {
  const app = path.join(release, "mac-arm64", "storytree-0.3.app");
  const mode = packagedSigning(env.STORYTREE_MAC_SIGNING);
  if (mode === "developer-id" && !env.STORYTREE_MAC_IDENTITY) throw new Error("STORYTREE_MAC_IDENTITY is not set: run `node apps/desktop/mac-signing.mjs prepare` before signing");
  signApp(app, mode === "developer-id" ? env.STORYTREE_MAC_IDENTITY : "-", path.join(here, "entitlements.mac.plist"), codesign);
  if (mode === "developer-id") await notariseApp(app, path.join(release, "mac-notarisation.json"), env);
  const zip = releaseZip(release);
  rmSync(zip.file, { force: true });
  rmSync(`${zip.file}.blockmap`, { force: true });
  execFileSync("zip", ["-q", "-r", "-y", "-7", zip.file, path.basename(app)], { cwd: path.dirname(app), stdio: "inherit" });
  const bytes = readFileSync(zip.file);
  const feed = path.join(release, "latest-mac.yml");
  writeFileSync(feed, withZipDigest(readFileSync(feed, "utf8"), createHash("sha512").update(bytes).digest("base64"), bytes.length));
  macDeliveryAssets(release, zip.version);
  console.log(`Signed ${mode === "developer-id" ? `as ${env.STORYTREE_MAC_IDENTITY}` : "ad-hoc"} and zipped again as ${zip.name}.`);
}

/** The signed zip's blockmap, built by electron-builder's own code so it matches every earlier release's for
 * differential updates; it also checks the update feed names the zip as it is. */
async function blockmap() {
  const release = path.join(here, "release");
  const zip = releaseZip(release);
  const builder = createRequire(createRequire(import.meta.url).resolve("electron-builder"));
  const { buildBlockMap } = builder("app-builder-lib/out/targets/blockmap/blockmap");
  const { sha512, size } = await buildBlockMap(zip.file, "gzip", `${zip.file}.blockmap`);
  const feed = readFileSync(path.join(release, "latest-mac.yml"), "utf8");
  if (withZipDigest(feed, sha512, size) !== feed) throw new Error("latest-mac.yml does not name the signed zip's sha512 and size");
  console.log(`Wrote ${zip.name}.blockmap.`);
}

function keychainPath() {
  return path.join(process.env.RUNNER_TEMP, "storytree-signing.keychain-db");
}

function prepare(env) {
  if (!macSigning(env).keychain) return console.log("No Developer ID certificate: the Mac build is ad-hoc signed.");
  const security = (...args) => execFileSync("security", args, { encoding: "utf8" });
  const keychain = keychainPath();
  const password = randomBytes(24).toString("hex");
  const certificate = path.join(process.env.RUNNER_TEMP, "storytree-signing.p12");
  writeFileSync(certificate, Buffer.from(env.CSC_LINK, "base64"), { mode: 0o600 });
  try {
    security("create-keychain", "-p", password, keychain);
    security("set-keychain-settings", "-lut", "21600", keychain);
    security("unlock-keychain", "-p", password, keychain);
    security("import", certificate, "-k", keychain, "-P", env.CSC_KEY_PASSWORD ?? "", "-T", "/usr/bin/codesign");
    security("set-key-partition-list", "-S", "apple-tool:,apple:", "-s", "-k", password, keychain);
    const searched = security("list-keychains", "-d", "user").split("\n").map((line) => line.trim().replace(/^"|"$/g, "")).filter(Boolean);
    security("list-keychains", "-d", "user", "-s", keychain, ...searched);
  } finally {
    rmSync(certificate, { force: true });
  }
  const identity = identityFrom(security("find-identity", "-v", "-p", "codesigning", keychain));
  const appleKey = writeAppleKey(env);
  // Notarisation (notariseApp) reads APPLE_API_KEY as the key file's path.
  appendFileSync(process.env.GITHUB_ENV, `STORYTREE_MAC_IDENTITY=${identity}\nAPPLE_API_KEY=${appleKey}\n`);
  console.log(`Developer ID identity ${identity} is in a temporary keychain; the Mac build is signed and notarised.`);
}

function writeAppleKey(env) {
  const appleKey = path.join(process.env.RUNNER_TEMP, `AuthKey_${env.APPLE_API_KEY_ID}.p8`);
  writeFileSync(appleKey, env.APPLE_API_KEY, { mode: 0o600 });
  return appleKey;
}

/** Apple's answers to past submissions; with a submission id, also that submission's status and what Apple objected to,
 * or that it is still pending. */
function history(env, submission) {
  if (submission && !/^[0-9a-f-]{36}$/i.test(submission)) throw new Error("A submission id is a UUID");
  const keyed = { ...env, APPLE_API_KEY: writeAppleKey(env) };
  try {
    for (const line of historyLines(notarytool(keyed, "history"))) console.log(line);
    const pending = submission && pendingLine(submission, JSON.parse(notarytool(keyed, "info", submission)).status);
    if (pending) console.log(pending);
    else if (submission) {
      const { status, statusSummary, issues } = JSON.parse(notarytool(keyed, "log", submission));
      console.log(JSON.stringify({ status, statusSummary, issues: issues ?? [] }, null, 2));
    }
  } finally {
    rmSync(keyed.APPLE_API_KEY, { force: true });
  }
}

function cleanup() {
  if (existsSync(keychainPath())) execFileSync("security", ["delete-keychain", keychainPath()]);
  // prepare exported APPLE_API_KEY as the key file's path; with no certificate it is unset.
  if (process.env.APPLE_API_KEY) rmSync(process.env.APPLE_API_KEY, { force: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "mode") appendFileSync(process.env.GITHUB_OUTPUT, `mode=${macSigning(process.env).mode}\n`);
  else if (process.argv[2] === "prepare") prepare(process.env);
  else if (process.argv[2] === "sign") await signRelease(process.env);
  else if (process.argv[2] === "blockmap") await blockmap();
  else if (process.argv[2] === "cleanup") cleanup();
  else if (process.argv[2] === "history") history(process.env, process.env.NOTARY_SUBMISSION);
  else throw new Error("Use mode, prepare, sign, blockmap, cleanup or history");
}
