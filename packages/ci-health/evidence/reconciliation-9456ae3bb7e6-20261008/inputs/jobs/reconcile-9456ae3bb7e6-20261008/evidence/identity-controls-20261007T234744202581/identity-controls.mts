import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createIdentityService } from "/repo/packages/identity/src/service.ts";
const require = createRequire("/repo/packages/identity/package.json");
const {generateKeyPair, exportJWK, SignJWT} = await import(pathToFileURL(require.resolve("jose")).href);
const keys = await generateKeyPair("RS256");
const jwk = {...await exportJWK(keys.publicKey), kid:"synthetic",alg:"RS256",use:"sig"};
const clientId="client_synthetic", issuer="https://synthetic.invalid/issuer", audience="synthetic-identity";
let connects=0; const paths=[];
const service=createIdentityService({clientId,issuer,audience,apiKey:"synthetic-key",pool:{connect:async()=>{connects++;throw new Error("synthetic-stop-before-persistence");}},fetch:async(input)=>{
 const u=new URL(String(input)); assert.equal(u.origin,"https://api.workos.com"); paths.push(u.pathname);
 if(u.pathname===`/sso/jwks/${clientId}`)return Response.json({keys:[jwk]});
 if(u.pathname==="/user_management/users/user_synthetic")return Response.json({id:"user_synthetic",email:"synthetic@example.invalid",email_verified:true});
 if(u.pathname==="/user_management/users/user_synthetic/identities")return Response.json([{type:"OAuth",provider:"GoogleOAuth",idp_id:"synthetic-provider-subject"}]);
 throw new Error("unexpected synthetic endpoint");
}});
for(const [label,changes,expected] of [
 ["valid-signed-token",{},1],
 ["illustrative-password-claim",{authentication_method:"password"},1],
 ["arbitrary-nonempty-session",{sid:"synthetic-unrecognised-session"},1],
 ["expired-control",{exp:1},0],
 ["wrong-audience-control",{aud:"different"},0],
 ["empty-session-control",{sid:""},0],
]){
 const before=connects; const now=Math.floor(Date.now()/1000);
 const token=await new SignJWT({iss:issuer,aud:audience,sub:"user_synthetic",sid:"session_synthetic",iat:now,exp:now+120,...changes}).setProtectedHeader({alg:"RS256",kid:"synthetic"}).sign(keys.privateKey);
 await assert.rejects(service.resolve(token));
 assert.equal(connects-before,expected);
 console.log(JSON.stringify({case:label,reachedPersistenceBoundary:connects-before===1,providerSemanticsVerified:false}));
}
assert.equal(paths.some(p=>p.includes("/sessions/")),false);
console.log(JSON.stringify({case:"requests",distinctPaths:[...new Set(paths)],realWorkOSCalls:0,realDatabaseCalls:0}));
