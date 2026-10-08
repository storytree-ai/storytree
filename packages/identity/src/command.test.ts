import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { identityCommand } from "./command.js";

const user = { id: "user_01ME", email: "me@example.test", email_verified: true };
const { privateKey, publicKey } = await generateKeyPair("RS256");
const jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" }] };
const accessToken = await new SignJWT({ sid: "session_01", aud: "storytree-identity" })
  .setProtectedHeader({ alg: "RS256", kid: "k1" }).setSubject(user.id).setIssuedAt().setExpirationTime("5m").sign(privateKey);
test("2.2/2.4 sign-in command output shows the browser code then verified identity; reopened status and sign-out keep tokens private", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "storytree-command-"));
  const output: string[] = [];
  let exchanges = 0;
  const transport: typeof fetch = async input => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith("/authorize/device")) return Response.json({ device_code: "device-private", user_code: "ABCD-EFGH", verification_uri: "https://example.authkit.app/device", expires_in: 300, interval: 1 });
    if (url.endsWith("/authenticate")) { exchanges++; return Response.json({ access_token: accessToken, refresh_token: "refresh-private", user }); }
    if (url === "https://api.workos.com/sso/jwks/client_test") return Response.json(jwks);
    return Response.json({ error: "unexpected_request" }, { status: 500 });
  };
  const options = { directory: path.join(home, "identity"), clientId: "client_test", out: (text: string) => output.push(text), fetch: transport, wait: async () => {} };
  try {
    assert.match(await identityCommand("status", options), /signed out/i);
    assert.equal(exchanges, 0);
    assert.match(await identityCommand("sign-in", options), /me@example.test/);
    assert.match(output.join("\n"), /ABCD-EFGH/);
    assert.doesNotMatch(output.join("\n"), /private/);
    assert.doesNotMatch(await readFile(path.join(home, "identity", "session"), "utf8"), /identity\.test|access/, "only the refresh token and its client are kept");
    assert.match(await identityCommand("status", options), /user_01ME/);
    assert.equal(exchanges, 2);
    assert.match(await identityCommand("sign-out", options), /this computer/);
    assert.match(await identityCommand("status", options), /signed out/i);
    assert.equal(exchanges, 2);
  } finally { await rm(home, { recursive: true, force: true }); }
});
