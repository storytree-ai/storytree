import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { removeTemp } from "@storytree/test-waits";

// The release's macOS signing mode, chosen from the repository's signing secrets (apps/desktop's
// mac-signing.mjs): the release workflow and dist.mjs both follow it.
// @ts-expect-error: a plain .mjs packaging script, outside the typed source
import { builderEnv, gatekeeperSkip, historyLines, identityFrom, macReleaseNote, macSigning, notarise, packagedSigning, pendingLine, signApp, signingOrder, signRelease, staplerSkip, unsignedEnv, withMacNote, withZipDigest } from "../mac-signing.mjs";

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

test("4.20 an unsigned build hands electron-builder no certificate variable at all, on any platform", () => {
  const given = { CSC_LINK: "", CSC_KEY_PASSWORD: "pw", CSC_NAME: "someone", WIN_CSC_LINK: "cert", PATH: "/usr/bin" };
  assert.deepEqual(unsignedEnv(given), { PATH: "/usr/bin" });
  assert.deepEqual(builderEnv(given), { PATH: "/usr/bin", CSC_FOR_PULL_REQUEST: "true" });
});

test("4.20 electron-builder builds the Mac app ad-hoc even when the Developer ID secrets are in its environment: the signing job alone signs with them", () => {
  // A same-repository pull request's build is signed too (electron-builder skips that by default), and Apple Silicon runs no unsigned code.
  const built = builderEnv({ CSC_LINK: "base64p12", CSC_KEY_PASSWORD: "pw", CSC_NAME: "FEDCBA98", ...apple, PATH: "/usr/bin" });
  assert.deepEqual(Object.keys(built).filter((name) => /CSC_/.test(name)), ["CSC_FOR_PULL_REQUEST"]);
  assert.equal(built.CSC_FOR_PULL_REQUEST, "true");
});

test("4.20 the packaged app records the mode the signing job will sign it in, since its archive cannot change once built; a mode the build was not told is refused", () => {
  assert.equal(packagedSigning(undefined), "ad-hoc");
  assert.equal(packagedSigning("ad-hoc"), "ad-hoc");
  assert.equal(packagedSigning("developer-id"), "developer-id");
  // The release passes "missing" when the job that reads the secrets gave no mode.
  for (const value of ["", "missing", "Developer ID"]) assert.throws(() => packagedSigning(value), /STORYTREE_MAC_SIGNING/);
});

const machO = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]);
/** A small .app laid out as electron-builder's is: a framework with its version links, a helper app, libraries and a tool payload. */
function fakeApp() {
  const root = mkdtempSync(path.join(tmpdir(), "storytree-sign-"));
  const app = path.join(root, "mac-arm64", "storytree-0.3.app");
  const put = (relative: string, bytes: Buffer | string) => {
    mkdirSync(path.dirname(path.join(app, relative)), { recursive: true });
    writeFileSync(path.join(app, relative), bytes);
  };
  put("Contents/MacOS/storytree-0.3", machO);
  put("Contents/Info.plist", "<plist/>");
  const framework = "Contents/Frameworks/Electron Framework.framework";
  put(`${framework}/Versions/A/Electron Framework`, machO);
  put(`${framework}/Versions/A/Libraries/libEGL.dylib`, machO);
  put(`${framework}/Versions/A/Helpers/chrome_crashpad_handler`, machO);
  put(`${framework}/Versions/A/Resources/Info.plist`, "<plist/>");
  symlinkSync("A", path.join(app, framework, "Versions/Current"));
  symlinkSync("Versions/Current/Electron Framework", path.join(app, framework, "Electron Framework"));
  put("Contents/Frameworks/storytree-0.3 Helper (GPU).app/Contents/MacOS/storytree-0.3 Helper (GPU)", machO);
  put("Contents/Resources/postgres/bin/postgres", machO);
  put("Contents/Resources/agent-tools/node", machO);
  put("Contents/Resources/agent-tools/node_modules/sharp/sharp.node", machO);
  put("Contents/Resources/agent-tools/storytree.mjs", "export {};\n");
  const digest = (relative: string) => createHash("sha256").update(readFileSync(path.join(app, "Contents/Resources/agent-tools", relative))).digest("hex");
  const files = Object.fromEntries(["node", "node_modules/sharp/sharp.node", "storytree.mjs"].map((name) => [name, digest(name)]));
  put("Contents/Resources/agent-tools/payload.json", JSON.stringify({ schema: 1, arch: "arm64", nodeVersion: "24.21.0", files }, null, 2) + "\n");
  return { root, app, digest };
}

