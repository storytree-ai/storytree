import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { releaseChannel, releaseChannelChoice, STABLE_FEED, stableBuild } from "./release-channel.js";

test("4.15 a fresh installation stays stable, while an existing owner installation keeps alpha across upgrades", () => {
  for (const [marker, expected] of [["nsis-stable", "stable"], ["nsis", "alpha"]] as const) {
    const home = mkdtempSync(path.join(tmpdir(), "storytree-channel-"));
    try {
      assert.equal(releaseChannel(home, marker), expected);
      assert.equal(releaseChannel(home, "nsis-stable"), expected);
      assert.equal(JSON.parse(readFileSync(path.join(home, "release-channel.json"), "utf8")).channel, expected);
      writeFileSync(path.join(home, "release-channel.json"), "{broken");
      assert.throws(() => releaseChannel(home, marker), /channel/i);
      writeFileSync(path.join(home, "release-channel.json"), '{"schema":1,"channel":"preview"}');
      assert.throws(() => releaseChannel(home, marker), /channel/i);
    } finally { rmSync(home, { recursive: true, force: true }); }
  }
});

test("4.15 an installation recorded on the channel's old name, development, follows alpha and never drifts to stable", () => {
  const home = mkdtempSync(path.join(tmpdir(), "storytree-channel-"));
  try {
    writeFileSync(path.join(home, "release-channel.json"), '{"schema":1,"channel":"development"}');
    assert.equal(releaseChannel(home, "nsis-stable"), "alpha");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("4.24 the user's channel choice is kept in the installation's release-channel.json; a fresh one reads stable, and a choice that is not one is refused", () => {
  const home = mkdtempSync(path.join(tmpdir(), "storytree-channel-"));
  try {
    const choice = releaseChannelChoice({ available: true, home, marker: () => "nsis-stable" });
    assert.deepEqual(choice.read(), { available: true, channel: "stable" });
    assert.deepEqual(choice.set("alpha"), { available: true, channel: "alpha" });
    assert.equal(releaseChannel(home, "nsis-stable"), "alpha", "the updater's next read follows the choice");
    for (const wrong of ["development", "preview", { channel: "stable" }]) assert.throws(() => choice.set(wrong), /alpha or stable/);
    assert.equal(releaseChannel(home, "nsis-stable"), "alpha", "a refused choice leaves the kept one");
    assert.deepEqual(choice.set("stable"), { available: true, channel: "stable" });
    assert.throws(() => releaseChannelChoice({ available: false, home, marker: () => "nsis-stable" }).set("alpha"), /installed/);
    assert.equal(releaseChannel(home, "nsis-stable"), "stable");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("4.34 the gear's channel read names the stable build and the day it was published, from the stable pin, only where releases install", async (t) => {
  const pin = (fields: object) => JSON.stringify({ schema: 1, channel: "stable", version: "0.3.2259", ...fields });
  const asked: string[] = [];
  const feed = (text: string) => async (url: string) => { asked.push(url); return text; };
  assert.deepEqual(await stableBuild(feed(pin({ releaseDate: "2026-11-02T22:10:00Z" }))), { version: "0.3.2259", published: "2026-11-02" });
  assert.deepEqual(asked, [`${STABLE_FEED}latest.yml`]);
  // A pin from before pins recorded the day, an unreadable one and a failed read name nothing, and the failure is logged.
  const logged: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => { logged.push(args); });
  assert.equal(await stableBuild(feed(pin({}))), undefined);
  assert.equal(await stableBuild(feed("{broken")), undefined);
  assert.equal(await stableBuild(async () => { throw new Error("offline"); }), undefined);
  assert.equal(logged.length, 2);

  const home = mkdtempSync(path.join(tmpdir(), "storytree-channel-"));
  try {
    const stable = async () => ({ version: "0.3.2259", published: "2026-11-02" });
    assert.deepEqual(await releaseChannelChoice({ available: true, home, marker: () => "nsis-stable", stable }).describe(),
      { available: true, channel: "stable", stable: { version: "0.3.2259", published: "2026-11-02" } });
    assert.deepEqual(await releaseChannelChoice({ available: false, home, marker: () => "nsis-stable", stable }).describe(), { available: false, channel: "stable" });
  } finally { rmSync(home, { recursive: true, force: true }); }
});
