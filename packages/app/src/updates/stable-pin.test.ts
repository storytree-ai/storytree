import assert from "node:assert/strict";
import test from "node:test";
import { pinStable, type PinPorts, type StableManifest } from "./stable-pin.js";

function fixture() {
  let current: { ref: string; manifest: StableManifest } | undefined;
  const installer = { url: "https://github.com/storytree-ai/storytree/releases/download/v0.3.2/storytree-0.3-0.3.2-setup.exe", sha256: "a".repeat(64), sha512: Buffer.alloc(64, 1).toString("base64"), size: 128 };
  const state = {
    candidate: { version: "0.3.2", commit: "a".repeat(40), channelSchema: 1, draft: false, prerelease: false, installer, bootstrap: "published bootstrap" },
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
      assert.equal(bootstrap, "published bootstrap");
      if (state.race || expected !== current?.ref) throw new Error("Stable pin moved; retry from the new pin");
      state.published.push(manifest);
      current = { ref: String(state.published.length), manifest };
    },
    now: () => "2026-10-02T12:00:00.000Z",
  };
  return { state, ports };
}

test("4.16 a pin reuses the released installer and records only newly landed increments; late closure records survive the boundary", async () => {
  const { state, ports } = fixture();
  const first = await pinStable("0.3.2", ports);
  assert.deepEqual(first.files, [{ url: state.candidate.installer.url, sha512: state.candidate.installer.sha512, size: 128 }]);
  assert.deepEqual(first.pin.increments.map(i => i.id), ["one"]);
  assert.match(first.releaseNotes, /Choose update timing.*#531/);
  state.candidate = { ...state.candidate, version: "0.3.3", commit: "b".repeat(40), installer: { ...state.candidate.installer, url: state.candidate.installer.url.replaceAll("0.3.2", "0.3.3") } };
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
  state.candidate = { ...state.candidate, version: "0.3.1", installer: { ...state.candidate.installer, url: state.candidate.installer.url.replaceAll("0.3.2", "0.3.1") } };
  await assert.rejects(pinStable("0.3.1", ports), /older/i);
  state.candidate = { ...state.candidate, version: "0.3.3", installer: { ...state.candidate.installer, url: state.candidate.installer.url.replaceAll("0.3.1", "0.3.3") } };
  state.race = true;
  await assert.rejects(pinStable("0.3.3", ports), /pin moved/i);
  assert.equal(state.published.length, 1);
});
