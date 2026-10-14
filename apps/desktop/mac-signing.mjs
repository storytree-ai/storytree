// The Mac build's signing mode, chosen from the release's signing secrets (contract 4.20). Without a
// Developer ID certificate (CSC_LINK) the build is ad-hoc signed, as every pull request's is. With one,
// Apple's notarisation key must come too: a signed but un-notarised app is still refused by Gatekeeper.
// The repository is public, so nothing here prints a secret's value, only the names of missing ones.
//
// The release workflow's macOS job runs `prepare` before desktop:dist and `cleanup` at its end:
// prepare imports the certificate into a temporary keychain, writes Apple's key to a file for notarytool
// and exports STORYTREE_MAC_IDENTITY (tools.mjs signs the payload with it); with no certificate it does nothing.
// cleanup deletes the keychain and the key file. Notarisation is ours, not electron-builder's (dist.mjs calls
// notariseApp): Apple's answer is waited for only until a bound, so a release never waits on Apple; a build Apple
// has not accepted by then ships signed but not notarised, and its release note says so. `history` prints
// Apple's answers to past submissions (the notary workflow), and one submission's log when given its id.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const APPLE = ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"];

/** Ad-hoc ("-", no keychain, no notarisation) without a certificate; Developer ID with one and Apple's key. */
export function macSigning(env) {
  if (!env.CSC_LINK) return { mode: "ad-hoc", identity: "-", keychain: false, notarize: false };
  const missing = APPLE.filter((name) => !env[name]);
  if (missing.length > 0) throw new Error(`CSC_LINK is set but ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not: a Developer ID build that is not notarised is still blocked by Gatekeeper`);
  return { mode: "developer-id", keychain: true, notarize: true };
}

/** The environment electron-builder builds in, never with CSC_LINK or CSC_KEY_PASSWORD. Ad-hoc: the release passes
 * an absent secret as "" and electron-builder would read an empty CSC_LINK as a certificate path. Developer ID:
 * given the certificate, electron-builder imports it into a keychain of its own and unlocks that with the
 * certificate's password, which macOS refuses; so it gets CSC_NAME, the identity prepare put in our keychain.
 * Both set CSC_FOR_PULL_REQUEST: electron-builder skips signing a pull request's build by default, and Apple Silicon
 * runs no unsigned code. A fork's pull request gets no secrets, so it is ad-hoc and holds none to leak. */
export function builderEnv(env) {
  const { CSC_LINK, CSC_KEY_PASSWORD, ...rest } = env;
  const signed = { ...rest, CSC_FOR_PULL_REQUEST: "true" };
  if (macSigning(env).mode === "ad-hoc") return signed;
  if (!env.STORYTREE_MAC_IDENTITY) throw new Error("STORYTREE_MAC_IDENTITY is not set: run `node apps/desktop/mac-signing.mjs prepare` before a Developer ID build");
  return { ...signed, CSC_NAME: env.STORYTREE_MAC_IDENTITY };
}

/** electron-builder's Mac signing settings: it never notarises, because its notarytool wait has no bound and held
 * three releases until the job's limit cancelled them (0.3.1346, 0.3.1349, 0.3.1353). */
export function macBuilderConfig(signing) {
  return signing.mode === "ad-hoc" ? { identity: signing.identity, notarize: false } : { notarize: false };
}

/** Submits the build and asks Apple for its answer every pollMs until waitMs has passed. Only "Accepted" is
 * notarised; "In Progress" at the bound, or a refusal ("Invalid", "Rejected"), leaves the build signed but not
 * notarised. A later acceptance of the same submission still notarises this very build: Gatekeeper asks Apple online. */
export async function notarise({ submit, info, sleep, now, waitMs, pollMs }) {
  const id = submit();
  const deadline = now() + waitMs;
  let status = info(id);
  while (status === "In Progress" && now() < deadline) {
    await sleep(pollMs);
    status = info(id);
  }
  return { id, status, notarised: status === "Accepted" };
}

