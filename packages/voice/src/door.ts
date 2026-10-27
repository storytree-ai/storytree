/**
 * Capability 1 · The address and its guards (contracts 1.1-1.6, 1.10, 1.14): one secret route on 127.0.0.1, a bare 404
 * everywhere else (never 401, or claude.ai starts an OAuth flow), the caller's range, the Host list, body and batch
 * limits, and a keep-alive longer than the tunnel's. Stateless Streamable HTTP through the MCP SDK. With a sign-in service
 * configured (contracts 1.15-1.19), the secret's well-known path publishes its metadata and a signed tool's call needs the
 * owner's token, which is where a 401 is answered and nowhere else; with VOICE_SIGNIN_EVERY_CALL=1 (contract 1.20) every call needs it.
 */
import http from "node:http";
import crypto from "node:crypto";
import net from "node:net";
import { AsyncLocalStorage } from "node:async_hooks";
import { createMcpHandler, hostHeaderValidationResponse } from "@modelcontextprotocol/server";
import { Children, LIMITS, type Limits } from "./children.js";
import type { VoiceConfig } from "./config.js";
import { makeServer, openQuestion, unheardFyiIds } from "./tools.js";
import { Drafts } from "./drafts.js";
import { WRITE_TOOL_NAMES, registerWriteTools, repliesSaid } from "./writes.js";
import { SIGNED_TOOL_NAMES, SignInRefusal, registerSignedTools, signIn, type SignedCaller } from "./signin.js";

export interface DoorOptions {
  /** The door's limits; tests shorten the times. */
  readonly limits?: Limits;
  /** Where log lines go: one line per request, never the secret, the path or a tool's arguments. */
  readonly log?: (line: string) => void;
}

export interface Door {
  readonly port: number;
  close(): Promise<void>;
}

const digest = (text: string) => crypto.createHash("sha256").update(text).digest();

/**
 * Last X-Forwarded-For hop, if it is an IP address: Tailscale Funnel appends the public caller's address, so only the
 * last entry is the proxy's; anything before it is whatever the caller sent.
 */
function forwardedFor(req: http.IncomingMessage): string | undefined {
  const header = req.headers["x-forwarded-for"];
  if (header === undefined) return undefined;
  const last = String(Array.isArray(header) ? header.at(-1) : header).split(",").at(-1)!.trim();
  return net.isIP(last) ? last : "invalid";
}

/** The JSON-RPC method (and a called tool's name) in a body, for the log only; never the arguments. */
function rpcSummary(body: Buffer): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    return "rpc=unparsed";
  }
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  const safe = (value: unknown) => String(value).replace(/[^\w/.:-]/g, "?").slice(0, 60);
  const names = messages.slice(0, 10).map((message: unknown) => {
    if (message === null || typeof message !== "object") return "?";
    const { method, params } = message as { method?: unknown; params?: { name?: unknown } };
    if (typeof method !== "string") return "response";
    if (method === "tools/call") return `tools/call(${safe(params?.name ?? "?")})`;
    return safe(method);
  });
  return `rpc=${names.join(",")}`;
}

/** The tool a single tools/call message names, if the body is one. */
function calledTool(body: Buffer): string | undefined {
  try {
    const message = JSON.parse(body.toString("utf8")) as { method?: unknown; params?: { name?: unknown } } | null;
    return message?.method === "tools/call" && typeof message.params?.name === "string" ? message.params.name : undefined;
  } catch {
    return undefined;
  }
}

function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        req.off("data", onData);
        req.pause();
        reject(Object.assign(new Error("body too large"), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    };
    req.on("data", onData);
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
    req.on("close", () => reject(new Error("the caller hung up"))); // after "end" this is a no-op
  });
}

/** True when the body is a JSON-RPC batch: its first non-blank byte is '['. */
function isBatch(body: Buffer): boolean {
  const first = body.find((byte) => byte !== 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d);
  return first === 0x5b;
}

const HOP_BY_HOP = ["connection", "keep-alive", "transfer-encoding", "upgrade"];

/** A web Request for the SDK. Its URL is fixed, so the secret never reaches the SDK (or anything it might echo). */
function webRequest(req: http.IncomingMessage, body: Buffer, signal: AbortSignal): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined || name === "content-length" || HOP_BY_HOP.includes(name)) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  return new Request("http://127.0.0.1/mcp", { method: req.method ?? "POST", headers, body: new Uint8Array(body), signal });
}

