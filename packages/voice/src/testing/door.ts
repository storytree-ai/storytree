/**
 * Test helpers for the voice door: the door started in this process against a stand-in command line, raw HTTP to it,
 * an MCP client on its route, and a throwaway git repository for the code tools.
 */
import http from "node:http";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { LIMITS, type Limits } from "../children.js";
import { loadConfig } from "../config.js";
import { startDoor, type Door } from "../door.js";

export const FAKE_CLI = [process.execPath, fileURLToPath(new URL("fake-cli.mjs", import.meta.url))];
export const TUNNEL_HOST = "voice-box.example-tailnet.ts.net";
export const newToken = () => crypto.randomBytes(24).toString("hex"); // 48 characters

export interface TestDoor extends Door {
  readonly token: string;
  readonly route: string;
  /** Every line the door logged. */
  readonly lines: string[];
  /** The stand-in's start and end lines. */
  readonly cliLog: string;
  close(): Promise<void>;
}

/** Start the door against the stand-in command line in `repoDir`, with the environment and limits given over the defaults. */
export async function testDoor(repoDir: string, env: Record<string, string> = {}, limits: Partial<Limits> = {}): Promise<TestDoor> {
  const token = newToken();
  const scratch = mkdtempSync(path.join(os.tmpdir(), "storytree-voice-log-"));
  const cliLog = path.join(scratch, "children.log");
  writeFileSync(cliLog, "");
  const config = loadConfig({
    ...process.env,
    PORT: "0",
    REPO_DIR: repoDir,
    VOICE_TOKEN: token,
    STORYTREE_CLI: JSON.stringify(FAKE_CLI),
    ALLOWED_HOSTS: TUNNEL_HOST,
    FAKE_CLI_LOG: cliLog,
    ...env,
  });
  const lines: string[] = [];
  const door = await startDoor(config, { limits: { ...LIMITS, ...limits }, log: (line) => lines.push(line) });
  return {
    ...door,
    token,
    route: `/mcp/${token}`,
    lines,
    cliLog,
    close: async () => {
      await door.close();
      rmSync(scratch, { recursive: true, force: true });
    },
  };
}

export interface Answer {
  readonly status: number | undefined;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: string;
  readonly reused: boolean;
}

/** One raw HTTP request (http.request, because fetch drops a custom Host header). */
export function raw(port: number, { method = "POST", urlPath, headers = {}, body, agent }: { method?: string; urlPath: string; headers?: Record<string, string>; body?: string | string[]; agent?: http.Agent }): Promise<Answer> {
  return new Promise((resolve, reject) => {
    let answered = false;
    const request = http.request({ host: "127.0.0.1", port, method, path: urlPath, headers, ...(agent ? { agent } : {}) }, (response) => {
      answered = true;
      let text = "";
      const end = () => resolve({ status: response.statusCode, headers: response.headers, body: text, reused: request.reusedSocket });
      response.on("data", (chunk) => (text += chunk));
      response.on("end", end);
      response.on("error", end);
    });
    request.on("error", (error) => {
      if (!answered) reject(error);
    });
    if (Array.isArray(body)) {
      for (const chunk of body) request.write(chunk); // no content-length: sent chunked
      request.end();
    } else request.end(body);
  });
}

export const INITIALIZE = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw", version: "0" } },
});
export const MCP_HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };
/** A bare 2025-era tools/call, with no initialize before it. */
export const LEGACY_HEADERS = { ...MCP_HEADERS, "mcp-protocol-version": "2025-06-18" };
export const toolCall = (id: number, name: string, args: Record<string, unknown> = {}) => JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });

type Content = { content?: unknown; isError?: unknown };
export const textOf = (result: Content | undefined): string => ((result?.content ?? []) as Array<{ text?: string }>).map((part) => part.text ?? "").join("\n");
/** What the stand-in saw, from its JSON answer. */
export const seen = (result: Content): { argv: string[]; cwd: string; pid: number; env: Record<string, string> } => JSON.parse(textOf(result));

/** The JSON-RPC messages in an answer, whether one JSON body or an SSE stream of data: lines. */
export function messagesOf(body: string): Array<{ result?: Content; error?: { code: number } }> {
  const data = body.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim());
  return (data.length > 0 ? data : [body]).flatMap((text) => {
    try {
      return [JSON.parse(text)];
    } catch {
      return [];
    }
  });
}

export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll probe() every 50 ms until it returns something truthy, or undefined after ms. */
export async function until<T>(probe: () => T, ms: number): Promise<T | undefined> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() > deadline) return undefined;
    await wait(50);
  }
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** From the stand-in's start and end lines: how many children started, how many ran to their end, and the most at once. */
export function childrenIn(logFile: string): { started: number; ended: number; peak: number; text: string } {
  const text = readFileSync(logFile, "utf8");
  const events = text.split("\n").filter(Boolean).map((line) => line.split(" "))
    .map(([kind, pid, at]) => ({ kind, pid, at: Number(at) }))
    .sort((a, b) => a.at - b.at || (a.kind === "end" ? -1 : 1));
  let now = 0;
  let peak = 0;
  for (const event of events) {
    now += event.kind === "start" ? 1 : -1;
    peak = Math.max(peak, now);
  }
  return { started: events.filter((e) => e.kind === "start").length, ended: events.filter((e) => e.kind === "end").length, peak, text };
}

export async function connect(port: number, token: string, options?: ConstructorParameters<typeof Client>[1]): Promise<Client> {
  const client = new Client({ name: "voice-test", version: "0.0.1" }, options);
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp/${token}`)));
  return client;
}

/** A throwaway git repository with one commit made of `files`; returns its folder and a git runner in it. */
export function gitRepo(files: Record<string, string | Buffer>): { dir: string; git: (...args: string[]) => string; remove: () => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "storytree-voice-repo-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=voice test", "-c", "user.email=test@example.invalid", "-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q");
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), content);
  }
  git("add", "-A");
  git("commit", "-q", "-m", "fixture");
  return { dir, git, remove: () => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }) };
}
