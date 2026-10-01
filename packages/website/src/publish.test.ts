import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { publishWebsite } from "./publish.js";

const api = "https://here.now/api/v1/publish/crisp-globe-bf6v";
const site = "https://crisp-globe-bf6v.here.now/";
const token = "test-secret-token";
const files = new Map([
  ["index.html", Buffer.from("<main>storytree</main>")],
  ["404.html", Buffer.from('<a href="/">Home</a>')],
  ["assets/styles.css", Buffer.from("body { color: green; }")],
  ["assets/nested/tree.png", Buffer.from([137, 80, 78, 71, 0, 255, 128])],
]);

async function buildFolder(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), "website-publish-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [name, bytes] of files) {
    await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
    await writeFile(path.join(directory, name), bytes);
  }
  return directory;
}

const live = {
  success: true,
  slug: "crisp-globe-bf6v",
  currentVersionId: "version-1",
  publishStatus: { state: "live" },
};

test("4.2 · no publishing key clearly skips, naming the identity to configure, before reading a build or making requests", async (t) => {
  const directory = path.join(await buildFolder(t), "missing-build");
  for (const absent of [undefined, "", " \n\t "]) {
    const logs: string[] = [];
    let requests = 0;
    await publishWebsite({ directory, token: absent, log: (message) => logs.push(message), fetch: async () => {
      requests++;
      throw new Error("Publishing must not make a request without a token");
    } });
    assert.equal(requests, 0);
    assert.match(logs.join("\n"), /skipped.*WEBSITE_WIF_PROVIDER.*WEBSITE_SERVICE_ACCOUNT/i);
  }
});

test("4.1 · publishing replaces the fixed site from its full static manifest and confirms the uploaded version is live", async (t) => {
  const directory = await buildFolder(t);
  const logs: string[] = [];
  const requests: string[] = [];
  const pending = ["index.html", "assets/nested/tree.png"];
  const skipped = ["404.html", "assets/styles.css"];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push(url);
    assert.ok(init?.signal, "Every request must have a timeout signal");
    const headers = new Headers(init.headers);
    if (url === api) {
      assert.equal(init.method, "PUT");
      assert.equal(headers.get("authorization"), `Bearer ${token}`);
      assert.equal(headers.get("content-type"), "application/json");
      assert.equal(headers.get("x-herenow-client"), "codex/storytree-ci");
      const manifest = JSON.parse(String(init.body)).files;
      assert.deepEqual(manifest.sort((a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path)), [...files].map(([name, bytes]) => ({
        path: name,
        size: bytes.length,
        contentType: name.endsWith(".png") ? "image/png" : name.endsWith(".css") ? "text/css; charset=utf-8" : "text/html; charset=utf-8",
        hash: createHash("sha256").update(bytes).digest("hex"),
      })).sort((a, b) => a.path.localeCompare(b.path)));
      return Response.json({ upload: { versionId: "version-1", skipped, finalizeUrl: `${api}/finalize`, uploads: pending.map((name) => ({
        path: name, method: "PUT", url: `https://storage.example/${name}?signed=private`, headers: { "Content-Type": "application/octet-stream", "x-storage-header": "required" },
      })) } });
    }
    if (url === `${api}/finalize`) {
      assert.equal(init.method, "POST");
      assert.equal(headers.get("authorization"), `Bearer ${token}`);
      assert.equal(headers.get("content-type"), "application/json");
      assert.equal(headers.get("x-herenow-client"), "codex/storytree-ci");
      assert.deepEqual(JSON.parse(String(init.body)), { versionId: "version-1" });
      assert.equal(requests.length, 4, "Finalize follows both required uploads");
      assert.doesNotMatch(logs.join("\n"), /published|live/i);
      return Response.json(live);
    }
    const name = new URL(url).pathname.slice(1);
    assert.ok(pending.includes(name), "Only requested changed files are uploaded");
    assert.equal(init.method, "PUT");
    assert.equal(headers.get("authorization"), null, "The API token never goes to storage");
    assert.equal(headers.get("x-herenow-client"), null);
    assert.equal(headers.get("x-storage-header"), "required");
    assert.equal(headers.get("content-type"), "application/octet-stream");
    assert.deepEqual(Buffer.from(await new Response(init.body).arrayBuffer()), files.get(name));
    return new Response(null, { status: 200 });
  };
  await publishWebsite({ directory, token: ` ${token} `, fetch, log: (message) => logs.push(message) });
  assert.equal(requests.length, 4);
  assert.equal(requests[0], api);
  assert.equal(requests.at(-1), `${api}/finalize`);
  assert.ok(logs.some((message) => /published|live/i.test(message) && message.includes(site)));
  assert.doesNotMatch(logs.join("\n"), /test-secret-token|signed=private/);
});

