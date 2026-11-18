// Capability 14 · Ranked search
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline as pipe } from "node:stream/promises";

import type { Embedder, EmbedderSource } from "./embedding.js";

export const MODEL = "Snowflake/snowflake-arctic-embed-s";

export const MODEL_REVISION = "e596f507467533e48a2e17c007f0e1dacc837b33";

export const MODEL_FILES: Readonly<Record<string, string>> = {
  "config.json": "4e519aa92ec40943356032afe458c8829d70c5766b109e4a57490b82f72dcfb7",
  "tokenizer.json": "91f1def9b9391fdabe028cd3f3fcc4efd34e5d1f08c3bf2de513ebb5911a1854",
  "tokenizer_config.json": "9ca59277519f6e3692c8685e26b94d4afca2d5438deff66483db495e48735810",
  "onnx/model.onnx": "579c1f1778a0993eb0d2a1403340ffb491c769247fb46acc4f5cf8ac5b89c1e1",
};

export const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

const VERIFIED = ".verified.json";

export const MODEL_HOSTS = ["huggingface.co", "*.cdn.hf.co"] as const;

export function modelsFolder(env: NodeJS.ProcessEnv = process.env): string {
  return env.STORYTREE_MODELS ?? path.join(env.STORYTREE_HOME ?? path.join(homedir(), ".storytree/0.3"), "models");
}

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

export async function throughProxy<T>(env: NodeJS.ProcessEnv, work: () => Promise<T>): Promise<T> {
  const { setGlobalProxyFromEnv } = http as typeof http & { setGlobalProxyFromEnv?: (proxyEnv: NodeJS.ProcessEnv) => () => void };
  if (proxyIn(env) === undefined || setGlobalProxyFromEnv === undefined) return work();
  const restore = setGlobalProxyFromEnv(env);
  try {
    return await work();
  } finally {
    restore();
  }
}

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
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.useFSCache = false;
  const extract = await pipeline("feature-extraction", folder, { dtype: "fp32" });
  return {
    model: MODEL,
    queryPrefix: QUERY_PREFIX,
    async embed(texts) {
      if (texts.length === 0) return [];
      const out = await extract([...texts], { pooling: "cls", normalize: true });
      const [rows, width] = out.dims as [number, number];
      const data = out.data as Float32Array;
      return Array.from({ length: rows }, (_, row) => data.slice(row * width, (row + 1) * width));
    },
  };
}
