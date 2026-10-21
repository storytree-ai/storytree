/**
 * Capability 14 · Ranked search: the embedding model's first-use download behind a proxy, as a cloud
 * container's agent proxy is the only way out of it (friction_84c6d7d08f35).
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { defaultEmbedder, throughProxy } from "./bge-small.js";

/** A proxy that refuses every tunnel it is asked for, as an agent proxy refuses a host it does not allow. */
async function refusingProxy(): Promise<{ url: string; asked: string[]; close(): Promise<void> }> {
  const asked: string[] = [];
  const server = http.createServer((_request, response) => response.writeHead(405).end());
  server.on("connect", (request: http.IncomingMessage, socket: import("node:stream").Duplex) => {
    asked.push(`CONNECT ${request.url ?? ""}`);
    socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, asked, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

test("14.13 · behind HTTPS_PROXY the model's download goes through the proxy, and a refused load names the hosts the proxy must allow", async (t) => {
  const proxy = await refusingProxy();
  const models = await mkdtemp(path.join(tmpdir(), "storytree-models-"));
  t.after(async () => {
    await proxy.close();
    await rm(models, { recursive: true, force: true });
  });
  const env = { HTTPS_PROXY: proxy.url, STORYTREE_MODELS: models };

  await assert.rejects(defaultEmbedder(env)(), (error: Error) => {
    assert.match(error.message, /could not load/);
    assert.match(error.message, /huggingface\.co/);
    assert.match(error.message, /cdn\.hf\.co/);
    assert.match(error.message, /Allowed domains/);
    assert.doesNotMatch(error.message, new RegExp(proxy.url.replace(/[.:/]/g, "\\$&")), "the proxy's address, which may carry a password, is not repeated");
    return true;
  });
  assert.ok(proxy.asked.some((line) => line.startsWith("CONNECT huggingface.co:443")), `the download asked the proxy: ${proxy.asked.join(", ")}`);
});

test("14.13 · a fetch inside throughProxy goes by the proxy, NO_PROXY is honoured, and no fetch after it does", async (t) => {
  const proxy = await refusingProxy();
  t.after(() => proxy.close());

  const env = { HTTP_PROXY: proxy.url, NO_PROXY: "skipped.invalid" };
  await throughProxy(env, () => assert.rejects(fetch("http://models.invalid/config.json")));
  await throughProxy(env, () => assert.rejects(fetch("http://skipped.invalid/config.json")));
  await assert.rejects(fetch("http://models.invalid/config.json"));
  assert.deepEqual(proxy.asked, ["CONNECT models.invalid:80"]);
});