test("4.20 the signing job signs inside-out: every nested binary, framework and helper app before the bundle holding it, the app last, and never a link or a file that is not code", async () => {
  const { root, app } = fakeApp();
  try {
    const order = signingOrder(app).map((file: string) => path.relative(app, file).split(path.sep).join("/") || ".");
    assert.equal(order.at(-1), ".");
    assert.deepEqual([...order].sort(), [
      ".",
      "Contents/Frameworks/Electron Framework.framework",
      "Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework",
      "Contents/Frameworks/Electron Framework.framework/Versions/A/Helpers/chrome_crashpad_handler",
      "Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libEGL.dylib",
      "Contents/Frameworks/storytree-0.3 Helper (GPU).app",
      "Contents/Frameworks/storytree-0.3 Helper (GPU).app/Contents/MacOS/storytree-0.3 Helper (GPU)",
      "Contents/MacOS/storytree-0.3",
      "Contents/Resources/agent-tools/node",
      "Contents/Resources/agent-tools/node_modules/sharp/sharp.node",
      "Contents/Resources/postgres/bin/postgres",
    ].sort());
    for (const [index, item] of order.entries()) {
      const holders = order.filter((other: string) => other !== item && (other === "." || item.startsWith(`${other}/`)));
      for (const holder of holders) assert.ok(order.indexOf(holder) > index, `${holder} is signed after ${item}, which it holds`);
    }
  } finally {
    await removeTemp(root);
  }
});

test("4.20 each item is signed with the hardened runtime and the app's entitlements, a Developer ID one with a secure timestamp, and the tool payload's digests are rewritten before the app is sealed", async () => {
  const { root, app, digest } = fakeApp();
  try {
    const calls: string[][] = [];
    // codesign rewrites each binary it signs; the fake appends a byte, as a new signature would change it.
    const codesign = (args: string[]) => {
      calls.push(args);
      const target = args.at(-1)!;
      if (target === app) {
        const { files } = JSON.parse(readFileSync(path.join(app, "Contents/Resources/agent-tools/payload.json"), "utf8"));
        for (const [name, expected] of Object.entries(files)) assert.equal(expected, digest(name), `payload.json records ${name} as signed`);
      } else if (!/\.(app|framework)$/.test(target)) appendFileSync(target, "signed");
    };
    signApp(app, "FEDCBA98", "/entitlements.mac.plist", codesign);
    assert.equal(calls.at(-1)!.at(-1), app);
    for (const args of calls) assert.deepEqual(args.slice(0, -1), ["--force", "--sign", "FEDCBA98", "--options", "runtime", "--entitlements", "/entitlements.mac.plist", "--timestamp"]);
    calls.length = 0;
    signApp(app, "-", "/entitlements.mac.plist", codesign);
    for (const args of calls) assert.deepEqual(args.slice(0, -1), ["--force", "--sign", "-", "--options", "runtime", "--entitlements", "/entitlements.mac.plist"]);
  } finally {
    await removeTemp(root);
  }
});

test("4.20 a Developer ID signing run without the identity prepare names is refused before anything is signed", async () => {
  const { root } = fakeApp();
  try {
    const calls: string[][] = [];
    await assert.rejects(signRelease({ STORYTREE_MAC_SIGNING: "developer-id" }, root, (args: string[]) => { calls.push(args); }), /STORYTREE_MAC_IDENTITY/);
    assert.deepEqual(calls, []);
  } finally {
    await removeTemp(root);
  }
});

test("4.20 the update feed names the signed zip: its sha512 and size are rewritten, and nothing else in it changes", () => {
  const feed = [
    "version: 0.3.1977",
    "files:",
    "  - url: storytree-0.3-0.3.1977-mac-arm64.zip",
    "    sha512: old+/==",
    "    size: 302831585",
    "path: storytree-0.3-0.3.1977-mac-arm64.zip",
    "sha512: old+/==",
    "releaseDate: '2026-10-26T07:00:53.502Z'",
    "",
  ].join("\n");
  assert.equal(withZipDigest(feed, "new/+==", 302900000), feed.replaceAll("old+/==", "new/+==").replace("302831585", "302900000"));
  assert.throws(() => withZipDigest("version: 0.3.1\n", "new", 1), /latest-mac\.yml/);
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
  const body = ["## Install", "", macReleaseNote("pending"), "", "Alpha installations follow every published build."].join("\n");
  assert.equal(withMacNote(body, "notarised"), [
    "## Install",
    "",
    "The macOS (Apple Silicon) zip is built on the same commit, signed with storytree's Developer ID and notarised by Apple.",
    "",
    "Alpha installations follow every published build.",
  ].join("\n"));
  assert.equal(withMacNote(withMacNote(body, "ad-hoc"), "pending"), body);
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