async function sendWeb(res: http.ServerResponse, response: Response): Promise<void> {
  if (res.destroyed) {
    await response.body?.cancel().catch(() => {});
    return;
  }
  // Hop-by-hop headers are Node's to manage, so it advertises its own keep-alive timeout.
  const headers = Object.fromEntries([...response.headers].filter(([name]) => !HOP_BY_HOP.includes(name)));
  res.writeHead(response.status, headers);
  if (response.body === null) {
    res.end();
    return;
  }
  // An SSE answer (2025-era clients) goes out at once, so the SDK's keepalive comments cover a long tool call.
  if (/^text\/event-stream\b/i.test(response.headers.get("content-type") ?? "")) res.flushHeaders();
  try {
    for await (const chunk of response.body) {
      if (res.destroyed) break; // leaving the loop cancels the stream, which ends the SDK's exchange
      res.write(chunk);
    }
  } catch (error) {
    if (!res.destroyed) throw error;
  }
  res.end();
}

function bare(res: http.ServerResponse, status: number, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-length": "0", "cache-control": "no-store", ...headers });
  res.end();
}

function jsonRpcError(res: http.ServerResponse, status: number, code: number, message: string): void {
  const text = JSON.stringify({ jsonrpc: "2.0", id: null, error: { code, message } });
  res.writeHead(status, { "content-type": "application/json", "content-length": String(Buffer.byteLength(text)), "cache-control": "no-store" });
  res.end(text);
}

/**
 * Answer `status` and close the connection, but only once the rest of the body has been read and discarded (for at
 * most 5 seconds): closing a socket with unread data in it sends a reset, and the client would see that instead.
 */
function closeAfter(req: http.IncomingMessage, res: http.ServerResponse, status: number): void {
  let answered = false;
  const answer = () => {
    if (answered) return;
    answered = true;
    if (!res.headersSent && !res.destroyed) bare(res, status, { connection: "close" });
  };
  req.removeAllListeners("data");
  if (req.readableEnded) return answer();
  req.on("end", answer);
  req.on("error", answer);
  setTimeout(answer, 5_000).unref();
  req.resume();
}

function stamp(line: string): void {
  process.stdout.write(`${new Date().toISOString()} ${line}\n`);
}

