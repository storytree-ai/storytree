// Capability 1 · Lifecycle
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

export const PAGE_SCHEME = "storytree-app";
const PAGE_HOST = "page";

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

export function pageUrl(query: Readonly<Record<string, string | undefined>>): string {
  const search = new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined)).toString();
  return `${PAGE_SCHEME}://${PAGE_HOST}/index.html${search === "" ? "" : `?${search}`}`;
}

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

export interface CheckedContents {
  executeJavaScript(code: string): Promise<unknown>;
}

export async function checkPage(loaded: Promise<void>, contents: CheckedContents): Promise<string | undefined> {
  try {
    await loaded;
  } catch (error) {
    return `the page did not load: ${error instanceof Error ? error.message : String(error)}`;
  }
  const answer = await contents.executeJavaScript(PAGE_CHECK_SCRIPT);
  return answer === "" ? undefined : `the page loaded, but ${String(answer)}`;
}
