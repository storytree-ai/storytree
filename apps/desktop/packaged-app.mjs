import { readFileSync } from "node:fs";
import path from "node:path";
import asar from "@electron/asar";
import fuses from "@electron/fuses";

const { FuseV1Options, getCurrentFuseWire } = fuses;
const ENABLED = 49;
const DISABLED = 48;

export function archiveVersion(archive) {
  return JSON.parse(asar.extractFile(archive, "package.json").toString("utf8")).version;
}

export function buildFuses(packageFile = path.join(import.meta.dirname, "package.json")) {
  const { resetAdHocDarwinSignature: _signing, ...named } = JSON.parse(readFileSync(packageFile, "utf8")).build.electronFuses ?? {};
  return named;
}

export async function fuseMismatches(executable, wanted = buildFuses()) {
  const wire = await getCurrentFuseWire(executable);
  return Object.entries(wanted).flatMap(([name, on]) => {
    const index = FuseV1Options[name[0].toUpperCase() + name.slice(1)];
    if (index === undefined) return [`${name}: not a fuse this check knows`];
    const found = wire[index];
    if (found === (on ? ENABLED : DISABLED)) return [];
    const state = found === ENABLED ? "on" : found === DISABLED ? "off" : found === undefined ? "absent" : `byte ${found}`;
    return [`${name}: wanted ${on ? "on" : "off"}, found ${state}`];
  });
}
