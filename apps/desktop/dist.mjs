// Package Windows x64/arm64 in one NSIS installer. Keep win-arm64-unpacked/ and the arm64 portable
// exe for existing development uses. Only the release workflow publishes: even with GH_TOKEN or
// a tag in the environment, this command only builds artifacts and update metadata.
//
// ELECTRON_BUILDER_7Z_FILTER=BCJ: the 7-Zip that electron-builder uses compresses arm64
// executables with its ARM64 filter by default, and the 7z plugin in electron-builder's NSIS (which
// both the installer and portable exe unpack with) predates that filter. Without this, the exe
// unpacks every file but the .exe and .dll ones and fails to start. The x86 BCJ filter it decodes.
import { build } from "electron-builder";

process.env.ELECTRON_BUILDER_7Z_FILTER ??= "BCJ";
const version = process.env.STORYTREE_RELEASE_VERSION;
if (version !== undefined && !/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid release version");
await build({
  win: [], // use package.json's per-target architectures, even when packaging from another OS
  publish: "never",
  ...(version === undefined ? {} : { config: { extraMetadata: { version } } }),
});
