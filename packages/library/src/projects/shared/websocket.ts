// Capability 15 · Connection by address
import { isIPv4 } from "node:net";
import { Duplex } from "node:stream";

import { HttpsProxyAgent } from "https-proxy-agent";
import WebSocket from "ws";

export type Environment = Readonly<Record<string, string | undefined>>;

export interface TunnelTarget {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly ca?: string;
  readonly proxy?: string;
}

export function bare(host: string): string {
  return host.toLowerCase().replace(/^\[(.*)\]$/, "$1").replace(/\.$/, "");
}

export function loopback(host: string): boolean {
  return host === "localhost" || host.endsWith(".localhost") || host === "::1" || (isIPv4(host) && host.startsWith("127."));
}

function named(entry: string, host: string, port: string): boolean {
  if (entry === "*") return true;
  const parts = /^\[(.+)\](?::(\d+))?$/.exec(entry) ?? (entry.split(":").length === 2 ? /^(.+):(\d+)$/.exec(entry) : null);
  const name = (parts?.[1] ?? entry).replace(/^\*?\./, "");
  if (parts?.[2] !== undefined && parts[2] !== port) return false;
  return host === name || host.endsWith(`.${name}`);
}

export function proxyFor(url: URL, env: Environment): string | undefined {
  const proxy = env["HTTPS_PROXY"] || env["https_proxy"];
  const host = bare(url.hostname);
  if (!proxy || loopback(host)) return undefined;
  const port = url.port || "443";
  const skipped = (env["NO_PROXY"] || env["no_proxy"] || "").split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  return skipped.some((entry) => named(entry, host, port)) ? undefined : proxy;
}

export class Tunnel extends Duplex {
  bytesRead = 0;
  readonly #target: TunnelTarget;
  #socket: WebSocket | undefined;

  constructor(target: TunnelTarget) {
    super({ allowHalfOpen: false });
    this.#target = target;
  }

  setNoDelay(): this {
    return this;
  }

  setKeepAlive(): this {
    return this;
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }

  connect(): this {
    const { url, headers, ca, proxy } = this.#target;
    const agent = proxy === undefined ? undefined : new HttpsProxyAgent(proxy);
    let refused: number | undefined;
    agent?.on("proxyConnect", ({ statusCode }: { statusCode: number }) => {
      if (statusCode !== 200) refused = statusCode;
    });
    const socket = new WebSocket(url, { headers: { ...headers }, ...(ca === undefined ? {} : { ca }), ...(agent === undefined ? {} : { agent }) });
    this.#socket = socket;
    const hop = (error: Error, status?: number) => Object.assign(error, refused === undefined ? status === undefined ? {} : { hop: "gate", status } : { hop: "proxy", status: refused });
    socket.on("open", () => this.emit("connect"));
    socket.on("message", (data: Buffer) => {
      this.bytesRead += data.length;
      this.push(data);
    });
    socket.on("unexpected-response", (request, response) => {
      request.destroy();
      this.destroy(hop(new Error(`the upgrade to ${url} was answered ${response.statusCode}`), response.statusCode));
    });
    socket.on("error", (error) => this.destroy(hop(error)));
    socket.on("close", () => this.push(null));
    return this;
  }

  override _read(): void {}

  override _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void): void {
    this.#socket?.send(chunk, done);
  }

  override _final(done: (error?: Error | null) => void): void {
    this.#socket?.close();
    done();
  }

  override _destroy(error: Error | null, done: (error?: Error | null) => void): void {
    this.#socket?.terminate();
    done(error);
  }
}
