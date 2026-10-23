/**
 * Capability 14 · Ranked search: the real embedder, Snowflake/snowflake-arctic-embed-s run in this
 * process by transformers.js on ONNX Runtime (ADR-0733 D1-D2; the owner chose Snowflake's model over
 * BAAI's bge-small-en-v1.5 in question_80102d5cea6e). Nothing is loaded until the first search needs
 * it; the model is downloaded once into the storytree home's `models` folder and read from there after.
 *
 * STORYTREE_EMBEDDER=off switches it off (the test runner does, so no test or CI run downloads the
 * model), and a search then ranks by words and says why.
 *
 * The files come from one pinned revision of the model, and each is checked against the SHA-256
 * committed here before transformers.js reads it: after a download, and once per cached copy (a
 * marker beside the files remembers what was checked). A file that differs is deleted and the load
 * refused with its name and both hashes, so a search ranks by words and says why (14.14).
 *
 * Node's fetch ignores HTTPS_PROXY, so behind a proxy (a cloud container's agent proxy is its only way
 * out) the download goes through the one the environment names, and a load that fails there names the
 * hosts that proxy must allow (14.13, friction_84c6d7d08f35).
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline as pipe } from "node:stream/promises";

import type { Embedder, EmbedderSource } from "./embedding.js";

/** Snowflake's own repository of arctic-embed-s, ONNX export included, which transformers.js reads. */
export const MODEL = "Snowflake/snowflake-arctic-embed-s";

/** The commit of MODEL its files come from (last changed 2024-12-04), never the moving `main`. */
export const MODEL_REVISION = "e596f507467533e48a2e17c007f0e1dacc837b33";

/**
 * Every file transformers.js reads for MODEL at MODEL_REVISION, with its SHA-256 (model.onnx's is the
 * Hub's LFS oid; the JSON files were hashed from a fresh download, 2026-10-22).
 */
export const MODEL_FILES: Readonly<Record<string, string>> = {
  "config.json": "4e519aa92ec40943356032afe458c8829d70c5766b109e4a57490b82f72dcfb7",
  "tokenizer.json": "91f1def9b9391fdabe028cd3f3fcc4efd34e5d1f08c3bf2de513ebb5911a1854",
  "tokenizer_config.json": "9ca59277519f6e3692c8685e26b94d4afca2d5438deff66483db495e48735810",
  "onnx/model.onnx": "579c1f1778a0993eb0d2a1403340ffb491c769247fb46acc4f5cf8ac5b89c1e1",
};

/** What arctic-embed-s was trained to read before a search question (and never before a passage). */
export const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

/** The file beside a model's files that remembers which copies were checked. */
const VERIFIED = ".verified.json";

/** The hosts the model downloads from: the Hub, and the file store its downloads are sent on to. */
export const MODEL_HOSTS = ["huggingface.co", "*.cdn.hf.co"] as const;

/** Where models are kept: STORYTREE_MODELS, else `<storytree home>/models`. */
export function modelsFolder(env: NodeJS.ProcessEnv = process.env): string {
  return env.STORYTREE_MODELS ?? path.join(env.STORYTREE_HOME ?? path.join(homedir(), ".storytree/0.3"), "models");
}

/**
 * The embedder a library uses unless it is handed another: arctic-embed-s, loaded once per process on
 * first use. A load that fails is tried again at the next search, never remembered as a failure.
 */
export function defaultEmbedder(env: NodeJS.ProcessEnv = process.env): EmbedderSource {
  let loading: Promise<Embedder> | undefined;
  return () => {
    if (env.STORYTREE_EMBEDDER === "off") return Promise.reject(new Error("the embedding model is switched off (STORYTREE_EMBEDDER=off)"));
    loading ??= throughProxy(env, () => loadModel(modelsFolder(env))).catch((error: unknown) => {
      loading = undefined;
      const behind = proxyIn(env) === undefined ? "" : `; behind this environment's proxy it downloads from ${MODEL_HOSTS.join(" and ")}, so add those to what the proxy allows (a cloud environment's Allowed domains)`;
      throw new Error(`the embedding model could not load: ${error instanceof Error ? error.message : String(error)}${behind}`);
    });
    return loading;
  };
}

function proxyIn(env: NodeJS.ProcessEnv): string | undefined {
  return env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || undefined;
}

