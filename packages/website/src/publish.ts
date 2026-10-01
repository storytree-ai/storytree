import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

export type PublishWebsiteOptions = {
  directory: string;
  token?: string | undefined;
  fetch?: typeof globalThis.fetch;
  log?: (message: string) => void;
};

const slug = "crisp-globe-bf6v";
const api = `https://here.now/api/v1/publish/${slug}`;
const site = `https://${slug}.here.now/`;
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
  if (!record(result) || result.success !== true || result.slug !== slug || result.currentVersionId !== plan.versionId
    || !record(result.publishStatus) || result.publishStatus.state !== "live") {
    throw new Error("Website publish finalize failed: the requested version was not confirmed live.");
  }
  log(`Website published: ${site}`);
}