test("4.1 · a failed or malformed publishing step cannot report success or proceed to the next step", async (t) => {
  const directory = await buildFolder(t);
  const staged = { upload: { versionId: "version-1", skipped: ["404.html", "assets/styles.css", "assets/nested/tree.png"], finalizeUrl: `${api}/finalize`, uploads: [
    { path: "index.html", method: "PUT", url: "https://storage.example/index.html?signed=private", headers: {} },
  ] } };
  const cases = [
    { name: "manifest HTTP failure", responses: [() => new Response(`private body ${token}`, { status: 403 })], stage: /manifest.*403/i },
    { name: "unknown upload path", responses: [() => Response.json({ upload: { ...staged.upload, uploads: [{ ...staged.upload.uploads[0], path: "../outside.txt" }] } })], stage: /manifest|upload plan/i },
    { name: "malformed upload plan", responses: [() => Response.json({ upload: { versionId: "version-1" } })], stage: /manifest|upload plan/i },
    { name: "storage HTTP failure", responses: [() => Response.json(staged), () => new Response(`private body ${token}`, { status: 503 })], stage: /upload.*503/i },
    { name: "storage network failure", responses: [() => Response.json(staged), () => { throw new Error(`https://storage.example/?signed=private ${token}`); }], stage: /upload/i },
    { name: "finalize not live", responses: [() => Response.json(staged), () => new Response(), () => Response.json({ ...live, publishStatus: { state: "pending" } })], stage: /finaliz/i },
    { name: "finalize wrong version", responses: [() => Response.json(staged), () => new Response(), () => Response.json({ ...live, currentVersionId: "old-version" })], stage: /finaliz/i },
  ];
  for (const failure of cases) await t.test(failure.name, async () => {
    let requests = 0;
    const logs: string[] = [];
    await assert.rejects(publishWebsite({ directory, token, log: (message) => logs.push(message), fetch: async () => {
      const response = failure.responses[requests++];
      assert.ok(response, "A failure must prevent the next publishing step");
      return response();
    } }), (error: Error) => {
      assert.match(error.message, failure.stage);
      assert.doesNotMatch(error.message, /private body|test-secret-token|signed=private/);
      return true;
    });
    assert.equal(requests, failure.responses.length);
    assert.doesNotMatch(logs.join("\n"), /published|live|test-secret-token|signed=private/i);
  });
});

test("4.1 · incomplete builds and linked files cannot replace the live website", async (t) => {
  for (const invalid of ["missing page", "symlink"]) await t.test(invalid, async (t) => {
    const directory = await buildFolder(t);
    if (invalid === "missing page") await rm(path.join(directory, "404.html"));
    else await symlink(directory, path.join(directory, "linked"), "junction");
    let requests = 0;
    await assert.rejects(publishWebsite({ directory, token, log: () => {}, fetch: async () => {
      requests++;
      return Response.json({});
    } }), /build|symlink|symbolic link|404\.html/i);
    assert.equal(requests, 0);
  });
});
