import assert from "node:assert/strict";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { makeDevHome } from "/repo/packages/app-setup/src/connect/dev-home.ts";
import { backUp } from "/repo/packages/app/src/lifecycle/backups.ts";
import { saveKey, authFile } from "/repo/packages/keys/src/keys.ts";
const original = process.umask();
const mode = p => (statSync(p).mode & 0o777).toString(8);
try {
  mkdirSync("/work/sign-in", {mode: 0o700});
  const fixture = JSON.stringify({synthetic: "not-an-actual-token"});
  writeFileSync("/work/sign-in/auth.json", fixture, {mode: 0o600});
  for (const mask of [0o022, 0o077]) {
    process.umask(mask);
    const dir = `/work/dev-${mask}`;
    await assert.rejects(makeDevHome({dir, harnesses:["codex"], signedIn:{codex:"/work/sign-in"}, build: async () => { throw new Error("synthetic-stop-before-build"); }}), /synthetic-stop-before-build/);
    const marker = `${dir}/storytree-dev-home.json`;
    assert.equal(JSON.parse(readFileSync(marker,"utf8")).codexSignIn.copied, fixture);
    assert.equal(mode(marker), mask === 0o022 ? "644" : "600");
    const snapshot = {project:"synthetic", records:[{id:"synthetic", fields:{description:"synthetic-private-record"}}], history:[{synthetic:true}]};
    const [file] = await backUp({storytree:{snapshot:async()=>snapshot}, projects:["synthetic"], dir:`/work/backups-${mask}`, now:new Date("2026-10-08T00:00:00Z")});
    assert.deepEqual(JSON.parse(readFileSync(file,"utf8")),snapshot);
    assert.equal(mode(file), mask === 0o022 ? "644" : "600");
    console.log(JSON.stringify({case:"permissions", umask:mask.toString(8), markerMode:mode(marker), developerHomeMode:mode(dir), authenticationCopyMode:mode(`${dir}/home/.codex/auth.json`), exactSyntheticDuplicate:true, backupMode:mode(file), backupDirectoryMode:mode(`/work/backups-${mask}`), snapshotPreserved:true, secondIdentityRead:false}));
  }
  process.umask(0o022);
  mkdirSync("/work/existing-keys",{mode:0o777});
  // Force the synthetic existing directory to the selected mode; this establishes mechanism only.
  const {chmodSync}=await import("node:fs"); chmodSync("/work/existing-keys",0o777);
  saveKey("postgres","synthetic",{home:"/work/existing-keys"});
  saveKey("postgres","synthetic",{home:"/work/fresh-keys"});
  assert.equal(mode("/work/existing-keys"),"777"); assert.equal(mode("/work/fresh-keys"),"700");
  assert.equal(mode(authFile({home:"/work/existing-keys"})),"600");
  console.log(JSON.stringify({case:"keys-directory-control",existingDirectoryMode:"777",freshDirectoryMode:"700",keyFileMode:"600",commandExecuted:false,separatePrincipalAccessEstablished:false}));
} finally {process.umask(original);}
