/**
 * Capability 1 · Lifecycle (contract 1.41). The page is served from the app's own scheme, not file://: the window loads
 * `storytree-app://page/index.html`, and the scheme answers with the files of the app's renderer folder and nothing else,
 * read from inside the app archive by the main process. So the packaged app needs no file:// extra privileges, and its
 * grantFileProtocolExtraPrivileges fuse is off (contract 4.28). A `--page-check` start proves it: it loads the page
 * hidden and has the page start its road worker and hear it answer (checkPage), which each system's install check runs.
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/** The app's own scheme, which serves its page. */
export const PAGE_SCHEME = "storytree-app";
const PAGE_HOST = "page";

/** What each of the page's files is served as, by its extension. */
const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

/** The page's address, with `query` as its search. */
export function pageUrl(query: Readonly<Record<string, string | undefined>>): string {
  const search = new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined)).toString();
  return `${PAGE_SCHEME}://${PAGE_HOST}/index.html${search === "" ? "" : `?${search}`}`;
}

/** The scheme's answer to `url`: the file of the renderer folder `folder` it names, or not found. */
export function pageResponse(url: string, folder: string): Response {
  const file = pageFile(url, folder);
  if (file === undefined) return new Response("not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return new Response(readFileSync(file), { headers: { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" } });
}

function pageFile(url: string, folder: string): string | undefined {
  const { protocol, host, pathname } = new URL(url);
  if (protocol !== `${PAGE_SCHEME}:` || host !== PAGE_HOST) return undefined;
  let name: string;
  try {
    name = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  const root = path.resolve(folder);
  const file = path.resolve(root, `.${name}`);
  if (!file.startsWith(root + path.sep)) return undefined;
  try {
    return statSync(file).isFile() ? file : undefined;
  } catch {
    return undefined;
  }
}

/** The page's side of the check: start the road worker its meta names, post it an empty routing and wait for any answer. "" when it answered, else why not. */
const PAGE_CHECK_SCRIPT = `new Promise((resolve) => {
  const meta = document.querySelector('meta[name="storytree-road-worker"]');
  if (meta === null) return resolve("it names no road worker");
  let worker;
  try { worker = new Worker(meta.content); } catch (error) { return resolve("its road worker could not start: " + error.message); }
  const timer = setTimeout(() => { worker.terminate(); resolve("its road worker did not answer within 10 s"); }, 10000);
  worker.onmessage = () => { clearTimeout(timer); worker.terminate(); resolve(""); };
  worker.onerror = (event) => { clearTimeout(timer); resolve("its road worker failed: " + (event.message || "it could not load")); };
  worker.postMessage({ islands: [], edges: [], seed: 1 });
})`;

/** A window's contents, as the page check uses them. */
export interface CheckedContents {
  executeJavaScript(code: string): Promise<unknown>;
}

/** Wait for the window's page load `loaded`, then hear its road worker answer in `contents`: undefined when both happened, else why not. */
export async function checkPage(loaded: Promise<void>, contents: CheckedContents): Promise<string | undefined> {
  try {
    await loaded;
  } catch (error) {
    return `the page did not load: ${error instanceof Error ? error.message : String(error)}`;
  }
  const answer = await contents.executeJavaScript(PAGE_CHECK_SCRIPT);
  return answer === "" ? undefined : `the page loaded, but ${String(answer)}`;
}
