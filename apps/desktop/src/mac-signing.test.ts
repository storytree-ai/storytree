import assert from "node:assert/strict";
import { test } from "node:test";

// The release's macOS signing mode, chosen from the repository's signing secrets (apps/desktop's
// mac-signing.mjs): the release workflow and dist.mjs both follow it.
// @ts-expect-error: a plain .mjs packaging script, outside the typed source
import { builderEnv, historyLines, identityFrom, macBuilderConfig, macReleaseNote, macSigning, notarise, withMacNote } from "../mac-signing.mjs";

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

test("4.20 an ad-hoc Mac build hands electron-builder no CSC_LINK or CSC_KEY_PASSWORD, so an empty secret is not read as a certificate path", () => {
  // The release passes absent secrets as empty strings; electron-builder resolved CSC_LINK="" to apps/desktop and failed.
  const adHoc = builderEnv({ CSC_LINK: "", CSC_KEY_PASSWORD: "", PATH: "/usr/bin" });
  assert.equal("CSC_LINK" in adHoc, false);
  assert.equal("CSC_KEY_PASSWORD" in adHoc, false);
  assert.equal(adHoc.PATH, "/usr/bin");
});

test("4.20 a Developer ID Mac build hands electron-builder the identity prepare put in the keychain, not the certificate to import again", () => {
  // electron-builder's own import unlocked its keychain with the certificate's password and macOS refused it.
  const identity = "FEDCBA9876543210FEDCBA9876543210FEDCBA98";
  const signed = builderEnv({ CSC_LINK: "base64p12", CSC_KEY_PASSWORD: "pw", ...apple, STORYTREE_MAC_IDENTITY: identity, PATH: "/usr/bin" });
  assert.equal("CSC_LINK" in signed, false);
  assert.equal("CSC_KEY_PASSWORD" in signed, false);
  assert.equal(signed.CSC_NAME, identity);
  assert.deepEqual([signed.APPLE_API_KEY, signed.APPLE_API_KEY_ID, signed.APPLE_API_ISSUER], [apple.APPLE_API_KEY, apple.APPLE_API_KEY_ID, apple.APPLE_API_ISSUER]);
  assert.throws(() => builderEnv({ CSC_LINK: "base64p12", CSC_KEY_PASSWORD: "pw", ...apple }), /STORYTREE_MAC_IDENTITY/);
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

test("4.20 the release notes' Mac sentence says what the build is: ad-hoc, notarised, or signed but not yet notarised", () => {
  assert.match(macReleaseNote("ad-hoc"), /ad-hoc signed on the same commit, but not yet notarised/);
  assert.doesNotMatch(macReleaseNote("notarised"), /not yet notarised|ad-hoc/);
  assert.match(macReleaseNote("notarised"), /Developer ID.*notarised by Apple/);
  assert.match(macReleaseNote("pending"), /Developer ID.*not yet notarised/);
  // The draft is written before the Mac build; its upload puts in what Apple actually answered.
  const body = ["## Install", "", macReleaseNote("pending"), "", "Development installations follow every published build."].join("\n");
  assert.equal(withMacNote(body, "notarised"), body.replace(macReleaseNote("pending"), macReleaseNote("notarised")));
  assert.equal(withMacNote(withMacNote(body, "ad-hoc"), "pending"), body);
});

test("4.20 electron-builder never notarises by itself, so its unbounded wait on Apple cannot hold the Mac build", () => {
  // Releases 0.3.1346, 0.3.1349 and 0.3.1353 were cancelled at the job's limit inside electron-builder's notarytool wait.
  assert.deepEqual(macBuilderConfig(macSigning({})), { identity: "-", notarize: false });
  assert.deepEqual(macBuilderConfig(macSigning({ CSC_LINK: "base64p12", ...apple })), { notarize: false });
});

test("4.20 Apple's answer is waited for only until the bound: accepted is notarised; still in progress or refused publishes signed but not notarised, naming the submission", async () => {
  const answering = (statuses: string[], step = 60_000) => {
    let clock = 0;
    const asked: string[] = [];
    return {
      asked,
      run: { submit: () => "sub-1", info: (id: string) => (asked.push(id), statuses.shift() ?? "In Progress"), sleep: async (ms: number) => { clock += ms; }, now: () => clock, waitMs: 10 * step, pollMs: step },
    };
  };
  const accepted = answering(["In Progress", "In Progress", "Accepted"]);
  assert.deepEqual(await notarise(accepted.run), { id: "sub-1", status: "Accepted", notarised: true });
  assert.deepEqual(accepted.asked, ["sub-1", "sub-1", "sub-1"]);
  const waiting = answering([]);
  assert.deepEqual(await notarise(waiting.run), { id: "sub-1", status: "In Progress", notarised: false });
  assert.equal(waiting.asked.length, 11);
  assert.deepEqual(await notarise(answering(["Invalid"]).run), { id: "sub-1", status: "Invalid", notarised: false });
});

test("4.20 reading Apple's history prints each submission's id, date and status, and nothing else it returned", () => {
  const history = JSON.stringify({
    message: "Successfully received submission history.",
    history: [
      { createdDate: "2026-10-13T17:34:02.000Z", id: "2f1c0e4a-0000-4000-8000-000000000003", name: "storytree-0.3.app.zip", status: "In Progress" },
      { createdDate: "2026-10-13T16:35:40.000Z", id: "2f1c0e4a-0000-4000-8000-000000000002", name: "storytree-0.3.app.zip", status: "Accepted" },
    ],
  });
  assert.deepEqual(historyLines(history), [
    "2f1c0e4a-0000-4000-8000-000000000003  2026-10-13T17:34:02.000Z  In Progress",
    "2f1c0e4a-0000-4000-8000-000000000002  2026-10-13T16:35:40.000Z  Accepted",
  ]);
  assert.deepEqual(historyLines(JSON.stringify({ history: [] })), ["No submissions."]);
});
