import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stageTools } from "./tools.mjs";
import { deliveryAssets, linuxDeliveryAssets, macDeliveryAssets } from "./delivery-assets.mjs";
import { builderEnv, packagedSigning, unsignedEnv } from "./mac-signing.mjs";

process.env.ELECTRON_BUILDER_7Z_FILTER ??= "BCJ";
const version = process.env.STORYTREE_RELEASE_VERSION;
if (version !== undefined && !/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid release version");
const mac = process.platform === "darwin";
await stageTools();
const signing = mac ? packagedSigning(process.env.STORYTREE_MAC_SIGNING) : undefined;
const here = path.dirname(fileURLToPath(import.meta.url));
const release = path.join(here, "release");
const identity = mac ? { mac: { identity: "-", notarize: false } } : {};
const env = mac ? builderEnv(process.env) : unsignedEnv(process.env);
for (const name of Object.keys(process.env)) if (!(name in env)) delete process.env[name];
Object.assign(process.env, env);
const { build } = await import("electron-builder");
const extraMetadata = { ...(version === undefined ? {} : { version }), ...(signing ? { storytree: { macSigning: signing } } : {}) };
await build({
  ...(mac ? { mac: [] } : process.platform === "linux" ? { linux: [] } : { win: [] }),
  publish: "never",
  ...(Object.keys(extraMetadata).length === 0 ? {} : { config: { extraMetadata, ...identity } }),
});
const built = version ?? JSON.parse(readFileSync(path.join(here, "package.json"), "utf8")).version;
(mac ? macDeliveryAssets : process.platform === "linux" ? linuxDeliveryAssets : deliveryAssets)(release, built);