/**
 * Runs `work` with this process's fetch going through the proxy `env` names (NO_PROXY honoured), and
 * puts fetch back as it was when the work ends; with no proxy named, it only runs the work.
 */
export async function throughProxy<T>(env: NodeJS.ProcessEnv, work: () => Promise<T>): Promise<T> {
  // Node 24's own proxy switch, which @types/node does not declare yet; a runtime without it fetches directly.
  const { setGlobalProxyFromEnv } = http as typeof http & { setGlobalProxyFromEnv?: (proxyEnv: NodeJS.ProcessEnv) => () => void };
  if (proxyIn(env) === undefined || setGlobalProxyFromEnv === undefined) return work();
  const restore = setGlobalProxyFromEnv(env);
  try {
    return await work();
  } finally {
    restore();
  }
}

/**
 * Checks that `folder` holds exactly the files `expected` names (paths with `/`), each with its SHA-256.
 * A copy checked before, unchanged in size and time since, is not hashed again. A file that differs, or
 * one `expected` does not name, is deleted and the check throws naming it (and both hashes); a missing
 * one throws too.
 */
export async function verifyModelFolder(folder: string, expected: Readonly<Record<string, string>>): Promise<void> {
  const marker = path.join(folder, VERIFIED);
  type Seen = { sha256: string; size: number; mtimeMs: number };
  const seen = await readFile(marker, "utf8").then((text) => JSON.parse(text) as Record<string, Seen>, () => ({}) as Record<string, Seen>);
  const unlisted = (await readdir(folder, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(folder, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .filter((file) => file !== VERIFIED && !(file in expected));
  if (unlisted.length > 0) {
    await Promise.all(unlisted.map((file) => rm(path.join(folder, file), { force: true })));
    throw new Error(`the model folder ${folder} held ${unlisted.join(", ")}, which the pinned model does not have; deleted`);
  }
  const verified: Record<string, Seen> = {};
  for (const [file, sha256] of Object.entries(expected)) {
    const at = path.join(folder, file);
    const { size, mtimeMs } = await stat(at).catch(() => {
      throw new Error(`the model file ${file} is missing from ${folder}`);
    });
    const before = seen[file];
    if (before?.sha256 !== sha256 || before.size !== size || before.mtimeMs !== mtimeMs) {
      const hash = createHash("sha256");
      await pipe(createReadStream(at), hash);
      const actual = hash.digest("hex");
      if (actual !== sha256) {
        await rm(at, { force: true });
        throw new Error(`the model file ${file} has SHA-256 ${actual}, not the expected ${sha256}; deleted`);
      }
    }
    verified[file] = { sha256, size, mtimeMs };
  }
  await writeFile(marker, JSON.stringify(verified, null, 2));
}

/** Downloads each of MODEL_FILES that `folder` lacks, from MODEL_REVISION. */
async function downloadMissing(folder: string): Promise<void> {
  for (const file of Object.keys(MODEL_FILES)) {
    const at = path.join(folder, file);
    if (await stat(at).then(() => true, () => false)) continue;
    const url = `https://huggingface.co/${MODEL}/resolve/${MODEL_REVISION}/${file}`;
    const response = await fetch(url);
    if (!response.ok || response.body === null) throw new Error(`${url} answered ${response.status}`);
    await mkdir(path.dirname(at), { recursive: true });
    await pipe(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), createWriteStream(`${at}.part`));
    await rename(`${at}.part`, at);
  }
}

async function loadModel(cacheDir: string): Promise<Embedder> {
  const folder = path.join(cacheDir, MODEL, MODEL_REVISION);
  await downloadMissing(folder);
  await verifyModelFolder(folder, MODEL_FILES);
  const { env, pipeline } = await import("@huggingface/transformers");
  // transformers.js reads the checked folder as a local model: it fetches nothing and caches nothing itself.
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.useFSCache = false;
  const extract = await pipeline("feature-extraction", folder, { dtype: "fp32" });
  return {
    model: MODEL,
    queryPrefix: QUERY_PREFIX,
    async embed(texts) {
      if (texts.length === 0) return [];
      // arctic-embed is read at its [CLS] token, as sentence-transformers reads it.
      const out = await extract([...texts], { pooling: "cls", normalize: true });
      const [rows, width] = out.dims as [number, number];
      const data = out.data as Float32Array;
      return Array.from({ length: rows }, (_, row) => data.slice(row * width, (row + 1) * width));
    },
  };
}
