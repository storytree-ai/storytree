import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createIdentityService, IdentityVerificationError } from '/repo/packages/identity/src/service.ts';
const require = createRequire('/repo/packages/identity/package.json');

async function main() {
  const { exportJWK, generateKeyPair, SignJWT } = await import(require.resolve('jose'));
  const pair = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(pair.publicKey), kid: 'synthetic-B', alg: 'RS256', use: 'sig' };
  const clientId = 'client_synthetic_B', issuer = 'https://issuer.example.invalid', audience = 'synthetic-B';
  let persistenceAttempts = 0;
  const requests: string[] = [];
  const service = createIdentityService({ clientId, issuer, audience, apiKey: 'synthetic-unused-B',
    pool: { connect: async () => { persistenceAttempts++; throw new Error('synthetic persistence stop'); } } as any,
    fetch: async (input) => {
      const url = new URL(String(input)); requests.push(url.pathname);
      assert.equal(url.origin, 'https://api.workos.com');
      if (url.pathname === `/sso/jwks/${clientId}`) return Response.json({ keys: [jwk] });
      if (url.pathname === '/user_management/users/user_synthetic_B') return Response.json({ id: 'user_synthetic_B', email: 'synthetic@example.invalid', email_verified: true });
      if (url.pathname === '/user_management/users/user_synthetic_B/identities') return Response.json([{ type: 'OAuth', provider: 'GoogleOAuth', idp_id: 'synthetic-subject' }]);
      throw new Error('Unexpected request; no real fetch is allowed');
    },
  });
  const now = Math.floor(Date.now() / 1000);
  async function token(changes: Record<string, unknown>) {
    return new SignJWT({ iss: issuer, aud: audience, sub: 'user_synthetic_B', sid: 'synthetic-unchecked-session', iat: now, exp: now + 300, ...changes })
      .setProtectedHeader({ alg: 'RS256', kid: 'synthetic-B' }).sign(pair.privateKey);
  }
  for (const [label, changes, reached] of [
    ['valid-unchecked-session', {}, true],
    ['illustrative-password-claim', { authentication_method: 'password' }, true],
    ['expired', { exp: now - 60 }, false],
    ['wrong-audience', { aud: 'another-audience' }, false],
    ['missing-session', { sid: undefined }, false],
  ] as const) {
    const before = persistenceAttempts;
    try { await service.resolve(await token(changes)); assert.fail('Expected synthetic stop'); }
    catch (error) {
      assert.equal(persistenceAttempts > before, reached);
      assert.equal(error instanceof IdentityVerificationError, !reached);
    }
    console.log(JSON.stringify({ label, reachedPersistence: persistenceAttempts > before }));
  }
  assert.equal(requests.some(path => path.includes('/sessions')), false);
  console.log(JSON.stringify({ requests, limit: 'Synthetic JWT and fetch seam; no SQL, WorkOS revocation, actual token-method semantics, hosting or downstream authorization demonstrated.' }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
