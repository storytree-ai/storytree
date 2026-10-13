import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// The release workflow's completeness check, kept with the packaging it describes (apps/desktop's
// release-assets.mjs). Each platform's runner uploads its own set into one draft; publishing waits for all.
// @ts-expect-error: a plain .mjs packaging script, outside the typed source
import { hostPlatform, missingAssets, platformUploads } from "../release-assets.mjs";
// @ts-expect-error: a plain .mjs packaging script, outside the typed source
import { linuxDeliveryAssets, macDeliveryAssets, mergeDelivery } from "../delivery-assets.mjs";

const windows = (version: string) => [
  `storytree-0.3-${version}-setup.exe`, `storytree-0.3-${version}-setup.exe.blockmap`, "latest.yml",
  "install-storytree.ps1", "install-storytree.txt", "install-storytree-development.txt", "storytree-delivery.json",
];
const mac = (version: string) => [
  `storytree-0.3-${version}-mac-arm64.zip`, `storytree-0.3-${version}-mac-arm64.zip.blockmap`,
  `storytree-0.3-${version}-arm64.dmg`, `storytree-0.3-${version}-arm64.dmg.blockmap`, "latest-mac.yml",
  "install-storytree.sh", "install-storytree-mac.txt", "install-storytree-mac-development.txt", "storytree-delivery-mac.json",
];
// The AppImage carries its blockmap inside it, so latest-linux.yml and its delivery entry are its only companions.
const linux = (version: string) => [`storytree-0.3-${version}-linux-x86_64.AppImage`, "latest-linux.yml", "storytree-delivery-linux.json"];

test("4.6 a release is published only when every platform's asset set is complete: Windows alone, or a Mac or Linux set missing its update feed, is refused", () => {
  const all = (version: string) => [...windows(version), ...mac(version), ...linux(version)];
  assert.deepEqual(missingAssets(all("0.3.700"), "0.3.700"), {});
  assert.deepEqual(missingAssets(windows("0.3.700"), "0.3.700"), { mac: mac("0.3.700"), linux: linux("0.3.700") });
  assert.deepEqual(missingAssets(all("0.3.700").filter((name) => name !== "latest-mac.yml"), "0.3.700"), { mac: ["latest-mac.yml"] });
  assert.deepEqual(missingAssets(all("0.3.700").filter((name) => name !== "latest-linux.yml"), "0.3.700"), { linux: ["latest-linux.yml"] });
  assert.deepEqual(missingAssets(all("0.3.700").filter((name) => !name.endsWith(".AppImage")), "0.3.700"), { linux: ["storytree-0.3-0.3.700-linux-x86_64.AppImage"] });
  // Another version's assets are not this release's.
  assert.deepEqual(Object.keys(missingAssets(all("0.3.699"), "0.3.700")), ["windows", "mac", "linux"]);
});

test("4.6 each platform's runner uploads only its own release assets, never build scratch files", () => {
  const built = [...windows("0.3.700"), ...mac("0.3.700"), ...linux("0.3.700"), "storytree-0.3-0.3.700-portable-arm64.exe", "builder-debug.yml", "builder-effective-config.yaml", "win-unpacked", "mac-arm64", "linux-unpacked"];
  assert.deepEqual(platformUploads("windows", built).sort(), [...windows("0.3.700"), "storytree-0.3-0.3.700-portable-arm64.exe"].sort());
  assert.deepEqual(platformUploads("mac", built).sort(), mac("0.3.700").sort());
  assert.deepEqual(platformUploads("linux", built).sort(), linux("0.3.700").sort());
});

test("4.6 a Linux runner uploads the Linux set; a system with no release platform is refused", () => {
  assert.equal(hostPlatform("linux"), "linux");
  assert.throws(() => hostPlatform("freebsd"), /freebsd/);
});

