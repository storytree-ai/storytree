import assert from "node:assert/strict";
import { test } from "node:test";

// The release's macOS signing mode, chosen from the repository's signing secrets (apps/desktop's
// mac-signing.mjs): the release workflow and dist.mjs both follow it.
// @ts-expect-error: a plain .mjs packaging script, outside the typed source
import { identityFrom, macReleaseNote, macSigning } from "../mac-signing.mjs";

const apple = { APPLE_API_KEY: "-----BEGIN PRIVATE KEY-----", APPLE_API_KEY_ID: "KEY123", APPLE_API_ISSUER: "issuer-uuid" };
const listed = [
  '  1) 0123456789ABCDEF0123456789ABCDEF01234567 "Apple Development: Someone (AAAAAAAAAA)"',
  '  2) FEDCBA9876543210FEDCBA9876543210FEDCBA98 "Developer ID Application: Mick Hua (TEAM123456)"',
  "     2 valid identities found",
].join("\n");

test("4.20 with no signing certificate the Mac build stays ad-hoc, asks for no keychain and is not notarised", () => {
  assert.deepEqual(macSigning({}), { mode: "ad-hoc", identity: "-", keychain: false, notarize: false });
  // An absent repository secret reaches the job as an empty string.
  assert.deepEqual(macSigning({ CSC_LINK: "", ...apple }), { mode: "ad-hoc", identity: "-", keychain: false, notarize: false });
});

test("4.20 with the certificate and Apple's key the Mac build imports a keychain, signs as the Developer ID find-identity lists, and notarises", () => {
  assert.deepEqual(macSigning({ CSC_LINK: "base64p12", CSC_KEY_PASSWORD: "pw", ...apple }), { mode: "developer-id", keychain: true, notarize: true });
  assert.equal(identityFrom(listed), "FEDCBA9876543210FEDCBA9876543210FEDCBA98");
  assert.throws(() => identityFrom('  1) 0123456789ABCDEF0123456789ABCDEF01234567 "Apple Development: Someone (AAAAAAAAAA)"\n     1 valid identities found'), /No Developer ID Application identity/);
});

test("4.20 a certificate without Apple's notarisation credentials is refused, naming what is missing but never a value", () => {
  assert.throws(() => macSigning({ CSC_LINK: "base64p12", CSC_KEY_PASSWORD: "pw" }), /APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER/);
  assert.throws(() => macSigning({ CSC_LINK: "base64p12", ...apple, APPLE_API_ISSUER: "" }), (error: Error) => /APPLE_API_ISSUER/.test(error.message) && !error.message.includes("KEY123") && !error.message.includes("base64p12"));
});

test("4.20 the release notes call the Mac build notarised only when it was built signed", () => {
  assert.match(macReleaseNote(false), /ad-hoc signed on the same commit, but not yet notarised/);
  assert.doesNotMatch(macReleaseNote(true), /not yet notarised|ad-hoc/);
  assert.match(macReleaseNote(true), /Developer ID.*notarised by Apple/);
});
