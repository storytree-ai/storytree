import assert from "node:assert/strict";
import test from "node:test";

import { GitHubProvider } from "electron-updater/out/providers/GitHubProvider.js";

import { carriedFeed, platformsNote, releaseDelivery, type DeliveryManifest } from "./release-carry.js";

// latest-mac.yml as electron-builder writes it (release v0.3.1356's, checksums shortened to the shape the updater checks).
const sha = (c: string) => `${c.repeat(86)}==`;
const macFeed = (version: string) => [
  `version: ${version}`, "files:",
  `  - url: storytree-0.3-${version}-mac-arm64.zip`, `    sha512: ${sha("a")}`, "    size: 302366160",
  `  - url: storytree-0.3-${version}-arm64.dmg`, `    sha512: ${sha("b")}`, "    size: 301503710",
  `path: storytree-0.3-${version}-mac-arm64.zip`, `sha512: ${sha("a")}`, "releaseDate: '2026-10-13T23:27:48.872Z'", "",
].join("\n");

/** What the alpha updater reads: GitHub's latest release is `tag`, and its latest-mac.yml is `feed`. */
async function developmentCheck(tag: string, feed: string) {
  const read: string[] = [];
  const answer = (pathname: string) => {
    read.push(pathname);
    if (pathname.endsWith("/releases.atom")) return `<feed><entry><link href="https://github.com/storytree-ai/storytree/releases/tag/${tag}"/></entry></feed>`;
    if (pathname.endsWith("/releases/latest")) return JSON.stringify({ tag_name: tag });
    if (pathname === `/storytree-ai/storytree/releases/download/${tag}/latest-mac.yml`) return feed;
    throw new Error(`404 ${pathname}`);
  };
  // The network, replaced at the executor every request goes through.
  const executor = { request: async (options: { path: string }) => answer(new URL(options.path, "https://github.com").pathname) };
  const provider = new GitHubProvider({ provider: "github", owner: "storytree-ai", repo: "storytree" },
    { channel: null, allowPrerelease: false, currentVersion: "0.3.1" } as never,
    { isUseMultipleRangeRequest: true, platform: "darwin", executor: executor as never });
  const info = await provider.getLatestVersion();
  return { version: info.version, files: provider.resolveFiles(info).map(f => f.url.href), read };
}

test("4.6 a release without a new Mac build carries the last good one's feed: an install on that build sees no newer version and no error, and one behind it downloads that build from its own release", async () => {
  const carried = carriedFeed(macFeed("0.3.1356"));
  const check = await developmentCheck("v0.3.1360", carried);
  assert.equal(check.version, "0.3.1356");
  assert.deepEqual(check.files, [
    "https://github.com/storytree-ai/storytree/releases/download/v0.3.1356/storytree-0.3-0.3.1356-mac-arm64.zip",
    "https://github.com/storytree-ai/storytree/releases/download/v0.3.1356/storytree-0.3-0.3.1356-arm64.dmg",
  ]);
  assert.ok(check.read.includes("/storytree-ai/storytree/releases/download/v0.3.1360/latest-mac.yml"), "the feed is read from the new release");
  // Carried again into the next release, it still names the build's own release.
  assert.equal(carriedFeed(carried), carried);
  assert.deepEqual((await developmentCheck("v0.3.1361", carriedFeed(carried))).files, check.files);
  // The build's own feed is untouched otherwise.
  assert.equal(carried.replaceAll("../v0.3.1356/", ""), macFeed("0.3.1356"));
});

const installers = (v: string) => ({
  x64: { name: `storytree-0.3-${v}-windows-x64-setup.exe`, sha256: "a".repeat(64), sha512: "b", size: 3 },
  arm64: { name: `storytree-0.3-${v}-windows-arm64-setup.exe`, sha256: "e".repeat(64), sha512: "f", size: 4 },
});
const windows: DeliveryManifest = { schema: 1, channelSchema: 1, version: "0.3.700", architectures: ["x64", "arm64"], installers: installers("0.3.700") };
const arm64 = (v: string) => ({ name: `storytree-0.3-${v}-mac-arm64.zip`, sha256: "c".repeat(64), size: 5 });
const x64 = (v: string) => ({ name: `storytree-0.3-${v}-linux-x86_64.AppImage`, sha256: "d".repeat(64), size: 7 });

