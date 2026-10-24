// Package the host's platform. On Windows: an NSIS installer for each of x64 and arm64, keeping win-arm64-unpacked/
// and the arm64 portable exe for existing development uses. On macOS: an Apple Silicon .app as a zip
// (the update feed's and install.sh's), ad-hoc signed until a Developer ID is configured (then signed as the
// identity mac-signing.mjs prepare put in a keychain, and once signed submitted to Apple, whose answer is waited for
// only until a bound and written to release/mac-notarisation.json for the upload's release note; an accepted ticket
// is stapled to the app before the zip is made from it). On Linux: an x64 AppImage, whose update
// feed is latest-linux.yml; its one-command delivery is the curl install's. Only the release workflow publishes:
// even with GH_TOKEN or a tag in the environment, this command only builds artifacts and update metadata.
//
// ELECTRON_BUILDER_7Z_FILTER=BCJ: the 7-Zip that electron-builder uses compresses arm64
// executables with its ARM64 filter by default, and the 7z plugin in electron-builder's NSIS (which
// both the installer and portable exe unpack with) predates that filter. Without this, the exe
// unpacks every file but the .exe and .dll ones and fails to start. The x86 BCJ filter it decodes.
//
// electron-builder is imported only once the environment it builds in is set (builderEnv, unsignedEnv): an unsigned
// build drops every certificate variable first, so nothing electron-builder loads ever sees a signing secret.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stageTools } from "./tools.mjs";
import { deliveryAssets, linuxDeliveryAssets, macDeliveryAssets } from "./delivery-assets.mjs";
import { builderEnv, macBuilderConfig, macNotarisation, macSigning, unsignedEnv } from "./mac-signing.mjs";

process.env.ELECTRON_BUILDER_7Z_FILTER ??= "BCJ";
const version = process.env.STORYTREE_RELEASE_VERSION;
if (version !== undefined && !/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid release version");
const mac = process.platform === "darwin";
await stageTools();
// Without a Developer ID, sign ad-hoc rather than not at all: Apple Silicon runs no unsigned code.
// A pull request's build signs too, either way, and CI proves the signature (builderEnv).
// A certificate without Apple's notarisation key is refused here, before anything builds (contract 4.20).
const signing = mac ? macSigning(process.env) : undefined;
const here = path.dirname(fileURLToPath(import.meta.url));
const release = path.join(here, "release");
const identity = signing ? { mac: macBuilderConfig(signing), ...macNotarisation(signing, path.join(release, "mac-notarisation.json")) } : {};
const env = mac ? builderEnv(process.env) : unsignedEnv(process.env);
for (const name of Object.keys(process.env)) if (!(name in env)) delete process.env[name];
Object.assign(process.env, env);
const { build } = await import("electron-builder");
// The packaged package.json records the Mac signing mode: only a Developer ID build follows releases (updates 4.21),
// because Squirrel.Mac refuses an update to an app that is not Developer ID signed.
const extraMetadata = { ...(version === undefined ? {} : { version }), ...(signing ? { storytree: { macSigning: signing.mode } } : {}) };
await build({
  ...(mac ? { mac: [] } : process.platform === "linux" ? { linux: [] } : { win: [] }), // use package.json's per-target architectures
  publish: "never",
  ...(Object.keys(extraMetadata).length === 0 ? {} : { config: { extraMetadata, ...identity } }),
});
const built = version ?? JSON.parse(readFileSync(path.join(here, "package.json"), "utf8")).version;
(mac ? macDeliveryAssets : process.platform === "linux" ? linuxDeliveryAssets : deliveryAssets)(release, built);
