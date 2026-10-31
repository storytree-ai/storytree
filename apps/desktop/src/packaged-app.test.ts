import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { finished } from "node:stream/promises";
import { test } from "node:test";
import asar from "@electron/asar";
import fuses from "@electron/fuses";

// @ts-expect-error: a plain .mjs packaging script, outside the typed source
import { archiveVersion, buildFuses, fuseMismatches } from "../packaged-app.mjs";

test("4.28 the install checks read a packaged app's version from its archive, without running it as Node", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "packaged-app-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, "app"));
  writeFileSync(path.join(dir, "app", "package.json"), JSON.stringify({ name: "storytree-0.3", version: "0.3.912" }));
  // createPackage resolves once its write stream is ended, not flushed: reading at once can find the file's bytes not yet
  // on disk (zeros where package.json should be), so wait for the stream to finish.
  await finished(await asar.createPackage(path.join(dir, "app"), path.join(dir, "app.asar")));
  assert.equal(archiveVersion(path.join(dir, "app.asar")), "0.3.912");
});

test("4.28 an install check fails a packaged app whose fuses are not set as the build sets them, naming each one", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "packaged-fuses-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // A stand-in executable carrying Electron's fuse wire as an unflipped Electron has it: version 1, eight fuses, every
  // one on (as Electron ships runAsNode, NODE_OPTIONS and the inspector).
  const executable = path.join(dir, "storytree-0.3");
  writeFileSync(executable, Buffer.concat([Buffer.from("ELF-ish prefix "), Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX"), Buffer.from([1, 8]), Buffer.alloc(8, 49), Buffer.from(" suffix")]));
  const wanted = buildFuses();
  assert.deepEqual(wanted, {
    runAsNode: false, enableNodeOptionsEnvironmentVariable: false, enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true, onlyLoadAppFromAsar: true, grantFileProtocolExtraPrivileges: false,
  });
  assert.deepEqual(await fuseMismatches(executable, wanted), [
    "runAsNode: wanted off, found on",
    "enableNodeOptionsEnvironmentVariable: wanted off, found on",
    "enableNodeCliInspectArguments: wanted off, found on",
    "grantFileProtocolExtraPrivileges: wanted off, found on",
  ]);
  // Flipped as electron-builder flips them from the same config, it passes; one fuse put back fails it again.
  const { FuseV1Options, FuseVersion, flipFuses } = fuses;
  const flip = (name: string, on: boolean) => [FuseV1Options[(name.charAt(0).toUpperCase() + name.slice(1)) as keyof typeof FuseV1Options], on];
  await flipFuses(executable, { version: FuseVersion.V1, ...Object.fromEntries(Object.entries(wanted as Record<string, boolean>).map(([name, on]) => flip(name, on))) });
  assert.deepEqual(await fuseMismatches(executable, wanted), []);
  await flipFuses(executable, { version: FuseVersion.V1, [FuseV1Options.RunAsNode]: true });
  assert.deepEqual(await fuseMismatches(executable, wanted), ["runAsNode: wanted off, found on"]);
});
