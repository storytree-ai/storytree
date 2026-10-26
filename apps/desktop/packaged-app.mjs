// What the install checks read from a packaged app without starting it as Node (contract 4.28): the version in its
// app archive, and whether its executable's Electron fuses are set as package.json's build config sets them. The
// packaged app cannot be run as Node (its runAsNode fuse is off), so the version is read from the archive itself.
// grantFileProtocolExtraPrivileges is off: the app's page is served from its own scheme (contract 1.41), not file://, and
// the install checks start the app with --page-check to prove that page still loads.
import { readFileSync } from "node:fs";
import path from "node:path";
import asar from "@electron/asar";
import fuses from "@electron/fuses";

const { FuseV1Options, getCurrentFuseWire } = fuses;
// Electron's fuse states, as bytes on the fuse wire.
const ENABLED = 49;
const DISABLED = 48;

/** The version in the package.json of the app archive (app.asar) at `archive`. */
export function archiveVersion(archive) {
  return JSON.parse(asar.extractFile(archive, "package.json").toString("utf8")).version;
}

/** The fuses electron-builder sets, as named in the build config of the package.json at `packageFile`. */
export function buildFuses(packageFile = path.join(import.meta.dirname, "package.json")) {
  const { resetAdHocDarwinSignature: _signing, ...named } = JSON.parse(readFileSync(packageFile, "utf8")).build.electronFuses ?? {};
  return named;
}

/**
 * Each fuse of the executable at `executable` (a Mac's .app, or the app's own executable) that is not as `wanted` says,
 * as "<name>: wanted on|off, found <state>". Empty when every wanted fuse is set as wanted.
 */
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
