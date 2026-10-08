// Package the host's platform. On Windows: x64/arm64 in one NSIS installer, keeping win-arm64-unpacked/
// and the arm64 portable exe for existing development uses. On macOS: an Apple Silicon .app as a zip
// (the update feed's) and a dmg, ad-hoc signed until a Developer ID is configured (then CSC_LINK, and
// notarised when Apple's credentials are in the environment). Only the release workflow publishes:
// even with GH_TOKEN or a tag in the environment, this command only builds artifacts and update metadata.
//
// ELECTRON_BUILDER_7Z_FILTER=BCJ: the 7-Zip that electron-builder uses compresses arm64
// executables with its ARM64 filter by default, and the 7z plugin in electron-builder's NSIS (which
// both the installer and portable exe unpack with) predates that filter. Without this, the exe
// unpacks every file but the .exe and .dll ones and fails to start. The x86 BCJ filter it decodes.
import { build } from "electron-builder";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stageTools } from "./tools.mjs";
import { deliveryAssets } from "./delivery-assets.mjs";

process.env.ELECTRON_BUILDER_7Z_FILTER ??= "BCJ";
const version = process.env.STORYTREE_RELEASE_VERSION;
if (version !== undefined && !/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid release version");
const mac = process.platform === "darwin";
await stageTools();
// Without a Developer ID, sign ad-hoc rather than not at all: Apple Silicon runs no unsigned code.
const identity = mac && !process.env.CSC_LINK ? { mac: { identity: "-", notarize: false } } : {};
await build({
  ...(mac ? { mac: [] } : { win: [] }), // use package.json's per-target architectures
  publish: "never",
  ...(version === undefined && !identity.mac ? {} : { config: { ...(version === undefined ? {} : { extraMetadata: { version } }), ...identity } }),
});
const here = path.dirname(fileURLToPath(import.meta.url));
if (!mac) deliveryAssets(path.join(here, "release"), version ?? JSON.parse(readFileSync(path.join(here, "package.json"), "utf8")).version);
