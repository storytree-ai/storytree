import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createIdentityService } from '/repo/packages/identity/src/service.ts';
import { createIdentityHandler } from '/repo/packages/identity/src/http.ts';

async function main() {
  const require = createRequire('/repo/packages/identity/package.json');
  const { generateKeyPair, exportJWK, SignJWT } = await import(pathToFileURL(require.resolve('jose')).href);
  const pair = await generateKeyPair('RS256');
  const wrongPair = await generateKeyPair('RS256');
  const publicKey = { ...await exportJWK(pair.publicKey), kid: 'synthetic-key', use: 'sig', alg: 'RS256' };
  const clientId = 'client_synthetic_challenge';
  const issuer = `https://api.workos.com/user_management/${clientId}`;
  const audience = 'synthetic-identity-api';
  const requests: string[] = [];
  let persistenceReached = 0;
  let linked: unknown[] = [{ type: 'OAuth', provider: 'GoogleOAuth', idp_id: 'synthetic-provider-subject' }];
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.workos.com');
    requests.push(url.pathname);
    if (url.pathname === `/sso/jwks/${clientId}`) return Response.json({ keys: [publicKey] });
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer synthetic-server-key');
    if (url.pathname === '/user_management/users/user_synthetic') {
      return Response.json({ id: 'user_synthetic', email_verified: true, email: 'synthetic@example.test' });
    }
    if (url.pathname === '/user_management/users/user_synthetic/identities') return Response.json(linked);
    throw new Error('Unexpected provider path in synthetic transport');
  };
  // A sentinel proves entry to the real remember(), without a database or copied persistence logic.
  const pool = { connect: async () => { persistenceReached++; throw new Error('synthetic persistence sentinel'); } };
  const service = createIdentityService({ pool: pool as never, clientId, issuer, audience, apiKey: 'synthetic-server-key', fetch: transport });
  const handler = createIdentityHandler(service);
  const now = Math.floor(Date.now() / 1000);
  async function sign(changes: Record<string, unknown> = {}, signingKey = pair.privateKey) {
    return new SignJWT({ sub: 'user_synthetic', sid: 'opaque-synthetic-session', iss: issuer, aud: audience, iat: now, exp: now + 120, ...changes })
      .setProtectedHeader({ alg: 'RS256', kid: 'synthetic-key' }).sign(signingKey);
  }
  async function call(label: string, token: string, expectedStatus: number, expectedPersistence: boolean) {
    const before = persistenceReached;
    const beforeRequests = requests.length;
    const response = await handler(new Request('https://identity.example.test/v1/identity', { headers: { Authorization: `Bearer ${token}` } }));
    assert.equal(response.status, expectedStatus);
    const reached = persistenceReached !== before;
    assert.equal(reached, expectedPersistence);
    console.log(JSON.stringify({ label, status: response.status, verificationReachedPersistence: reached, providerPaths: requests.slice(beforeRequests) }));
  }
  await call('valid-token-without-current-method-evidence', await sign(), 503, true);
  // This field is deliberately illustrative; no claim is made that WorkOS emits it.
  await call('illustrative-password-method-claim', await sign({ authentication_method: 'password' }), 503, true);
  await call('wrong-signature', await sign({}, wrongPair.privateKey), 401, false);
  await call('wrong-audience', await sign({ aud: 'wrong-api' }), 401, false);
  await call('expired', await sign({ exp: now - 10 }), 401, false);
  await call('missing-session', await sign({ sid: undefined }), 401, false);
  await call('blank-session', await sign({ sid: ' ' }), 401, false);
  linked = [];
  await call('token-supplied-identities-do-not-replace-provider-evidence', await sign({ identities: [{ type: 'OAuth', provider: 'GoogleOAuth', idp_id: 'forged-subject' }] }), 401, false);
  console.log(JSON.stringify({ noSessionStatusRequestObserved: !requests.some(path => path.includes('/sessions')), actualRevocationTested: false, actualProviderMintingMethodTested: false, databasePersistenceTested: false }));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
