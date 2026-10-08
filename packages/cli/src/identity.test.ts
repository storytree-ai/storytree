/** Identity 2.4: `storytree sign-in`, `status` and `sign-out` delegate to the identity story and stay usable unconfigured. */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { BuiltCommand, storytree } from "./testing/cli.js";

const command = new BuiltCommand();
before(() => command.build());
after(() => command.remove());

const unconfigured = { STORYTREE_WORKOS_CLIENT_ID: "", STORYTREE_IDENTITY_URL: "https://identity.invalid/v1/identity" };

test("identity 2.4: without a client ID, sign-in, status and sign-out each say sign-in is not configured and exit cleanly, outside any project", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-identity-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, "home");
  for (const verb of ["sign-in", "status", "sign-out"]) {
    const ran = await storytree(command.script, [verb], { cwd: dir, home, env: unconfigured });
    assert.equal(ran.code, 0, ran.stderr);
    assert.match(ran.stdout, /Sign-in is not configured/);
    assert.match(ran.stdout, /works without an account/);
  }
  assert.match((await storytree(command.script, ["status"], { cwd: dir, home, env: unconfigured })).stdout, /^Signed out\./);
  assert.equal(existsSync(path.join(home, "identity")), false, "nothing is stored when sign-in is not configured");
  assert.equal((await storytree(command.script, ["status", "extra"], { cwd: dir, home, env: unconfigured })).code, 2);
});

test("identity 2.4: configured by the client ID alone, status and sign-out reach identity's private session store under the storytree home, signed out; a malformed configuration is refused", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-identity-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, "home");
  const env = { STORYTREE_WORKOS_CLIENT_ID: "client_test", STORYTREE_IDENTITY_URL: "" };
  const status = await storytree(command.script, ["status"], { cwd: dir, home, env });
  assert.equal(status.code, 0, status.stderr);
  assert.equal(status.stdout, "Signed out. Storytree works without an account.\n");
  assert.ok(existsSync(path.join(home, "identity")), "identity keeps its session store under the storytree home");
  const signedOut = await storytree(command.script, ["sign-out"], { cwd: dir, home, env });
  assert.equal(signedOut.code, 0, signedOut.stderr);
  assert.match(signedOut.stdout, /^Signed out on this computer/);

  const malformed = await storytree(command.script, ["status"], { cwd: dir, home, env: { ...env, STORYTREE_WORKOS_CLIENT_ID: "not-a-client" } });
  assert.equal(malformed.code, 1);
  assert.match(malformed.stderr, /public WorkOS client ID/);
});
