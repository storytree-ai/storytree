import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { capturePath } from "../evidence/capture-path.mjs";

const captures = ["terminal.mjs", "turn/capture.mjs", "journey/capture.mjs", "arrival/capture.mjs",
  "nameplates-phone/capture.mjs", "warm-globe/measure.mjs", "capture.mjs"];

// Execute each helper's actual server registration with a synthetic build root. Stop before listen/browser
// startup: only the HTTP transport is replaced, and readFile still reads the disposable fixture's real files.
async function handlerFor(capture, dist) {
  const source = await readFile(new URL(`../evidence/${capture}`, import.meta.url), "utf8");
  const start = source.indexOf("const types = ");
  const end = source.indexOf("await new Promise", start);
  assert.ok(start >= 0 && end > start, `${capture}: locate the server registration`);
  return runInNewContext(`${source.slice(start, end)}\nserver`, {
    createServer: handler => handler, readFile, path, dist, URL, capturePath,
  }, { timeout: 1000 });
}

async function request(handler, url) {
  const response = {
    status: 200, headers: {}, body: "",
    setHeader(name, value) { this.headers[name] = value; return this; },
    writeHead(status, headers = {}) { this.status = status; Object.assign(this.headers, headers); return this; },
    end(body = "") { this.body = body.toString(); return this; },
  };
  await handler({ url }, response);
  return response;
}

for (const capture of captures) {
  test(`3.13 · ${capture} contains file requests and keeps serving after malformed URLs`, async t => {
    const root = await mkdtemp(path.join(tmpdir(), "website-capture-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const dist = path.join(root, "dist");
    await mkdir(path.join(dist, "assets"), { recursive: true });
    await mkdir(path.join(root, "dist-adjacent"));
    await writeFile(path.join(dist, "index.html"), "synthetic home");
    await writeFile(path.join(dist, "404.html"), "synthetic not found");
    await writeFile(path.join(dist, "assets", "a b.js"), "synthetic script");
    await writeFile(path.join(root, "marker.txt"), "synthetic parent marker");
    await writeFile(path.join(root, "dist-adjacent", "marker.txt"), "synthetic adjacent marker");
    const handler = await handlerFor(capture, dist);

    await t.test("normal assets and missing files", async () => {
      const home = await request(handler, "/");
      assert.equal(home.status, 200);
      assert.equal(home.body, "synthetic home");
      assert.equal(home.headers["Content-Type"], "text/html");
      const asset = await request(handler, "/assets/a%20b.js?cache=1");
      assert.equal(asset.status, 200);
      assert.equal(asset.body, "synthetic script");
      assert.equal(asset.headers["Content-Type"], "text/javascript");
      const missing = await request(handler, "/absent");
      assert.equal(missing.status, 404);
      assert.equal(missing.body, capture === "capture.mjs" ? "synthetic not found" : "");
    });

    await t.test("decoded paths cannot read the parent or a same-prefix sibling", async () => {
      for (const url of ["/%2e%2e%2fmarker.txt", "/..%2fmarker.txt", "/assets%2f..%2f..%2fmarker.txt",
        "/..%2fdist-adjacent%2fmarker.txt", "/..%2fdist", "/assets%2f..%2f..%2fdist-adjacent%2fmarker.txt",
        ...(process.platform === "win32" ? ["/..%5cmarker.txt", "/..%5cdist-adjacent%5cmarker.txt"] : [])]) {
        const denied = await request(handler, url);
        assert.equal(denied.status, 403, url);
        assert.equal(denied.body, "", url);
      }
    });

    await t.test("malformed URL responses do not reject or break the next request", async () => {
      for (const url of ["/%", "/%GG", "/%E0%A4%A", "http://[", "/%00"]) {
        const malformed = await request(handler, url);
        assert.equal(malformed.status, 400, url);
        assert.equal(malformed.body, "", url);
      }
      assert.equal((await request(handler, "/")).body, "synthetic home");
    });
  });
}
