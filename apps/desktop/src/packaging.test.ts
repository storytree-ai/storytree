import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// The release workflow's completeness check, kept with the packaging it describes (apps/desktop's
// release-assets.mjs). Each platform's runner uploads its own set into one draft; publishing takes each complete set.
// @ts-expect-error: a plain .mjs packaging script, outside the typed source
import { hostPlatform, missingAssets, platformUploads, PLATFORMS } from "../release-assets.mjs";
// @ts-expect-error: a plain .mjs packaging script, outside the typed source
import { linuxDeliveryAssets, macDeliveryAssets } from "../delivery-assets.mjs";
import { releaseDelivery } from "@storytree/app/updates/release-carry";

// One NSIS installer per architecture; latest.yml names both, and each installed app's updater takes its own.
const windows = (version: string) => [
  ...["x64", "arm64"].flatMap((arch) => [`storytree-0.3-${version}-windows-${arch}-setup.exe`, `storytree-0.3-${version}-windows-${arch}-setup.exe.blockmap`]), "latest.yml",
  "install-storytree.ps1", "install-storytree.txt", "install-storytree-alpha.txt", "storytree-delivery.json",
];
const mac = (version: string) => [
  `storytree-0.3-${version}-mac-arm64.zip`, `storytree-0.3-${version}-mac-arm64.zip.blockmap`, "latest-mac.yml",
  "install-storytree.sh", "install-storytree-mac.txt", "install-storytree-mac-alpha.txt", "storytree-delivery-mac.json",
];
// The AppImage carries its blockmap inside it, so latest-linux.yml and its delivery entry are its only companions.
const linux = (version: string) => [`storytree-0.3-${version}-linux-x86_64.AppImage`, "latest-linux.yml", "storytree-delivery-linux.json"];