/** Why the install check skips Gatekeeper's assessment, or undefined when it runs: Gatekeeper refuses an ad-hoc build and a
 * Developer ID build Apple had not accepted by the bound ("Unnotarized Developer ID", rehearsal run 38635048881), and
 * both ship by design, so only a notarised build is asked. answer is release/mac-notarisation.json, absent for ad-hoc. */
export function gatekeeperSkip({ adHoc, answer }) {
  if (adHoc) return "the app is ad-hoc signed, so not notarised";
  if (answer && !answer.notarised) return `Apple's answer to submission ${answer.id} was "${answer.status}" at the bound, so the build ships signed but not notarised`;
  return undefined;
}

/** Apple's submission history as one line per submission: id, date and status, nothing else it returned. */
export function historyLines(json) {
  const { history } = JSON.parse(json);
  if (history.length === 0) return ["No submissions."];
  return history.map((entry) => `${entry.id}  ${entry.createdDate}  ${entry.status}`);
}

/** The Developer ID Application identity `security find-identity -v -p codesigning` lists, by its SHA-1. */
export function identityFrom(listing) {
  const match = /^\s*\d+\)\s+([0-9A-F]{40})\s+"Developer ID Application: [^"]+"/m.exec(listing);
  if (!match) throw new Error("No Developer ID Application identity in the signing keychain");
  return match[1];
}

const MAC_NOTES = {
  "ad-hoc": "The macOS (Apple Silicon) zip and dmg are built and ad-hoc signed on the same commit, but not yet notarised: macOS refuses to open them until a release that is.",
  notarised: "The macOS (Apple Silicon) zip and dmg are built on the same commit, signed with storytree's Developer ID and notarised by Apple.",
  pending: "The macOS (Apple Silicon) zip and dmg are built on the same commit and signed with storytree's Developer ID, but not yet notarised: Apple had not accepted them when this release was made, and macOS opens them once it does.",
};

/** The release page's sentence about the Mac build: "ad-hoc", "notarised" or "pending" (signed, Apple not yet accepted). */
export function macReleaseNote(mode) {
  return MAC_NOTES[mode];
}

/** The release page's text with its Mac sentence, whichever it was, replaced by the one for this mode. */
export function withMacNote(body, mode) {
  return Object.values(MAC_NOTES).reduce((text, note) => text.replace(note, macReleaseNote(mode)), body);
}

function notarytool(env, ...args) {
  return execFileSync("xcrun", ["notarytool", ...args, "--key", env.APPLE_API_KEY, "--key-id", env.APPLE_API_KEY_ID, "--issuer", env.APPLE_API_ISSUER, "--output-format", "json"], { encoding: "utf8" });
}

/** Notarises a Developer ID build's zip within the bound, writing Apple's answer beside it for the upload. */
export async function notariseApp(zip, outcomeFile, env = process.env) {
  const outcome = await notarise({
    submit: () => JSON.parse(notarytool(env, "submit", zip)).id,
    info: (id) => JSON.parse(notarytool(env, "info", id)).status,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    waitMs: 10 * 60_000,
    pollMs: 30_000,
  });
  writeFileSync(outcomeFile, JSON.stringify(outcome) + "\n");
  if (outcome.notarised) console.log(`Apple notarised submission ${outcome.id}.`);
  else console.log(`::warning::Apple's answer to submission ${outcome.id} is "${outcome.status}": the Mac build ships signed but not notarised. Read it with the notary workflow.`);
  return outcome;
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

/** Apple's answers to past submissions; with a submission id, also that submission's status and what Apple objected to. */
function history(env, submission) {
  if (submission && !/^[0-9a-f-]{36}$/i.test(submission)) throw new Error("A submission id is a UUID");
  const keyed = { ...env, APPLE_API_KEY: writeAppleKey(env) };
  try {
    for (const line of historyLines(notarytool(keyed, "history"))) console.log(line);
    if (submission) {
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
  if (process.argv[2] === "prepare") prepare(process.env);
  else if (process.argv[2] === "cleanup") cleanup();
  else if (process.argv[2] === "history") history(process.env, process.env.NOTARY_SUBMISSION);
  else throw new Error("Use prepare, cleanup or history");
}
