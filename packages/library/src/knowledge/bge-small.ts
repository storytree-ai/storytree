/**
 * Capability 14 · Ranked search: the real embedder, BAAI/bge-small-en-v1.5 run in this process by
 * transformers.js on ONNX Runtime (ADR-0733 D1-D2). Nothing is loaded until the first search needs it; the
 * model is downloaded once into the storytree home's `models` folder and read from there after.
 *
 * STORYTREE_EMBEDDER=off switches it off (the test runner does, so no test or CI run downloads the
 * model), and a search then ranks by words and says why.
 *
 * Node's fetch ignores HTTPS_PROXY, so behind a proxy (a cloud container's agent proxy is its only way
 * out) the download goes through the one the environment names, and a load that fails there names the
 * hosts that proxy must allow (14.13, friction_84c6d7d08f35).
 */
import http from "node:http";
import { homedir } from "node:os";
import path from "node:path";

import type { Embedder, EmbedderSource } from "./embedding.js";

/** The ONNX export of BAAI/bge-small-en-v1.5 that transformers.js reads. */
export const BGE_SMALL = "Xenova/bge-small-en-v1.5";

/** The hosts the model downloads from: the Hub, and the file store its downloads are sent on to. */
export const MODEL_HOSTS = ["huggingface.co", "*.cdn.hf.co"] as const;

/** Where models are kept: STORYTREE_MODELS, else `<storytree home>/models`. */
export function modelsFolder(env: NodeJS.ProcessEnv = process.env): string {
  return env.STORYTREE_MODELS ?? path.join(env.STORYTREE_HOME ?? path.join(homedir(), ".storytree/0.3"), "models");
}

/**
 * The embedder a library uses unless it is handed another: bge-small, loaded once per process on
 * first use. A load that fails is tried again at the next search, never remembered as a failure.
 */
export function defaultEmbedder(env: NodeJS.ProcessEnv = process.env): EmbedderSource {
  let loading: Promise<Embedder> | undefined;
  return () => {
    if (env.STORYTREE_EMBEDDER === "off") return Promise.reject(new Error("the embedding model is switched off (STORYTREE_EMBEDDER=off)"));
    loading ??= throughProxy(env, () => loadBgeSmall(modelsFolder(env))).catch((error: unknown) => {
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

async function loadBgeSmall(cacheDir: string): Promise<Embedder> {
  const { env, pipeline } = await import("@huggingface/transformers");
  env.cacheDir = cacheDir;
  const extract = await pipeline("feature-extraction", BGE_SMALL, { dtype: "fp32" });
  return {
    model: BGE_SMALL,
    async embed(texts) {
      if (texts.length === 0) return [];
      // bge is read at its [CLS] token, as sentence-transformers reads it.
      const out = await extract([...texts], { pooling: "cls", normalize: true });
      const [rows, width] = out.dims as [number, number];
      const data = out.data as Float32Array;
      return Array.from({ length: rows }, (_, row) => data.slice(row * width, (row + 1) * width));
    },
  };
}
