import assert from "node:assert/strict";
import test from "node:test";
import { mergedPullRequests, pinCoverage, type PinCandidate, pinStable, type PinPorts, type PlatformFeed, type StableManifest } from "./stable-pin.js";
import { publishStable, releaseFeed, type GithubRequest } from "./stable-github.js";

type PinCandidateFeeds = PinCandidate["feeds"];
const RELEASES = "https://github.com/storytree-ai/storytree/releases/download";
function platformFeeds(version: string): { mac: PlatformFeed; linux: PlatformFeed } {
  const file = (name: string) => ({ url: `${RELEASES}/v${version}/storytree-0.3-${version}-${name}`, sha512: Buffer.alloc(64, 2).toString("base64"), size: 64 });
  return { mac: { version, files: [file("mac-arm64.zip"), file("arm64.dmg")] }, linux: { version, files: [{ ...file("linux-x86_64.AppImage"), blockMapSize: 8 }] } };
}

function fixture() {
  let current: { ref: string; manifest: StableManifest } | undefined;
  const installer = { url: "https://github.com/storytree-ai/storytree/releases/download/v0.3.2/storytree-0.3-0.3.2-setup.exe", sha256: "a".repeat(64), sha512: Buffer.alloc(64, 1).toString("base64"), size: 128 };
  const state = {
    candidate: { version: "0.3.2", commit: "a".repeat(40), channelSchema: 1, draft: false, prerelease: false, installer, bootstrap: { ps1: "published bootstrap" }, feeds: platformFeeds("0.3.2") as PinCandidateFeeds },
    increments: [
      { id: "one", fields: { title: "Choose update timing", status: "closed", outcome: { disposition: "landed", pr: "531", note: "Quiet hours and manual installs." } } },
      { id: "future", fields: { title: "Unreleased work", status: "closed", outcome: { disposition: "landed", pr: "600" } } },
      { id: "open", fields: { title: "Not landed", status: "active", outcome: undefined } },
    ],
    published: [] as StableManifest[],
    race: false,
  };
  const ports: PinPorts = {
    previous: async () => current,
    candidate: async () => state.candidate,
    pullRequests: async () => new Set(["531", "532"]),
    increments: async () => state.increments,
    publish: async (manifest, bootstrap, expected) => {
      assert.deepEqual(bootstrap, { ps1: "published bootstrap" });
      if (state.race || expected !== current?.ref) throw new Error("Stable pin moved; retry from the new pin");
      state.published.push(manifest);
      current = { ref: String(state.published.length), manifest };
    },
    now: () => "2026-10-02T12:00:00.000Z",
  };
  return { state, ports };
}

test("4.16 a PR mentioned by another merge is not recorded as shipped", () => {
  assert.deepEqual([...mergedPullRequests("Merge pull request #531 from storytree-ai/update\nMention (#600) and Merge pull request #601\nMerge pull request #532 from storytree-ai/pin")], ["531", "532"]);
});

