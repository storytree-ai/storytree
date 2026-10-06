import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { identityCommand } from "./command.js";

const user = { id: "76c80829-6cfd-4f1e-95e8-9a9c781529ce", email: "me@example.test" };
test("2.2/2.4 sign-in command output shows the browser code then verified identity; reopened status and sign-out keep tokens private", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "storytree-command-"));
  const output: string[] = [];
  let exchanges = 0;
  const transport: typeof fetch = async input => {
    const url = String(input);
    if (url.endsWith("/authorize/device")) return Response.json({ device_code: "device-private", user_code: "ABCD-EFGH", verification_uri: "https://example.authkit.app/device", expires_in: 300, interval: 1 });
    if (url.endsWith("/authenticate")) { exchanges++; return Response.json({ access_token: "access-private", refresh_token: "refresh-private" }); }
    return Response.json(user);
  };
  const options = { directory: path.join(home, "identity"), clientId: "client_test", identityUrl: "https://identity.test/v1/identity", out: (text: string) => output.push(text), fetch: transport, wait: async () => {} };
  try {
    assert.match(await identityCommand("status", options), /signed out/i);
    assert.equal(exchanges, 0);
    assert.match(await identityCommand("sign-in", options), /me@example.test/);
    assert.match(output.join("\n"), /ABCD-EFGH/);
    assert.doesNotMatch(output.join("\n"), /private/);
    assert.match(await identityCommand("status", options), /76c80829/);
    assert.equal(exchanges, 2);
    assert.match(await identityCommand("sign-out", options), /this computer/);
    assert.match(await identityCommand("status", options), /signed out/i);
    assert.equal(exchanges, 2);
  } finally { await rm(home, { recursive: true, force: true }); }
});
