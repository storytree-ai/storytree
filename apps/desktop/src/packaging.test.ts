import assert from "node:assert/strict";
import { test } from "node:test";

// The release workflow's completeness check, kept with the packaging it describes (apps/desktop's
// release-assets.mjs). Each platform's runner uploads its own set into one draft; publishing waits for all.
// @ts-expect-error: a plain .mjs packaging script, outside the typed source
import { missingAssets, platformUploads } from "../release-assets.mjs";

const windows = (version: string) => [
  `storytree-0.3-${version}-setup.exe`, `storytree-0.3-${version}-setup.exe.blockmap`, "latest.yml",
  "install-storytree.ps1", "install-storytree.txt", "install-storytree-development.txt", "storytree-delivery.json",
];
const mac = (version: string) => [
  `storytree-0.3-${version}-mac-arm64.zip`, `storytree-0.3-${version}-mac-arm64.zip.blockmap`,
  `storytree-0.3-${version}-arm64.dmg`, `storytree-0.3-${version}-arm64.dmg.blockmap`, "latest-mac.yml",
];

test("4.6 a release is published only when every platform's asset set is complete: Windows alone, or a Mac set missing its update feed, is refused", () => {
  assert.deepEqual(missingAssets([...windows("0.3.700"), ...mac("0.3.700")], "0.3.700"), {});
  assert.deepEqual(missingAssets(windows("0.3.700"), "0.3.700"), { mac: mac("0.3.700") });
  assert.deepEqual(missingAssets([...windows("0.3.700"), ...mac("0.3.700").filter((name) => name !== "latest-mac.yml")], "0.3.700"), { mac: ["latest-mac.yml"] });
  // Another version's assets are not this release's.
  assert.deepEqual(Object.keys(missingAssets([...windows("0.3.699"), ...mac("0.3.699")], "0.3.700")), ["windows", "mac"]);
});

test("4.6 each platform's runner uploads only its own release assets, never build scratch files", () => {
  const built = [...windows("0.3.700"), ...mac("0.3.700"), "storytree-0.3-0.3.700-portable-arm64.exe", "builder-debug.yml", "builder-effective-config.yaml", "win-unpacked", "mac-arm64"];
  assert.deepEqual(platformUploads("windows", built).sort(), [...windows("0.3.700"), "storytree-0.3-0.3.700-portable-arm64.exe"].sort());
  assert.deepEqual(platformUploads("mac", built).sort(), mac("0.3.700").sort());
});
