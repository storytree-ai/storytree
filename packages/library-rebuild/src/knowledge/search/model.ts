// Capability 14 · Ranked search
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { proxyFor, throughProxy, type Environment } from "./proxy.js";

export interface Embedder {
  readonly model: string;
  readonly queryPrefix?: string;
  embed(texts: readonly string[]): Promise<Float32Array[]>;
}

export type EmbedderSource = () => Promise<Embedder>;

export const MODEL = "Snowflake/snowflake-arctic-embed-s";
export const MODEL_REVISION = "e596f507467533e48a2e17c007f0e1dacc837b33";
export const MODEL_FILES: Readonly<Record<string, string>> = {
  "config.json": "4e519aa92ec40943356032afe458c8829d70c5766b109e4a57490b82f72dcfb7",
  "tokenizer.json": "91f1def9b9391fdabe028cd3f3fcc4efd34e5d1f08c3bf2de513ebb5911a1854",
  "tokenizer_config.json": "9ca59277519f6e3692c8685e26b94d4afca2d5438deff66483db495e48735810",
  "onnx/model.onnx": "579c1f1778a0993eb0d2a1403340ffb491c769247fb46acc4f5cf8ac5b89c1e1",
};
export const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

const HOSTS = "huggingface.co and cdn.hf.co with its subdomains (*.cdn.hf.co)";

export function modelsFolder(env: Environment): string {
  return env["STORYTREE_MODELS"] || path.join(env["STORYTREE_HOME"] || path.join(homedir(), ".storytree", "0.3"), "models");
}

export function defaultEmbedder(env: Environment = process.env): EmbedderSource {
  let loading: Promise<Embedder> | undefined;
  return () => {
    loading ??= load(env).catch((error: unknown) => {
      loading = undefined;
      throw error;
    });
    return loading;
  };
}

async function load(env: Environment): Promise<Embedder> {
  if (env["STORYTREE_EMBEDDER"] === "off") throw new Error("the embedding model is switched off (STORYTREE_EMBEDDER=off)");
  const models = modelsFolder(env);
  const folder = path.join(models, ...MODEL.split("/"));
  try {
    await throughProxy(env, () => download(models, folder));
    await verifyModelFolder(folder, MODEL_FILES);
    const transformers = await import("@huggingface/transformers");
    transformers.env.allowRemoteModels = false;
    transformers.env.allowLocalModels = true;
    transformers.env.localModelPath = models;
    const extract = await transformers.pipeline("feature-extraction", MODEL, { dtype: "fp32", local_files_only: true });
    return {
      model: MODEL,
      queryPrefix: QUERY_PREFIX,
      async embed(texts) {
        if (texts.length === 0) return [];
        const output = await extract([...texts], { pooling: "cls", normalize: true });
        return (output.tolist() as number[][]).map((vector) => Float32Array.from(vector));
      },
    };
  } catch (error) {
    const behind = proxyFor(new URL("https://huggingface.co/"), env) === undefined ? "" : ` Behind a proxy: Allowed domains must include ${HOSTS}.`;
    throw new Error(`could not load the embedding model ${MODEL}: ${(error as Error).message}.${behind}`, { cause: error });
  }
}

async function download(models: string, folder: string): Promise<void> {
  for (const file of Object.keys(MODEL_FILES)) {
    const target = path.join(folder, ...file.split("/"));
    if (await stat(target).then(() => true, () => false)) continue;
    const response = await fetch(`https://huggingface.co/${MODEL}/resolve/${MODEL_REVISION}/${file}`);
    if (!response.ok) throw new Error(`${file}: the download answered ${response.status}`);
    await mkdir(models, { recursive: true });
    const partial = await mkdtemp(path.join(models, ".download-"));
    try {
      const staged = path.join(partial, "file");
      await writeFile(staged, Buffer.from(await response.arrayBuffer()));
      await mkdir(path.dirname(target), { recursive: true });
      await rename(staged, target);
    } finally {
      await rm(partial, { recursive: true, force: true });
    }
  }
}

export async function verifyModelFolder(folder: string, expected: Readonly<Record<string, string>>): Promise<void> {
  for (const file of await filesIn(folder)) {
    const target = path.join(folder, ...file.split("/"));
    const wanted = expected[file];
    if (wanted === undefined) {
      await rm(target, { force: true });
      throw new Error(`the model folder held ${file}, which the pinned model does not list; it was deleted`);
    }
    const found = await sha256(target);
    if (found !== wanted) {
      await rm(target, { force: true });
      throw new Error(`${file} has SHA-256 ${found}, not the pinned ${wanted}; it was deleted`);
    }
  }
}

async function filesIn(folder: string, prefix = ""): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(path.join(folder, ...prefix.split("/").filter(Boolean)), { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) found.push(...(await filesIn(folder, `${name}/`)));
    else found.push(name);
  }
  return found.sort();
}

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}