/** Start the door on 127.0.0.1 at config.port (0 picks a free port); resolves once it listens. */
export function startDoor(config: VoiceConfig, options: DoorOptions = {}): Promise<Door> {
  const limits = options.limits ?? LIMITS;
  const log = options.log ?? stamp;
  const children = new Children(config, limits, log);
  const gate = config.signIn ? signIn(config.signIn) : null;
  // Writes are drafts in the door's own database, and only with sign-in (config.ts refuses writes without it).
  const drafts = gate && config.drafts ? Drafts.open(config.drafts) : null;
  const signedTools: readonly string[] = [...SIGNED_TOOL_NAMES, ...(drafts ? WRITE_TOOL_NAMES : [])];
  // The current request's hang-up signal and signed caller, carried through the SDK's async calls into the per-request server.
  const calls = new AsyncLocalStorage<{ readonly signal: AbortSignal; readonly caller?: SignedCaller }>();
  const serverFor = () => {
    const call = calls.getStore();
    const server = makeServer(children, call?.signal, log, drafts ? { replies: () => repliesSaid(drafts), heardFyis: () => drafts.heardFyis() } : undefined, gate ? signedTools : []);
    if (gate) registerSignedTools(server, () => call?.caller);
    if (drafts) registerWriteTools(server, drafts, (id) => openQuestion(children, call?.signal, id), () => unheardFyiIds(children, call?.signal), log);
    return server;
  };
  const handler = createMcpHandler(serverFor, {
    // 2025-era clients: one fresh server per request, answered as a short SSE stream; 2026-07-28 clients: one JSON body.
    legacy: "stateless",
    maxRequestBodySize: limits.bodyBytes,
    // No tool takes a subscription, so none is ever held open (contract 1.21).
    maxSubscriptions: 0,
    onerror: (error: unknown) => log(`mcp: ${String((error as Error | undefined)?.message ?? error).slice(0, 200)}`),
  });
  const route = digest(`/mcp/${config.token}`);
  const metadataRoute = gate ? digest(`/.well-known/oauth-protected-resource/mcp/${config.token}`) : null;

  const server = http.createServer(async (req, res) => {
    const began = Date.now();
    const xff = forwardedFor(req);
    let summary = "route=none";
    let logged = false;
    const finish = (status: number) => {
      if (logged) return;
      logged = true;
      log(`${req.method} ${summary} ${status} ${Date.now() - began}ms xff=${xff ?? "-"}`);
    };
    // The caller hanging up before the answer is complete stops the request's child, or takes it out of a queue (499).
    const hangup = new AbortController();
    res.on("close", () => {
      if (res.writableFinished) return;
      hangup.abort();
      finish(499);
    });
    try {
      // Constant-time comparison of the path (hashing first makes the lengths equal); the query string is ignored.
      const pathname = (req.url ?? "").split("?")[0]!;
      if (gate && metadataRoute && crypto.timingSafeEqual(digest(pathname), metadataRoute)) {
        // Read by claude.ai to find the sign-in service, before any token exists: no range check, nothing secret beyond the path.
        summary = "route=metadata";
        if (req.method !== "GET") {
          bare(res, 405, { allow: "GET" });
          return finish(405);
        }
        res.writeHead(200, { "content-type": "application/json", "content-length": String(Buffer.byteLength(gate.metadata)), "cache-control": "no-store" });
        res.end(gate.metadata);
        return finish(200);
      }
      if (!crypto.timingSafeEqual(digest(pathname), route)) {
        bare(res, 404);
        return finish(404);
      }
      summary = "route=mcp";
      if (config.cidrs && (xff === undefined || xff === "invalid" || !config.cidrs.check(xff, net.isIPv6(xff) ? "ipv6" : "ipv4"))) {
        summary += " denied=cidr";
        bare(res, 403);
        return finish(403);
      }
      if (req.method !== "POST") {
        // No event stream and no sessions: every method but POST gets 405, naming the one there is.
        bare(res, 405, { allow: "POST" });
        return finish(405);
      }
      const declared = Number(req.headers["content-length"] ?? 0);
      if (declared > limits.bodyBytes) {
        summary += " denied=size";
        closeAfter(req, res, 413);
        return finish(413);
      }
      let body: Buffer;
      try {
        body = await readBody(req, limits.bodyBytes);
      } catch (error) {
        const status = (error as { status?: number }).status ?? 400;
        summary += status === 413 ? " denied=size" : " body=error";
        closeAfter(req, res, status);
        return finish(status);
      }
      summary = rpcSummary(body);
      if (isBatch(body)) {
        // The SDK would run up to 100 calls from one batch at once; one message per request keeps the child limits meaningful.
        summary += " denied=batch";
        jsonRpcError(res, 400, -32600, "Invalid Request: JSON-RPC batches are not accepted here; send one message per request");
        return finish(400);
      }
      const request = webRequest(req, body, hangup.signal);
      const badHost = hostHeaderValidationResponse(request, [...config.allowedHosts]);
      if (badHost) {
        summary += " denied=host";
        await sendWeb(res, badHost);
        return finish(badHost.status);
      }
      let caller: SignedCaller | undefined;
      const tool = calledTool(body);
      if (gate && (config.signIn!.everyCall || (tool !== undefined && signedTools.includes(tool)))) {
        // By default only a signed tool's call reads the token, so a broken sign-in cannot take reads down. With every call
        // signed (1.20), initialize and reads need it too: claude.ai only signs in when its first calls are refused.
        try {
          caller = await gate.verify(req.headers.authorization);
        } catch (error) {
          if (!(error instanceof SignInRefusal)) throw error;
          summary += ` denied=signin:${error.reason}`;
          bare(res, error.status, error.status === 401 ? { "www-authenticate": gate.challenge(error) } : {});
          return finish(error.status);
        }
      }
      const response = await calls.run({ signal: hangup.signal, ...(caller ? { caller } : {}) }, () => handler.fetch(request));
      await sendWeb(res, response);
      return finish(response.status);
    } catch (error) {
      if (hangup.signal.aborted) return finish(499);
      log(`server error: ${(error as Error | undefined)?.name ?? "Error"}: ${String((error as Error | undefined)?.message ?? "").slice(0, 200)}`);
      if (!res.headersSent) bare(res, 500);
      else res.end();
      return finish(500);
    }
  });
  // Node's default (5 s) is shorter than Tailscale Funnel's 90 s idle pool: a POST sent on a socket just as Node closed
  // it would reach claude.ai as a 502 no log line explains. Outlive the proxy's pool instead.
  server.keepAliveTimeout = limits.keepAliveMs;
  server.headersTimeout = limits.keepAliveMs + 1_000;

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, "127.0.0.1", () => {
      server.off("error", reject);
      const port = (server.address() as net.AddressInfo).port;
      log(
        `voice door listening on http://127.0.0.1:${port} (route /mcp/<token>; allowed hosts: ${config.allowedHosts.join(",")}; ` +
          `caller range check: ${config.cidrs ? config.cidrText : "off"}; sign-in: ${config.signIn ? `${config.signIn.issuer}, owner ${config.signIn.owner}` : "off, no signed tools"}; ` +
          `voice writes: ${drafts ? "on, drafted in the door's database" : "off"}; ` +
          `repo: ${config.repoDir})`,
      );
      resolve({
        port,
        close: async () => {
          server.closeAllConnections();
          await new Promise<void>((done) => server.close(() => done()));
          await handler.close();
          await drafts?.close();
        },
      });
    });
  });
}
