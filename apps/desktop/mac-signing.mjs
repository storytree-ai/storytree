// The Mac build's signing mode, chosen from the release's signing secrets (contract 4.20). Without a
// Developer ID certificate (CSC_LINK) the build is ad-hoc signed, as every pull request's is. With one,
// Apple's notarisation key must come too: a signed but un-notarised app is still refused by Gatekeeper.
// The repository is public, so nothing here prints a secret's value, only the names of missing ones.
//
// The release workflow's macOS job runs `prepare` before desktop:dist and `cleanup` at its end:
// prepare imports the certificate into a temporary keychain, writes Apple's key to a file for notarytool
// and exports STORYTREE_MAC_IDENTITY (tools.mjs signs the payload with it); with no certificate it does nothing.
// cleanup deletes the keychain and the key file.
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

/** The Developer ID Application identity `security find-identity -v -p codesigning` lists, by its SHA-1. */
export function identityFrom(listing) {
  const match = /^\s*\d+\)\s+([0-9A-F]{40})\s+"Developer ID Application: [^"]+"/m.exec(listing);
  if (!match) throw new Error("No Developer ID Application identity in the signing keychain");
  return match[1];
}

/** The release page's sentence about the Mac build. */
export function macReleaseNote(signed) {
  return signed
    ? "The macOS (Apple Silicon) zip and dmg are built on the same commit, signed with storytree's Developer ID and notarised by Apple."
    : "The macOS (Apple Silicon) zip and dmg are built and ad-hoc signed on the same commit, but not yet notarised: macOS refuses to open them until a release that is.";
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
  const appleKey = path.join(process.env.RUNNER_TEMP, `AuthKey_${env.APPLE_API_KEY_ID}.p8`);
  writeFileSync(appleKey, env.APPLE_API_KEY, { mode: 0o600 });
  // electron-builder's notarisation reads APPLE_API_KEY as the key file's path.
  appendFileSync(process.env.GITHUB_ENV, `STORYTREE_MAC_IDENTITY=${identity}\nAPPLE_API_KEY=${appleKey}\n`);
  console.log(`Developer ID identity ${identity} is in a temporary keychain; the Mac build is signed and notarised.`);
}

function cleanup() {
  if (existsSync(keychainPath())) execFileSync("security", ["delete-keychain", keychainPath()]);
  // prepare exported APPLE_API_KEY as the key file's path; with no certificate it is unset.
  if (process.env.APPLE_API_KEY) rmSync(process.env.APPLE_API_KEY, { force: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "prepare") prepare(process.env);
  else if (process.argv[2] === "cleanup") cleanup();
  else throw new Error("Use prepare or cleanup");
}
