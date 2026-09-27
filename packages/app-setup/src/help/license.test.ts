import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readShippedLicense } from "./license.js";

test("4.1/4.2 reads the shipped resource without a checkout and reads a replacement after update", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "storytree-license-"));
  try {
    const resource = path.join(home, "LICENSE");
    const shipped = await readFile(new URL("../../../../LICENSE", import.meta.url), "utf8");
    await writeFile(resource, shipped);
    assert.equal(await readShippedLicense(resource), shipped);
    await writeFile(resource, "An updated license resource");
    assert.equal(await readShippedLicense(resource), "An updated license resource");
    await rm(resource);
    await assert.rejects(() => readShippedLicense(resource));
  } finally { await rm(home, { recursive: true, force: true }); }
});
