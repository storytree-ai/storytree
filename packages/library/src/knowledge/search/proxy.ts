// Capability 14 · Ranked search
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";

import { HttpsProxyAgent } from "https-proxy-agent";

export type Environment = Readonly<Record<string, string | undefined>>;

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export function proxyFor(url: URL, env: Environment): string | undefined {
  const named = url.protocol === "https:"
    ? env["HTTPS_PROXY"] || env["https_proxy"] || env["HTTP_PROXY"] || env["http_proxy"]
    : env["HTTP_PROXY"] || env["http_proxy"];
  if (!named) return undefined;
  const skipped = (env["NO_PROXY"] || env["no_proxy"] || "").split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  const host = url.hostname.toLowerCase();
  const bypass = skipped.some((entry) => {
    const name = entry.replace(/:\d+$/, "").replace(/^\*?\./, "");
    return entry === "*" || host === name || host.endsWith(`.${name}`);
  });
  return bypass ? undefined : named;
}

export async function throughProxy<T>(env: Environment, work: () => Promise<T>): Promise<T> {
  const direct = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    return proxyFor(url, env) === undefined ? await direct(input, init) : await viaProxy(url, init, env, 20);
  }) as typeof fetch;
  try {
    return await work();
  } finally {
    globalThis.fetch = direct;
  }
}

async function viaProxy(url: URL, init: RequestInit | undefined, env: Environment, redirects: number): Promise<Response> {
  const proxy = proxyFor(url, env);
  const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).request(url, {
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      ...(proxy === undefined ? {} : { agent: new HttpsProxyAgent(proxy) }),
      ...(init?.signal ? { signal: init.signal } : {}),
    }, resolve);
    request.on("error", (cause) => reject(new TypeError("fetch failed", { cause })));
    request.on("proxyConnect", ({ statusCode }: { statusCode: number }) => {
      if (statusCode !== 200) request.destroy(new Error(`the proxy refused to reach ${url.host}: it answered ${statusCode}`));
    });
    request.end();
  });
  const status = response.statusCode ?? 0;
  const location = response.headers.location;
  if (REDIRECTS.has(status) && location !== undefined && redirects > 0) {
    response.resume();
    return await viaProxy(new URL(location, url), init, env, redirects - 1);
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(response.headers)) {
    for (const each of Array.isArray(value) ? value : value === undefined ? [] : [value]) headers.append(name, each);
  }
  const empty = status === 204 || status === 304 || init?.method === "HEAD";
  if (empty) response.resume();
  return new Response(empty ? null : (Readable.toWeb(response) as ReadableStream), { status, statusText: response.statusMessage ?? "", headers });
}
