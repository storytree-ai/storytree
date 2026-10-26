import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseArgs } from "./args.js";
import { checkPage, PAGE_SCHEME, pageResponse, pageUrl } from "./page-scheme.js";

function rendererFolder(t: { after(fn: () => void): void }): string {
  const root = mkdtempSync(path.join(tmpdir(), "page-scheme-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const folder = path.join(root, "renderer");
  mkdirSync(folder);
  writeFileSync(path.join(folder, "index.html"), "<!doctype html><title>page</title>");
  writeFileSync(path.join(folder, "road-worker.js"), "onmessage = () => postMessage({});");
  writeFileSync(path.join(folder, "styles.css"), "body {}");
  writeFileSync(path.join(root, "main.cjs"), "secret main");
  return folder;
}

test("1.41 · the page's address is on the app's own scheme, never file://, carrying its query", () => {
  const url = new URL(pageUrl({ project: "a b", problem: "x" }));
  assert.equal(url.protocol, `${PAGE_SCHEME}:`);
  assert.equal(url.pathname, "/index.html");
  assert.equal(url.searchParams.get("project"), "a b");
  assert.equal(url.searchParams.get("problem"), "x");
});

test("1.41 · the app's scheme serves the renderer folder's files with their types", async (t) => {
  const folder = rendererFolder(t);
  const page = pageResponse(pageUrl({}), folder);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type") ?? "", /^text\/html/);
  assert.match(await page.text(), /<title>page<\/title>/);
  const worker = pageResponse(new URL("road-worker.js", pageUrl({})).href, folder);
  assert.match(worker.headers.get("content-type") ?? "", /^text\/javascript/);
  assert.match(pageResponse(new URL("styles.css", pageUrl({})).href, folder).headers.get("content-type") ?? "", /^text\/css/);
});

test("1.41 · the app's scheme serves nothing outside the renderer folder, nor a file it lacks", async (t) => {
  const folder = rendererFolder(t);
  for (const url of [`${PAGE_SCHEME}://page/%2e%2e/main.cjs`, `${PAGE_SCHEME}://page/..%2fmain.cjs`, `${PAGE_SCHEME}://page/missing.js`, `${PAGE_SCHEME}://other/index.html`]) {
    const answer = pageResponse(url, folder);
    assert.equal(answer.status, 404, url);
    assert.doesNotMatch(await answer.text(), /secret main/);
  }
});

test("1.41 · a page check passes only when the page loads and its road worker answers", async () => {
  const answers = (answer: string) => ({ executeJavaScript: async () => answer });
  assert.equal(await checkPage(Promise.resolve(), answers("")), undefined);
  assert.match(await checkPage(Promise.reject(new Error("ERR_FILE_NOT_FOUND (-6) loading 'x'")), answers("")) ?? "", /did not load: ERR_FILE_NOT_FOUND/);
  assert.match(await checkPage(Promise.resolve(), answers("its road worker did not answer within 10 s")) ?? "", /loaded, but its road worker did not answer/);
});

test("1.41 · `--page-check` asks the start check to load the page too, a check flag an installed build takes only under CI", () => {
  assert.equal(parseArgs(["--start-check", "--page-check"]).pageCheck, true);
  assert.equal(parseArgs([]).pageCheck, false);
  assert.equal(parseArgs(["--page-check"], { packaged: true }).pageCheck, false);
  assert.equal(parseArgs(["--page-check"], { packaged: true, env: { CI: "true" } }).pageCheck, true);
});
