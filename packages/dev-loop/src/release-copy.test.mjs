// Capability 11 · Carrying the repository to a new one: the release copy's hash check.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { fetchReleases, publishReleases } from "./release-copy.mjs";

const OLD = "storytree-ai/storytree";
const NEW = "storytree-ai/storytree-flip-rehearsal";
const sha = (text) => createHash("sha256").update(text).digest("hex");

/** The old repo's two releases, its stable feed and a fake target; `corrupt` names an asset the target serves changed. */
function github(corrupt) {
  const files = { "v0.3.1874": { "latest.yml": "version: 0.3.1874\n", "storytree-setup.exe": "installer 1874" }, "v0.3.1482": { "latest.yml": "version: 0.3.1482\n", "storytree-setup.exe": "installer 1482" } };
  const release = (tag, extra = {}) => ({ id: tag === "v0.3.1874" ? 1 : 2, tag_name: tag, name: tag, body: `notes for ${tag}`, prerelease: false, draft: false, ...extra,
    assets: Object.entries(files[tag]).map(([name, text]) => ({ name, size: text.length, digest: `sha256:${sha(text)}` })) });
  const calls = [];
  const target = new Map();
  return {
    calls,
    api(endpoint, method = "GET", body) {
      calls.push(`${method} ${endpoint}`);
      if (endpoint === `repos/${OLD}/releases/latest`) return { status: 200, json: release("v0.3.1874") };
      if (endpoint === `repos/${OLD}/contents/latest.yml?ref=release-channel-stable`) return { status: 200, json: { content: Buffer.from(JSON.stringify({ schema: 1, channel: "stable", version: "0.3.1482" })).toString("base64") } };
      if (endpoint === `repos/${OLD}/releases/tags/v0.3.1482`) return { status: 200, json: release("v0.3.1482") };
      if (endpoint === `repos/${NEW}`) return { status: 200, json: { default_branch: "main" } };
      if (endpoint.startsWith(`repos/${NEW}/releases/tags/`)) return { status: 404, json: null };
      if (endpoint === `repos/${NEW}/releases` && method === "POST") { target.set(body.tag_name, { id: target.size + 10, ...body }); return { status: 201, json: { id: target.size + 9, ...body } }; }
      if (endpoint.startsWith(`repos/${NEW}/releases/`) && method === "PATCH") return { status: 200, json: body };
      return { status: 404, json: null };
    },
    download(repo, tag, dir) {
      mkdirSync(dir, { recursive: true });
      for (const [name, text] of Object.entries(files[tag])) writeFileSync(path.join(dir, name), repo === NEW && name === corrupt ? `${text}!` : text);
    },
    upload(repo, tag, paths) { calls.push(`upload ${repo} ${tag} ${paths.map((p) => path.basename(p)).join(",")}`); },
  };
}

test("11.2 · the release copy fails when a copied asset's hash differs from its source's", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "release-copy-"));
  t.after(() => removeTemp(dir));

  const clean = github();
  const manifest = fetchReleases(clean, OLD, dir);
  assert.deepEqual(manifest.releases.map((r) => [r.tag_name, r.channel]), [["v0.3.1482", "stable"], ["v0.3.1874", "alpha"]]);
  assert.equal(manifest.releases[1].assets.find((a) => a.name === "latest.yml").sha256, sha("version: 0.3.1874\n"));

  const dry = publishReleases(clean, NEW, dir);
  assert.equal(clean.calls.filter((c) => !c.startsWith("GET")).length, 0, "a dry run writes nothing");
  assert.deepEqual(dry.map((r) => r.action), ["create", "create"]);

  const copied = publishReleases(clean, NEW, dir, { apply: true });
  assert.deepEqual(copied.map((r) => r.verified), [2, 2], "every asset of both releases hash-checked");
  assert.ok(clean.calls.includes(`PATCH repos/${NEW}/releases/11`), "the alpha release is published once checked");

  const broken = github("storytree-setup.exe");
  fetchReleases(broken, OLD, dir);
  assert.throws(() => publishReleases(broken, NEW, dir, { apply: true }), /v0\.3\.1482: storytree-setup\.exe differs from its source/);
  assert.ok(!broken.calls.some((c) => c.startsWith("PATCH")), "a release whose copy differs stays a draft");

  writeFileSync(path.join(dir, "v0.3.1874", "latest.yml"), "tampered\n");
  assert.throws(() => fetchReleases({ ...github(), download() {} }, OLD, dir), /v0\.3\.1874: latest\.yml does not match the digest GitHub gives/);
  assert.match(readFileSync(path.join(dir, "releases.json"), "utf8"), /v0\.3\.1482/);
});