test("4.6 publishing merges each platform's own entry into the release's delivery manifest, and refuses another version's", () => {
  const all = releaseDelivery("0.3.700", { windows, mac: { version: "0.3.700", macos: { arm64: arm64("0.3.700") } }, linux: { version: "0.3.700", linux: { x64: x64("0.3.700") } } });
  assert.deepEqual(all, { ...windows, macos: { arm64: arm64("0.3.700") }, linux: { x64: x64("0.3.700") } });
  // A rerun merges again to the same manifest.
  assert.deepEqual(releaseDelivery("0.3.700", { windows: all, mac: { version: "0.3.700", macos: { arm64: arm64("0.3.700") } }, linux: { version: "0.3.700", linux: { x64: x64("0.3.700") } } }), all);
  assert.throws(() => releaseDelivery("0.3.700", { windows, mac: { version: "0.3.699", macos: { arm64: arm64("0.3.699") } }, linux: { version: "0.3.700", linux: {} } }), /0\.3\.699/);
  assert.throws(() => releaseDelivery("0.3.701", { windows, mac: { version: "0.3.701", macos: {} }, linux: { version: "0.3.701", linux: {} } }), /Windows delivery manifest is for 0\.3\.700/);
});

test("4.6 a platform whose build is not in the release keeps the earlier release's entry, naming its own build, so its one-liner installs the last build that has it", () => {
  const earlier = releaseDelivery("0.3.700", { windows, mac: { version: "0.3.700", macos: { arm64: arm64("0.3.700") } }, linux: { version: "0.3.700", linux: { x64: x64("0.3.700") } } });
  const next = { ...windows, version: "0.3.701", installers: installers("0.3.701") };
  const noMac = releaseDelivery("0.3.701", { windows: next, linux: { version: "0.3.701", linux: { x64: x64("0.3.701") } } }, earlier);
  assert.deepEqual(noMac, { ...next, macos: { arm64: { ...arm64("0.3.700"), version: "0.3.700" } }, linux: { x64: x64("0.3.701") } });
  // Carried on again, the entry still names 0.3.700; Windows' absence carries each architecture's installer.
  const noWindowsOrMac = releaseDelivery("0.3.702", { linux: { version: "0.3.702", linux: { x64: x64("0.3.702") } } }, noMac);
  assert.deepEqual(noWindowsOrMac, { schema: 1, channelSchema: 1, version: "0.3.702", architectures: ["x64", "arm64"],
    installers: { x64: { ...installers("0.3.701").x64, version: "0.3.701" }, arm64: { ...installers("0.3.701").arm64, version: "0.3.701" } },
    macos: { arm64: { ...arm64("0.3.700"), version: "0.3.700" } }, linux: { x64: x64("0.3.702") } });
  // A build from before the split, carried, keeps its one installer for both architectures.
  const combined = { name: "storytree-0.3-0.3.699-setup.exe", sha256: "a".repeat(64), sha512: "b", size: 3 };
  const { installers: _split, ...before } = { ...earlier, version: "0.3.699", installer: combined };
  assert.deepEqual(releaseDelivery("0.3.700", { mac: { version: "0.3.700", macos: {} }, linux: { version: "0.3.700", linux: {} } }, before).installer, { ...combined, version: "0.3.699" });
  // With nothing earlier to carry, an absent platform cannot publish.
  const { macos: _gone, ...withoutMac } = earlier;
  assert.throws(() => releaseDelivery("0.3.701", { windows: next }), /No earlier release carries a Mac build/);
  assert.throws(() => releaseDelivery("0.3.701", { windows: next, linux: { version: "0.3.701", linux: {} } }, withoutMac), /0\.3\.700 has no Mac build to carry/);
});

test("4.6 the release page says which platforms stay on an earlier build, and stops saying it once a later run brings the build", () => {
  const body = "## Install\n\nRun the one-liner.";
  const noted = platformsNote(body, { mac: "0.3.700" });
  assert.equal(noted, `${body}\n\n**Platforms.** This release has no new Mac build: Mac stays on 0.3.700, the last that built. Its installs and one-liners take that build until a release carries a new one.`);
  assert.match(platformsNote(noted, { windows: "0.3.699", linux: "0.3.700" }), /no new Windows or Linux build: Windows stays on 0\.3\.699, Linux stays on 0\.3\.700/);
  assert.equal(platformsNote(noted, {}), body);
});