test("4.6 a platform's build is in a release only when its whole asset set is: a Mac or Linux set missing its update feed or app counts as absent", () => {
  const all = (version: string) => [...windows(version), ...mac(version), ...linux(version)];
  assert.deepEqual(missingAssets(all("0.3.700"), "0.3.700"), {});
  assert.deepEqual(missingAssets(windows("0.3.700"), "0.3.700"), { mac: mac("0.3.700"), linux: linux("0.3.700") });
  assert.deepEqual(missingAssets(all("0.3.700").filter((name) => name !== "latest-mac.yml"), "0.3.700"), { mac: ["latest-mac.yml"] });
  // Windows' build is in only with both architectures' installers.
  assert.deepEqual(missingAssets(all("0.3.700").filter((name) => !name.includes("arm64-setup")), "0.3.700"),
    { windows: ["storytree-0.3-0.3.700-windows-arm64-setup.exe", "storytree-0.3-0.3.700-windows-arm64-setup.exe.blockmap"] });
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
    assert.equal(readFileSync(path.join(dir, "install-storytree-mac-alpha.txt"), "utf8"), "curl -fsSL https://github.com/storytree-ai/storytree/releases/latest/download/install-storytree.sh | sh -s -- --channel alpha\n");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("app setup 1.13 the Linux runner writes the AppImage's checksum entry beside it", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-linux-delivery-"));
  try {
    const bytes = Buffer.from("the already-built AppImage");
    writeFileSync(path.join(dir, "storytree-0.3-0.3.700-linux-x86_64.AppImage"), bytes);
    linuxDeliveryAssets(dir, "0.3.700");
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "storytree-delivery-linux.json"), "utf8")), {
      version: "0.3.700",
      linux: { x64: { name: "storytree-0.3-0.3.700-linux-x86_64.AppImage", sha256: "d826718312a0cc15e225f19726b416e373df123331a5bbe901fcec2d0abc4207", size: 26 } },
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("app setup 1.13 publishing merges the Linux AppImage's entry beside the Mac app's, and refuses another version's", () => {
  const windows = { schema: 1, channelSchema: 1, version: "0.3.700", installers: { x64: { name: "storytree-0.3-0.3.700-windows-x64-setup.exe", sha256: "a".repeat(64), sha512: "b", size: 3 } } };
  const arm64 = { name: "storytree-0.3-0.3.700-mac-arm64.zip", sha256: "c".repeat(64), size: 5 };
  const x64 = { name: "storytree-0.3-0.3.700-linux-x86_64.AppImage", sha256: "d".repeat(64), size: 7 };
  const merged = releaseDelivery("0.3.700", { windows, mac: { version: "0.3.700", macos: { arm64 } }, linux: { version: "0.3.700", linux: { x64 } } });
  assert.deepEqual(merged, { ...windows, macos: { arm64 }, linux: { x64 } });
  assert.throws(() => releaseDelivery("0.3.700", { windows, mac: { version: "0.3.700", macos: { arm64 } }, linux: { version: "0.3.699", linux: { x64 } } }), /0\.3\.699/);
});

test("4.6 the release workflow's script loads under plain Node, so a source it imports cannot fail only after the merge", () => {
  // release.yml runs `node apps/desktop/release.mjs` with no loader: Node's type stripping does not map
  // a .ts file's './x.js' specifier to './x.ts'. Given no step, it loads everything, then refuses.
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  const run = spawnSync(process.execPath, [fileURLToPath(new URL("../release.mjs", import.meta.url))], { encoding: "utf8", env });
  assert.match(run.stderr, /Use source, draft, upload, publish, rehearse or rehearse-publish/);
});

test("4.6 with the Mac's build missing, the others publish and the Mac keeps its last good build's feed and app; once every build is in, nothing is carried", {
  skip: process.platform === "win32" && "platform:posix: GitHub's command line is stood in for by a shell script",
}, () => {
  const script = fileURLToPath(new URL("../release.mjs", import.meta.url));
  const root = mkdtempSync(path.join(tmpdir(), "storytree-publication-"));
  try {
    // GitHub, stood in for: the newest earlier release is v0.3.699, whose Mac build is its own.
    const earlier = path.join(root, "v0.3.699");
    mkdirSync(earlier);
    writeFileSync(path.join(earlier, "latest-mac.yml"), "version: 0.3.699\nfiles:\n  - url: storytree-0.3-0.3.699-mac-arm64.zip\n    size: 5\npath: storytree-0.3-0.3.699-mac-arm64.zip\n");
    const arm64 = { name: "storytree-0.3-0.3.699-mac-arm64.zip", sha256: "c".repeat(64), size: 5 };
    writeFileSync(path.join(earlier, "storytree-delivery.json"), JSON.stringify({ schema: 1, channelSchema: 1, version: "0.3.699", architectures: ["x64", "arm64"], installer: {}, macos: { arm64 } }));
    const bin = path.join(root, "bin");
    mkdirSync(bin);
    writeFileSync(path.join(bin, "gh"), `#!/bin/sh
case "$1 $2" in
  "api repos/storytree-ai/storytree/releases?per_page=20") echo '[{"tag_name":"v0.3.700","draft":true,"prerelease":false},{"tag_name":"v0.3.699","draft":false,"prerelease":false}]' ;;
  "release download") cp "${root}/$3/"* "$7" ;;
  *) echo "unexpected gh $*" >&2; exit 1 ;;
esac
`, { mode: 0o755 });
    const sets = path.join(root, "sets");
    mkdirSync(sets);
    const windowsEntry = { schema: 1, channelSchema: 1, version: "0.3.700", architectures: ["x64", "arm64"], installers: {
      x64: { name: "storytree-0.3-0.3.700-windows-x64-setup.exe", sha256: "a".repeat(64) }, arm64: { name: "storytree-0.3-0.3.700-windows-arm64-setup.exe", sha256: "b".repeat(64) } } };
    writeFileSync(path.join(sets, "windows.names"), windows("0.3.700").join("\n"));
    writeFileSync(path.join(sets, "storytree-delivery.json"), JSON.stringify(windowsEntry));
    writeFileSync(path.join(sets, "linux.names"), linux("0.3.700").join("\n"));
    const x64 = { name: "storytree-0.3-0.3.700-linux-x86_64.AppImage", sha256: "d".repeat(64), size: 7 };
    writeFileSync(path.join(sets, "storytree-delivery-linux.json"), JSON.stringify({ version: "0.3.700", linux: { x64 } }));
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, STORYTREE_RELEASE_VERSION: "0.3.700" };
    delete env.NODE_OPTIONS;
    delete env.STORYTREE_REHEARSAL;
    const run = () => spawnSync(process.execPath, [script, "rehearse-publish", sets], { encoding: "utf8", env });
    const noMac = run();
    assert.equal(noMac.status, 0, noMac.stderr);
    assert.match(noMac.stdout, /v0\.3\.700 has no new Mac build: Mac stays on 0\.3\.699\. Nothing was published\./);
    const manifest = JSON.parse(noMac.stdout.slice(noMac.stdout.indexOf("{")));
    assert.deepEqual(manifest, { ...windowsEntry, macos: { arm64: { ...arm64, version: "0.3.699" } }, linux: { x64 } });
    assert.match(readFileSync(path.join(sets, "latest-mac.yml"), "utf8"), /^  - url: \.\.\/v0\.3\.699\/storytree-0\.3-0\.3\.699-mac-arm64\.zip$/m);
    // The Mac's bootstrap is still in the release, so Linux's one-liner has one too.
    assert.equal(readFileSync(path.join(sets, "install-storytree.sh"), "utf8"), readFileSync(new URL("../../../packages/app-setup/src/deliver/install.sh", import.meta.url), "utf8"));
    // Once every platform's build is in, nothing is carried.
    writeFileSync(path.join(sets, "mac.names"), mac("0.3.700").join("\n"));
    writeFileSync(path.join(sets, "storytree-delivery-mac.json"), JSON.stringify({ version: "0.3.700", macos: { arm64: { ...arm64, name: "storytree-0.3-0.3.700-mac-arm64.zip" } } }));
    const all = run();
    assert.equal(all.status, 0, all.stderr);
    assert.match(all.stdout, /v0\.3\.700 carries every platform's new build/);
    // With no platform's build in, nothing publishes.
    for (const name of ["windows.names", "linux.names", "mac.names"]) rmSync(path.join(sets, name));
    const none = run();
    assert.notEqual(none.status, 0);
    assert.match(none.stderr, /has no platform's complete build/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("4.6 a release publishes once, after every upload; a published release takes no later upload, so a late platform's build waits for the next version", {
  skip: process.platform === "win32" && "platform:posix: GitHub's command line is stood in for by a shell script",
}, () => {
  const script = fileURLToPath(new URL("../release.mjs", import.meta.url));
  const root = mkdtempSync(path.join(tmpdir(), "storytree-publish-once-"));
  try {
    // A checkout whose origin/main holds the release's commit.
    const repo = path.join(root, "repo");
    mkdirSync(repo);
    const git = (...args: string[]) => spawnSync("git", args, { cwd: repo, encoding: "utf8" }).stdout.trim();
    git("init", "-q");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "release");
    const sha = git("rev-parse", "HEAD");
    git("update-ref", "refs/remotes/origin/main", sha);
    // GitHub, stood in for: every platform's set is in the v0.3.700 draft, and each call is logged.
    const assets = path.join(root, "assets");
    mkdirSync(assets);
    writeFileSync(path.join(assets, "storytree-delivery.json"), JSON.stringify({ schema: 1, channelSchema: 1, version: "0.3.700", architectures: ["x64", "arm64"], installers: {
      x64: { name: "storytree-0.3-0.3.700-windows-x64-setup.exe", sha256: "a".repeat(64) }, arm64: { name: "storytree-0.3-0.3.700-windows-arm64-setup.exe", sha256: "b".repeat(64) } } }));
    writeFileSync(path.join(assets, "storytree-delivery-mac.json"), JSON.stringify({ version: "0.3.700", macos: { arm64: { name: "storytree-0.3-0.3.700-mac-arm64.zip", sha256: "c".repeat(64), size: 5 } } }));
    writeFileSync(path.join(assets, "storytree-delivery-linux.json"), JSON.stringify({ version: "0.3.700", linux: { x64: { name: "storytree-0.3-0.3.700-linux-x86_64.AppImage", sha256: "d".repeat(64), size: 7 } } }));
    const release = { isDraft: true, targetCommitish: sha, assets: [...windows("0.3.700"), ...mac("0.3.700"), ...linux("0.3.700")].map((name) => ({ name })) };
    writeFileSync(path.join(root, "release.json"), JSON.stringify(release));
    const log = path.join(root, "gh.log");
    const bin = path.join(root, "bin");
    mkdirSync(bin);
    writeFileSync(path.join(bin, "gh"), `#!/bin/sh
echo "$*" >> "${log}"
case "$*" in
  "api repos/storytree-ai/storytree/releases/latest") echo "{\\"tag_name\\":\\"$LATEST\\"}" ;;
  "release view"*"--json body"*) echo "notes" ;;
  "release view"*) cat "${root}/release.json" ;;
  "release download"*) cp "${assets}/"* "$7" ;;
  "release upload"*|"release edit"*) ;;
  *) echo "unexpected gh $*" >&2; exit 1 ;;
esac
`, { mode: 0o755 });
    const run = (step: string, latest: string) => {
      writeFileSync(log, "");
      const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, LATEST: latest, RELEASE_SHA: sha,
        STORYTREE_RELEASE_VERSION: "0.3.700", GITHUB_OUTPUT: path.join(root, "output") };
      delete env.NODE_OPTIONS;
      delete env.STORYTREE_REHEARSAL;
      const result = spawnSync(process.execPath, [script, step], { cwd: repo, encoding: "utf8", env });
      assert.equal(result.status, 0, result.stderr);
      return { stdout: result.stdout, writes: readFileSync(log, "utf8").split("\n").filter((call) => /^release (upload|edit|create|delete)/.test(call)) };
    };
    // Against the draft: publishing is the last write, after its own upload and the notes.
    const published = run("publish", "v0.3.699");
    assert.ok(published.writes.length > 1, published.writes.join("\n"));
    assert.match(published.writes.at(-1)!, /^release edit v0\.3\.700 .*--draft=false/);
    assert.equal(published.writes.filter((call) => /--draft=false/.test(call)).length, 1);
    // Once it is published, a rerun platform's upload and a rerun publish write nothing, and pass.
    for (const step of ["upload", "publish"]) {
      const late = run(step, "v0.3.700");
      assert.deepEqual(late.writes, [], step);
      assert.match(late.stdout, /v0\.3\.700 is already published: a late build waits for the next version/, step);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("4.22 a release rehearsal never drafts, uploads or publishes, and checks only that this runner built its platform's complete set", () => {
  const script = fileURLToPath(new URL("../release.mjs", import.meta.url));
  const version = "0.3.700";
  const cwd = mkdtempSync(path.join(tmpdir(), "storytree-rehearsal-"));
  try {
    // No GitHub event, release identity or token is given: a step that got past the refusal would fail differently.
    const env: NodeJS.ProcessEnv = { ...process.env, STORYTREE_REHEARSAL: "true", STORYTREE_RELEASE_VERSION: version, GH_TOKEN: "" };
    delete env.NODE_OPTIONS;
    delete env.GITHUB_EVENT_PATH;
    delete env.RELEASE_SHA;
    const run = (step: string) => spawnSync(process.execPath, [script, step], { cwd, encoding: "utf8", env });
    for (const step of ["source", "draft", "upload", "publish"]) {
      const refused = run(step);
      assert.notEqual(refused.status, 0, step);
      assert.match(refused.stderr, new RegExp(`A rehearsal never runs ${step}`), step);
    }
    const release = path.join(cwd, "apps", "desktop", "release");
    mkdirSync(release, { recursive: true });
    const [first, ...rest]: string[] = PLATFORMS[hostPlatform()].required(version);
    assert.ok(first);
    for (const name of rest) writeFileSync(path.join(release, name), "");
    const incomplete = run("rehearse");
    assert.notEqual(incomplete.status, 0);
    assert.match(incomplete.stderr, new RegExp(first.replaceAll(".", "\\.")));
    writeFileSync(path.join(release, first), "");
    const complete = run("rehearse");
    assert.equal(complete.status, 0, complete.stderr);
    assert.match(complete.stdout, /nothing was drafted, uploaded or published/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