test("4.6 the Mac runner stages the shell bootstrap, its one-liners and the Mac app's checksum entry beside the zip", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-mac-delivery-"));
  try {
    const bytes = Buffer.from("the already-built Mac app zip");
    writeFileSync(path.join(dir, "storytree-0.3-0.3.700-mac-arm64.zip"), bytes);
    macDeliveryAssets(dir, "0.3.700");
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "storytree-delivery-mac.json"), "utf8")), {
      version: "0.3.700",
      macos: { arm64: { name: "storytree-0.3-0.3.700-mac-arm64.zip", sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length } },
    });
    assert.equal(readFileSync(path.join(dir, "install-storytree.sh"), "utf8"), readFileSync(new URL("../../../packages/app-setup/src/deliver/install.sh", import.meta.url), "utf8"));
    assert.equal(readFileSync(path.join(dir, "install-storytree-mac.txt"), "utf8"), "curl -fsSL https://raw.githubusercontent.com/storytree-ai/storytree/release-channel-stable/install-storytree.sh | sh\n");
    assert.equal(readFileSync(path.join(dir, "install-storytree-mac-development.txt"), "utf8"), "curl -fsSL https://github.com/storytree-ai/storytree/releases/latest/download/install-storytree.sh | sh -s -- --channel development\n");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("1.13 the Linux runner writes the AppImage's checksum entry beside it", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-linux-delivery-"));
  try {
    const bytes = Buffer.from("the already-built AppImage");
    writeFileSync(path.join(dir, "storytree-0.3-0.3.700-linux-x86_64.AppImage"), bytes);
    linuxDeliveryAssets(dir, "0.3.700");
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "storytree-delivery-linux.json"), "utf8")), {
      version: "0.3.700",
      linux: { x64: { name: "storytree-0.3-0.3.700-linux-x86_64.AppImage", sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length } },
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("1.13 publishing merges the Linux AppImage's entry beside the Mac app's, and refuses another version's", () => {
  const windows = { schema: 1, channelSchema: 1, version: "0.3.700", installer: { name: "storytree-0.3-0.3.700-setup.exe", sha256: "a".repeat(64), sha512: "b", size: 3 } };
  const arm64 = { name: "storytree-0.3-0.3.700-mac-arm64.zip", sha256: "c".repeat(64), size: 5 };
  const x64 = { name: "storytree-0.3-0.3.700-linux-x86_64.AppImage", sha256: "d".repeat(64), size: 7 };
  const merged = mergeDelivery(mergeDelivery(windows, { version: "0.3.700", macos: { arm64 } }), { version: "0.3.700", linux: { x64 } });
  assert.deepEqual(merged, { ...windows, macos: { arm64 }, linux: { x64 } });
  assert.throws(() => mergeDelivery(windows, { version: "0.3.699", linux: { x64 } }), /0\.3\.699/);
});

test("4.6 publishing merges the Mac app's entry into the release's delivery manifest, and refuses another version's", () => {
  const windows = { schema: 1, channelSchema: 1, version: "0.3.700", architectures: ["x64", "arm64"], installer: { name: "storytree-0.3-0.3.700-setup.exe", sha256: "a".repeat(64), sha512: "b", size: 3 } };
  const arm64 = { name: "storytree-0.3-0.3.700-mac-arm64.zip", sha256: "c".repeat(64), size: 5 };
  assert.deepEqual(mergeDelivery(windows, { version: "0.3.700", macos: { arm64 } }), { ...windows, macos: { arm64 } });
  // A rerun merges again to the same manifest.
  assert.deepEqual(mergeDelivery({ ...windows, macos: { arm64 } }, { version: "0.3.700", macos: { arm64 } }), { ...windows, macos: { arm64 } });
  assert.throws(() => mergeDelivery(windows, { version: "0.3.699", macos: { arm64 } }), /0\.3\.699/);
});

test("4.6 the release workflow's script loads under plain Node, so a source it imports cannot fail only after the merge", () => {
  // release.yml runs `node apps/desktop/release.mjs` with no loader: Node's type stripping does not map
  // a .ts file's './x.js' specifier to './x.ts'. Given no step, it loads everything, then refuses.
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  const run = spawnSync(process.execPath, [fileURLToPath(new URL("../release.mjs", import.meta.url))], { encoding: "utf8", env });
  assert.match(run.stderr, /Use source, draft, upload or publish/);
});