test("4.16 a pin reuses the released installer and records only newly landed increments; late closure records survive the boundary", async () => {
  const { state, ports } = fixture();
  const first = await pinStable("0.3.2", ports);
  assert.deepEqual(first.files, [{ url: state.candidate.installer.url, sha512: state.candidate.installer.sha512, size: 128 }]);
  assert.deepEqual(first.pin.increments.map(i => i.id), ["one"]);
  assert.match(first.releaseNotes, /Choose update timing.*#531/);
  state.candidate = { ...state.candidate, feeds: {}, version: "0.3.3", commit: "b".repeat(40), installer: { ...state.candidate.installer, url: state.candidate.installer.url.replaceAll("0.3.2", "0.3.3") } };
  state.increments.push({ id: "late", fields: { title: "A late close of shipped work", status: "closed", outcome: { disposition: "landed", pr: "531" } } });
  state.increments.push({ id: "two", fields: { title: "Stable updates", status: "closed", outcome: { disposition: "landed", pr: "532" } } });
  const next = await pinStable("0.3.3", ports);
  assert.equal(next.pin.previous, "0.3.2");
  assert.deepEqual(next.pin.increments.map(i => i.id), ["late", "two"]);
  assert.deepEqual(next.pin.includedIncrements, ["one", "late", "two"]);
  assert.equal(state.published.length, 2);
});

test("4.16 preview publishes nothing; invalid, old or channel-unaware builds and overlapping pins cannot change stable", async () => {
  const { state, ports } = fixture();
  await pinStable("0.3.2", ports, true);
  assert.equal(state.published.length, 0);
  for (const change of [{ draft: true }, { prerelease: true }, { channelSchema: 0 }, { version: "0.3.99" }, { installer: { ...state.candidate.installer, sha512: "bad" } }]) {
    const original = state.candidate;
    state.candidate = { ...original, ...change };
    await assert.rejects(pinStable("0.3.2", ports));
    state.candidate = original;
  }
  await pinStable("0.3.2", ports);
  state.candidate = { ...state.candidate, feeds: {}, version: "0.3.1", installer: { ...state.candidate.installer, url: state.candidate.installer.url.replaceAll("0.3.2", "0.3.1") } };
  await assert.rejects(pinStable("0.3.1", ports), /older/i);
  state.candidate = { ...state.candidate, feeds: {}, version: "0.3.3", installer: { ...state.candidate.installer, url: state.candidate.installer.url.replaceAll("0.3.1", "0.3.3") } };
  state.race = true;
  await assert.rejects(pinStable("0.3.3", ports), /pin moved/i);
  assert.equal(state.published.length, 1);
});

test("4.16 competing publishers expose one complete feed and bootstrap, with the losing pin refused", async () => {
  const { ports } = fixture();
  const manifest = await pinStable("0.3.2", ports, true);
  let head = "base";
  const trees = new Map<string, { tree: { path: string; content: string }[] }>();
  const commits = new Map<string, { tree: string; parents: string[] }>();
  const api: GithubRequest = async (endpoint, method, body) => {
    if (endpoint === "git/trees") {
      const sha = `tree-${trees.size}`;
      trees.set(sha, body as never);
      return { sha };
    }
    if (endpoint === "git/commits") {
      const sha = `commit-${commits.size}`;
      commits.set(sha, body as never);
      return { sha };
    }
    assert.equal(method, "PATCH");
    const update = body as { sha: string; force: boolean };
    if (!update.force && commits.get(update.sha)?.parents[0] !== head) throw new Error("Reference update is not a fast forward");
    head = update.sha;
    return {};
  };
  const results = await Promise.allSettled([
    publishStable(manifest, { ps1: "the published bootstrap", sh: "the Mac's bootstrap" }, "base", api),
    publishStable({ ...manifest, version: "0.3.3" }, { ps1: "the published bootstrap" }, "base", api),
  ]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.filter(r => r.status === "rejected").length, 1);
  const tree = trees.get(commits.get(head)!.tree)!.tree;
  assert.deepEqual(JSON.parse(tree.find(f => f.path === "latest.yml")!.content), manifest);
  assert.equal(tree.find(f => f.path === "install-storytree.ps1")!.content, "the published bootstrap");
  // A release that carries the Mac's one-liner pins it beside the Windows one; one that does not, pins none.
  const mac = tree.find(f => f.path === "install-storytree.sh")?.content;
  assert.equal(mac, results[0]!.status === "fulfilled" ? "the Mac's bootstrap" : undefined);
});

function release(state: ReturnType<typeof fixture>["state"], version: string, feeds: PinCandidateFeeds) {
  state.candidate = { ...state.candidate, version, commit: version.slice(-1).repeat(40), feeds,
    installer: { ...state.candidate.installer, url: `${RELEASES}/v${version}/storytree-0.3-${version}-setup.exe` } };
}

test("4.16 a pin writes a feed for each platform the release carries; a Windows-only release moves Windows and leaves Mac and Linux on their pinned build", async () => {
  const { state, ports } = fixture();
  const first = await pinStable("0.3.2", ports);
  assert.deepEqual(first.pin.covers, ["windows", "mac", "linux"]);
  assert.deepEqual(first.feeds, platformFeeds("0.3.2"));
  release(state, "0.3.3", {});
  const next = await pinStable("0.3.3", ports);
  assert.equal(next.files[0]!.url, `${RELEASES}/v0.3.3/storytree-0.3-0.3.3-setup.exe`);
  assert.deepEqual(next.pin.covers, ["windows"]);
  assert.deepEqual(next.feeds, platformFeeds("0.3.2"));
  assert.match(pinCoverage(next), /Mac stays on 0\.3\.2/);
  assert.match(pinCoverage(next), /Linux stays on 0\.3\.2/);
  // The stable branch carries each platform's feed beside latest.yml, pointing at the original release's files.
  const trees: { path: string; content: string }[][] = [];
  const api: GithubRequest = async (endpoint, _method, body) => {
    if (endpoint === "git/trees") trees.push((body as { tree: { path: string; content: string }[] }).tree);
    return { sha: "sha" };
  };
  await publishStable(next, { ps1: "published bootstrap" }, "base", api);
  const tree = trees[0]!;
  assert.deepEqual(JSON.parse(tree.find(f => f.path === "latest-mac.yml")!.content), platformFeeds("0.3.2").mac);
  assert.deepEqual(JSON.parse(tree.find(f => f.path === "latest-linux.yml")!.content), platformFeeds("0.3.2").linux);
  assert.match(tree.find(f => f.path === "README.md")!.content, /Mac stays on 0\.3\.2/);
  // A first pin of a release without a platform writes no feed for it, and says so.
  const fresh = fixture();
  release(fresh.state, "0.3.4", { mac: platformFeeds("0.3.4").mac });
  const macOnly = await pinStable("0.3.4", fresh.ports, true);
  assert.deepEqual(Object.keys(macOnly.feeds ?? {}), ["mac"]);
  assert.match(pinCoverage(macOnly), /Linux has no stable build/);
});

test("4.16 a platform feed that is not its own release's complete build is refused, and the preview names the platforms it moves", async () => {
  const { state, ports } = fixture();
  const good = platformFeeds("0.3.2");
  for (const feeds of [
    { mac: { ...good.mac, version: "0.3.1" } },
    { mac: { ...good.mac, files: [{ ...good.mac.files[0]!, url: good.mac.files[0]!.url.replace("v0.3.2", "v0.3.1") }] } },
    { mac: { ...good.mac, files: [good.mac.files[1]!] } },
    { linux: { ...good.linux, files: [{ ...good.linux.files[0]!, sha512: "bad" }] } },
    { linux: { ...good.linux, files: [] } },
  ]) {
    state.candidate = { ...state.candidate, feeds: feeds as PinCandidateFeeds };
    await assert.rejects(pinStable("0.3.2", ports, true), /Mac|Linux/);
  }
  assert.equal(state.published.length, 0);
  state.candidate = { ...state.candidate, feeds: good };
  assert.match(pinCoverage(await pinStable("0.3.2", ports, true)), /^Windows, Mac and Linux take 0\.3\.2\.$/);
});

test("4.16 a release's own Mac feed is read with each file at its absolute URL on that release, and a size that differs from the asset is refused", () => {
  const sha = (n: number) => Buffer.alloc(64, n).toString("base64");
  const text = [
    "version: 0.3.5", "files:",
    "  - url: storytree-0.3-0.3.5-mac-arm64.zip", `    sha512: ${sha(3)}`, "    size: 30",
    "  - url: storytree-0.3-0.3.5-arm64.dmg", `    sha512: ${sha(4)}`, "    size: 40", "    blockMapSize: 5",
    "path: storytree-0.3-0.3.5-mac-arm64.zip", `sha512: ${sha(3)}`, "releaseDate: '2026-10-15T14:40:03.903Z'", "",
  ].join("\n");
  const assets: Record<string, number> = { "storytree-0.3-0.3.5-mac-arm64.zip": 30, "storytree-0.3-0.3.5-arm64.dmg": 40 };
  const resolve = (name: string) => ({ url: `${RELEASES}/v0.3.5/${name}`, size: assets[name]! });
  assert.deepEqual(releaseFeed(text, resolve), { version: "0.3.5", files: [
    { url: `${RELEASES}/v0.3.5/storytree-0.3-0.3.5-mac-arm64.zip`, sha512: sha(3), size: 30 },
    { url: `${RELEASES}/v0.3.5/storytree-0.3-0.3.5-arm64.dmg`, sha512: sha(4), size: 40, blockMapSize: 5 },
  ] });
  assets["storytree-0.3-0.3.5-arm64.dmg"] = 41;
  assert.throws(() => releaseFeed(text, resolve), /size/);
  assert.throws(() => releaseFeed(text.replace("    size: 30", "    unknown: 30"), resolve), /Cannot read/);
});
