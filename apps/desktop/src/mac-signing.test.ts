import assert from "node:assert/strict";
import { test } from "node:test";

// The release's macOS signing mode, chosen from the repository's signing secrets (apps/desktop's
// mac-signing.mjs): the release workflow and dist.mjs both follow it.
// @ts-expect-error: a plain .mjs packaging script, outside the typed source
import { builderEnv, gatekeeperSkip, historyLines, identityFrom, macBuilderConfig, macNotarisation, macReleaseNote, macSigning, notarise, pendingLine, staplerSkip, withMacNote } from "../mac-signing.mjs";

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

test("4.20 electron-builder signs a pull request's Mac build in both modes, rather than skipping signing as it does by default", () => {
  // A same-repository pull request's rehearsal carries the Developer ID secrets; unsigned, it failed codesign (PR #1378's run 38638385107).
  assert.equal(builderEnv({ CSC_LINK: "", PATH: "/usr/bin" }).CSC_FOR_PULL_REQUEST, "true");
  assert.equal(builderEnv({ CSC_LINK: "base64p12", CSC_KEY_PASSWORD: "pw", ...apple, STORYTREE_MAC_IDENTITY: "FEDCBA98" }).CSC_FOR_PULL_REQUEST, "true");
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
  assert.equal(withMacNote(body, "notarised"), [
    "## Install",
    "",
    "The macOS (Apple Silicon) zip is built on the same commit, signed with storytree's Developer ID and notarised by Apple.",
    "",
    "Development installations follow every published build.",
  ].join("\n"));
  assert.equal(withMacNote(withMacNote(body, "ad-hoc"), "pending"), body);
});

test("4.20 electron-builder never notarises by itself, so its unbounded wait on Apple cannot hold the Mac build", () => {
  // Releases 0.3.1346, 0.3.1349 and 0.3.1353 were cancelled at the job's limit inside electron-builder's notarytool wait.
  assert.deepEqual(macBuilderConfig(macSigning({})), { identity: "-", notarize: false });
  assert.deepEqual(macBuilderConfig(macSigning({ CSC_LINK: "base64p12", ...apple })), { notarize: false });
});

test("4.20 Apple's answer is waited for only until the bound: accepted is notarised and stapled; still in progress or refused publishes signed but not notarised, naming the submission", async () => {
  const answering = (statuses: string[], step = 60_000, stapling = true) => {
    let clock = 0;
    const asked: string[] = [];
    const stapled: number[] = [];
    return {
      asked,
      stapled,
      run: { submit: () => "sub-1", info: (id: string) => (asked.push(id), statuses.shift() ?? "In Progress"), staple: () => (stapled.push(clock), stapling), sleep: async (ms: number) => { clock += ms; }, now: () => clock, waitMs: 10 * step, pollMs: step },
    };
  };
  const accepted = answering(["In Progress", "In Progress", "Accepted"]);
  assert.deepEqual(await notarise(accepted.run), { id: "sub-1", status: "Accepted", notarised: true, stapled: true });
  assert.deepEqual(accepted.asked, ["sub-1", "sub-1", "sub-1"]);
  assert.equal(accepted.stapled.length, 1);
  // Apple accepted but the ticket would not staple: still notarised (Gatekeeper asks Apple online), recorded unstapled.
  assert.deepEqual(await notarise(answering(["Accepted"], 60_000, false).run), { id: "sub-1", status: "Accepted", notarised: true, stapled: false });
  const waiting = answering([]);
  assert.deepEqual(await notarise(waiting.run), { id: "sub-1", status: "In Progress", notarised: false, stapled: false });
  assert.equal(waiting.asked.length, 11);
  assert.deepEqual(waiting.stapled, []);
  const refused = answering(["Invalid"]);
  assert.deepEqual(await notarise(refused.run), { id: "sub-1", status: "Invalid", notarised: false, stapled: false });
  assert.deepEqual(refused.stapled, []);
});

test("4.20 a Developer ID build is notarised and stapled once signed, before electron-builder makes its zip, so it carries the ticket", async () => {
  // Run 38914897950: notarising the finished zip left the shipped app with no ticket stapled to it.
  const asked: string[][] = [];
  const hooks = macNotarisation(macSigning({ CSC_LINK: "base64p12", ...apple }), "/release/mac-notarisation.json", async (app: string, outcome: string) => { asked.push([app, outcome]); });
  await hooks.afterSign({ appOutDir: "/release/mac-arm64", packager: { appInfo: { productFilename: "storytree-0.3" } } });
  assert.deepEqual(asked, [["/release/mac-arm64/storytree-0.3.app", "/release/mac-notarisation.json"]]);
  assert.deepEqual(macNotarisation(macSigning({}), "/release/mac-notarisation.json", async () => { throw new Error("an ad-hoc build is not notarised"); }), {});
});

test("4.20 the install check validates the stapled ticket of a build Apple notarised, and says why when it does not", () => {
  assert.equal(staplerSkip({ adHoc: false, answer: { id: "sub-1", status: "Accepted", notarised: true, stapled: true } }), undefined);
  assert.match(staplerSkip({ adHoc: true, answer: undefined }) ?? "", /ad-hoc/);
  assert.match(staplerSkip({ adHoc: false, answer: { id: "sub-1", status: "In Progress", notarised: false, stapled: false } }) ?? "", /sub-1.*"In Progress"/);
  assert.match(staplerSkip({ adHoc: false, answer: { id: "sub-1", status: "Accepted", notarised: true, stapled: false } }) ?? "", /sub-1.*did not staple/);
});

test("4.20 the install check asks Gatekeeper only of a build Apple notarised: an ad-hoc build or one Apple had not accepted by the bound skips it, saying why", () => {
  assert.equal(gatekeeperSkip({ adHoc: false, answer: { id: "sub-1", status: "Accepted", notarised: true } }), undefined);
  assert.match(gatekeeperSkip({ adHoc: true, answer: undefined }) ?? "", /ad-hoc/);
  assert.match(gatekeeperSkip({ adHoc: false, answer: { id: "sub-1", status: "In Progress", notarised: false } }) ?? "", /sub-1.*"In Progress"/);
  assert.equal(gatekeeperSkip({ adHoc: false, answer: undefined }), undefined);
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

test("4.20 a submission Apple has not yet answered is read as pending, with no log asked for; once Apple answers, its log is read", () => {
  const id = "f191f6cd-09d7-4364-8698-6f864f68d439";
  assert.equal(pendingLine(id, "In Progress"), `Submission ${id} is still In Progress: Apple's log for it comes once Apple answers.`);
  for (const status of ["Accepted", "Invalid", "Rejected"]) assert.equal(pendingLine(id, status), null);
});
