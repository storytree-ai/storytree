/** Capability 4 · Publish on merge. */
import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

export type PublishWebsiteOptions = {
  directory: string;
  token?: string | undefined;
  fetch?: typeof globalThis.fetch;
  log?: (message: string) => void;
  /** Pause between checks of the live site; tests pass one that returns at once. */
  wait?: (ms: number) => Promise<void>;
};

const slug = "crisp-globe-bf6v";
const api = `https://here.now/api/v1/publish/${slug}`;
const site = "https://storytree.dev/";
// here.now can accept a finalize before its status reads live (arc_c94ba9a1253d): the live site then decides.
const liveChecks = 12;
const liveCheckInterval = 5_000;
const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
};

type StaticFile = { bytes: Uint8Array<ArrayBuffer>; contentType: string; hash: string };
type Upload = { path: string; url: string; headers: Headers };

async function readBuild(directory: string): Promise<Map<string, StaticFile>> {
  const files = new Map<string, StaticFile>();
  async function visit(absolute: string, relative: string): Promise<void> {
    const entry = await lstat(absolute);
    if (entry.isSymbolicLink()) throw new Error("Symbolic links are not static build files");
    if (entry.isDirectory()) {
      for (const name of (await readdir(absolute)).sort()) {
        await visit(path.join(absolute, name), relative ? `${relative}/${name}` : name);
      }
    } else if (entry.isFile() && relative) {
      const bytes = new Uint8Array(await readFile(absolute));
      files.set(relative, {
        bytes,
        contentType: contentTypes[path.extname(relative).toLowerCase()] ?? "application/octet-stream",
        hash: createHash("sha256").update(bytes).digest("hex"),
      });
    } else {
      throw new Error("Unsupported build entry");
    }
  }
  try {
    await visit(directory, "");
    if (!files.has("index.html") || !files.has("404.html")) throw new Error("Missing page");
  } catch {
    throw new Error("Website publish build failed: expected readable static files including index.html and 404.html, without symbolic links.");
  }
  return files;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uploadPlan(value: unknown, files: Map<string, StaticFile>): { versionId: string; uploads: Upload[] } {
  const invalid = new Error("Website publish manifest failed: invalid upload plan.");
  if (!record(value) || !record(value.upload)) throw invalid;
  const { versionId, uploads, skipped = [] } = value.upload;
  if (typeof versionId !== "string" || !versionId.trim() || !Array.isArray(uploads) || !Array.isArray(skipped)) throw invalid;
  const covered = new Set<string>();
  const plan: Upload[] = [];
  for (const upload of uploads) {
    if (!record(upload) || typeof upload.path !== "string" || !files.has(upload.path) || covered.has(upload.path)
      || upload.method !== "PUT" || typeof upload.url !== "string" || !record(upload.headers)) throw invalid;
    try {
      const url = new URL(upload.url);
      if (url.protocol !== "https:" || url.username || url.password) throw invalid;
      const headers = new Headers();
      for (const [name, value] of Object.entries(upload.headers)) {
        if (typeof value !== "string") throw invalid;
        headers.set(name, value);
      }
      plan.push({ path: upload.path, url: upload.url, headers });
    } catch {
      throw invalid;
    }
    covered.add(upload.path);
  }
  for (const name of skipped) {
    if (typeof name !== "string" || !files.has(name) || covered.has(name)) throw invalid;
    covered.add(name);
  }
  if (covered.size !== files.size) throw invalid;
  return { versionId, uploads: plan };
}

/** Whether the live site serves this build's /version.txt (a merge sha) within a bounded time. */
async function servesBuild(fetch: typeof globalThis.fetch, built: StaticFile | undefined, wait = (ms: number) => new Promise<void>(done => setTimeout(done, ms))): Promise<boolean> {
  const version = built && new TextDecoder().decode(built.bytes).trim();
  // A local build's version.txt names no merge, so the live site can never confirm it.
  if (!version || !/^[a-f0-9]{40}$/.test(version)) return false;
  for (let check = 1; check <= liveChecks; check++) {
    if (check > 1) await wait(liveCheckInterval);
    try {
      // No key: the live site is public. The query keeps a cache from answering for it.
      const response = await fetch(`${site}version.txt?check=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(10_000), redirect: "error" });
      if (response.ok && (await response.text()).trim() === version) return true;
    } catch {
      // A failed check is retried; its error text is never kept.
    }
  }
  return false;
}

/** Update only the existing website. No key (CI has no Google identity to fetch it) is an explicit, offline skip. */
export async function publishWebsite(options: PublishWebsiteOptions): Promise<void> {
  const log = options.log ?? console.log;
  const token = options.token?.trim();
  if (!token) {
    log("Website publishing skipped: no here.now key. CI fetches it from Secret Manager once the repository variables WEBSITE_WIF_PROVIDER and WEBSITE_SERVICE_ACCOUNT are set (infra/website-publish/README.md).");
    return;
  }
  const files = await readBuild(options.directory);
  const fetch = options.fetch ?? globalThis.fetch;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json", "X-HereNow-Client": "codex/storytree-ci" };
  async function request(stage: string, url: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000), redirect: "error" });
    } catch {
      // Fetch errors can contain credentials or signed storage URLs; never retain their text.
      throw new Error(`Website publish ${stage} failed: network error or timeout.`);
    }
    if (!response.ok) throw new Error(`Website publish ${stage} failed (HTTP ${response.status}).`);
    return response;
  }
  async function json(stage: string, response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new Error(`Website publish ${stage} failed: invalid JSON response.`);
    }
  }
  const manifest = [...files].map(([name, file]) => ({ path: name, size: file.bytes.length, contentType: file.contentType, hash: file.hash }));
  const staged = await request("manifest", api, { method: "PUT", headers, body: JSON.stringify({ files: manifest }) });
  const plan = uploadPlan(await json("manifest", staged), files);
  for (const upload of plan.uploads) {
    await request("upload", upload.url, { method: "PUT", headers: upload.headers, body: files.get(upload.path)!.bytes });
  }
  // Authenticated finalization always uses our fixed API endpoint, never a supplied URL.
  const finalized = await request("finalize", `${api}/finalize`, { method: "POST", headers, body: JSON.stringify({ versionId: plan.versionId }) });
  const result = await json("finalize", finalized);
  if (!record(result)) throw new Error("Website publish finalize failed: the response was not an object.");
  // Name the unmet condition from non-secret fields only, never the response body.
  const state = record(result.publishStatus) && typeof result.publishStatus.state === "string"
    && /^[a-z_-]{1,32}$/i.test(result.publishStatus.state) ? result.publishStatus.state : "unreadable";
  const accepted = [
    result.success !== true && "success is not true",
    result.slug !== slug && "slug is not this site's",
  ].filter(Boolean);
  const pending = [
    state !== "live" && `publishStatus.state ${state}`,
    result.currentVersionId !== plan.versionId && "currentVersionId is not the requested version",
  ].filter(Boolean);
  if (accepted.length) throw new Error(`Website publish finalize failed: ${[...accepted, ...pending].join("; ")}.`);
  if (pending.length && !(await servesBuild(fetch, files.get("version.txt"), options.wait))) {
    throw new Error(`Website publish finalize failed: ${pending.join("; ")}, and ${site}version.txt did not name this build within ${liveChecks * liveCheckInterval / 1000}s.`);
  }
  if (result.warnings !== undefined && (!Array.isArray(result.warnings) || result.warnings.length > 0)) {
    // Finalize may already have made the page live. Never report it published.
    // Keep server warning bodies out of logs: they may contain private paths or values.
    throw new Error("Website publish finalize failed: manifest warnings; the page may be live with part of it declined. Inspect the here.now manifest before retrying.");
  }
  log(`Website finalized without manifest warnings: ${plan.versionId}`);
  log(`Website published: ${site}`);
}
