/** Capability 1 · The address and its guards, contracts 1.1-1.14: the door run in-process against a stand-in command line. */
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { quietFor, waitUntil } from "@storytree/test-waits";

import { BUSY, CANCELLED, Children, Gate, LIMITS, Refusal, limitsWith } from "./children.js";
import { main } from "./bins/voice.js";
import { loadConfig, voiceSession } from "./config.js";
import {
  FAKE_CLI, INITIALIZE, LEGACY_HEADERS, MCP_HEADERS, TUNNEL_HOST, alive, childrenIn, gitRepo, messagesOf, newToken, raw, seen, testDoor, textOf, toolCall,
} from "./testing/door.js";

const repo = gitRepo({ "README.md": "voice test repository\n" });
after(() => repo.remove());

test("1.1 any path but /mcp/<secret>, /.well-known/* and a wrong secret included, is a bare 404, never 401, and starts no child", async () => {
  const door = await testDoor(repo.dir);
  try {
    const paths = [
      `/mcp/${newToken()}`, "/mcp", "/", `${door.route}/extra`, door.route.slice(0, -1),
      "/.well-known/oauth-protected-resource", `/.well-known/oauth-protected-resource${door.route}`, "/.well-known/oauth-authorization-server", "/.well-known/openid-configuration",
    ];
    for (const urlPath of paths) {
      for (const method of ["GET", "POST"]) {
        const answer = await raw(door.port, { method, urlPath, headers: LEGACY_HEADERS, ...(method === "POST" ? { body: toolCall(1, "find", { query: "anything" }) } : {}) });
        assert.equal(answer.status, 404, `${method} ${urlPath.replace(door.token, "<token>")}`);
        assert.equal(answer.body, "");
      }
    }
    await quietFor(() => childrenIn(door.cliLog).started > 0, 200, "a child starting for a refused path");
  } finally {
    await door.close();
  }
});

test("1.2 on the secret route every method but POST is answered 405 with Allow: POST and an empty body", async () => {
  const door = await testDoor(repo.dir);
  try {
    for (const method of ["GET", "DELETE", "PUT", "OPTIONS", "HEAD"]) {
      const answer = await raw(door.port, { method, urlPath: door.route, headers: { accept: "text/event-stream" } });
      assert.equal(answer.status, 405, method);
      assert.equal(answer.headers.allow, "POST", method);
      assert.equal(answer.body, "", method);
    }
  } finally {
    await door.close();
  }
});

test("1.3 with caller ranges set, a missing, malformed or outside X-Forwarded-For first hop is 403 and runs no tool; one inside is served", async () => {
  const door = await testDoor(repo.dir, { ALLOWED_CIDRS: "160.79.104.0/21" });
  try {
    for (const forwarded of [undefined, "not-an-ip", "8.8.8.8", "8.8.8.8, 160.79.106.37"]) {
      const headers: Record<string, string> = { ...LEGACY_HEADERS, ...(forwarded === undefined ? {} : { "x-forwarded-for": forwarded }) };
      const answer = await raw(door.port, { urlPath: door.route, headers, body: toolCall(1, "find", { query: "anything" }) });
      assert.equal(answer.status, 403, `x-forwarded-for: ${forwarded}`);
    }
    await quietFor(() => childrenIn(door.cliLog).started > 0, 200, "a child starting for a refused caller");
    const inside = await raw(door.port, { urlPath: door.route, headers: { ...LEGACY_HEADERS, "x-forwarded-for": "160.79.106.37" }, body: toolCall(2, "find", { query: "anything" }) });
    assert.equal(inside.status, 200);
    assert.equal(seen(messagesOf(inside.body)[0]!.result!).argv.at(-1), "anything");
  } finally {
    await door.close();
  }
});

test("1.4 a Host that is neither localhost nor configured is refused before any tool runs; a configured one is served", async () => {
  const door = await testDoor(repo.dir);
  try {
    const evil = await raw(door.port, { urlPath: door.route, headers: { ...LEGACY_HEADERS, host: "evil.example" }, body: toolCall(1, "find", { query: "anything" }) });
    assert.ok(evil.status! >= 400, `evil.example -> ${evil.status}`);
    assert.ok(!messagesOf(evil.body).some((message) => message.result), "a tool answered");
    await quietFor(() => childrenIn(door.cliLog).started > 0, 200, "a child starting for a refused Host");
    const tunnel = await raw(door.port, { urlPath: door.route, headers: { ...MCP_HEADERS, host: TUNNEL_HOST }, body: INITIALIZE });
    assert.equal(tunnel.status, 200);
  } finally {
    await door.close();
  }
});

test("1.5 a body over 1 MB is answered 413, declared or found while reading, and the client sees 413 rather than a reset", async () => {
  const door = await testDoor(repo.dir);
  try {
    const declared = await raw(door.port, { urlPath: door.route, headers: MCP_HEADERS, body: "x".repeat(1_500_000) });
    assert.equal(declared.status, 413);
    const chunked = await raw(door.port, { urlPath: door.route, headers: MCP_HEADERS, body: Array.from({ length: 6 }, () => "x".repeat(250_000)) });
    assert.equal(chunked.status, 413);
  } finally {
    await door.close();
  }
});

test("1.6 a JSON-RPC batch is answered 400 with error -32600 and runs none of its calls", async () => {
  const door = await testDoor(repo.dir);
  try {
    const calls = [1, 2, 3].map((id) => JSON.parse(toolCall(id, "find", { query: "anything" })));
    for (const body of [JSON.stringify(calls), ` \r\n\t${JSON.stringify(calls.slice(0, 1))}`]) {
      const answer = await raw(door.port, { urlPath: door.route, headers: LEGACY_HEADERS, body });
      assert.equal(answer.status, 400);
      assert.equal(JSON.parse(answer.body).error?.code, -32600);
    }
    await quietFor(() => childrenIn(door.cliLog).started > 0, 300, "a child running for a batch");
  } finally {
    await door.close();
  }
});

test("1.7 at most 2 storytree children run at once and 4 more wait; the rest are told the box is busy without a child", async () => {
  const door = await testDoor(repo.dir);
  try {
    const answers = await Promise.all(
      Array.from({ length: 10 }, (_, at) => raw(door.port, { urlPath: door.route, headers: LEGACY_HEADERS, body: toolCall(at + 1, "find", { query: "sleep:1200" }) })),
    );
    const results = answers.map((answer) => messagesOf(answer.body)[0]?.result);
    const served = results.filter((result) => result && result.isError !== true).length;
    const busy = results.filter((result) => result?.isError === true && textOf(result).includes("busy")).length;
    assert.equal(served, 6, results.map((result) => textOf(result).slice(0, 60)).join(" | "));
    assert.equal(busy, 4);
    const children = childrenIn(door.cliLog);
    assert.equal(children.started, 6);
    assert.ok(children.peak <= 2, `${children.peak} at once`);
  } finally {
    await door.close();
  }
});

test("1.7 git's gate runs 4 and queues 8, refuses the 13th at once, and a queued call waits out one full command and its grace, then is refused", async (t) => {
  const config = loadConfig({ VOICE_TOKEN: newToken(), REPO_DIR: repo.dir, STORYTREE_CLI: JSON.stringify(FAKE_CLI) });
  const children = new Children(config, LIMITS, () => {});
  const held = await Promise.all(Array.from({ length: 4 }, () => children.git.enter(undefined)));
  const queued = Array.from({ length: 8 }, () => children.git.enter(undefined));
  await assert.rejects(children.git.enter(undefined), (error: Error) => error instanceof Refusal && error.message === BUSY);
  held.forEach((release) => release());
  for (const waiting of queued) (await waiting)();

  t.mock.timers.enable({ apis: ["setTimeout"] });
  const cli = new Children(config, LIMITS, () => {}).cli;
  const release = await cli.enter(undefined);
  await cli.enter(undefined); // the second slot
  let outcome = "waiting";
  cli.enter(undefined).then(() => (outcome = "granted"), (error: Error) => (outcome = error.message));
  // A three-command catch_up queues its third behind two that may each run their full limit (ADR-1163 D3).
  t.mock.timers.tick(LIMITS.cliMs + LIMITS.killGraceMs - 1);
  await Promise.resolve();
  assert.equal(outcome, "waiting");
  t.mock.timers.tick(1);
  await Promise.resolve();
  assert.equal(outcome, BUSY);
  release();
  // Shortened limits keep the wait one command long.
  assert.equal(limitsWith({ cliMs: 600, killGraceMs: 100 }).queueMs, 700);
});

test("1.8 a child past its time limit is stopped and its call answers a tool error naming the limit, inside 60 s", async () => {
  assert.deepEqual([LIMITS.cliMs, LIMITS.searchMs, LIMITS.gitMs], [25_000, 30_000, 15_000]);
  // The longest call: a full queue wait, a command's limit and the kill grace twice over, all under the client's 60 s.
  // A search's queue waits count against its own limit (1.8's next test), so it ends by its limit and the grace.
  assert.ok(LIMITS.queueMs + LIMITS.cliMs + 2 * LIMITS.killGraceMs < 60_000);
  assert.ok(LIMITS.searchMs + 2 * LIMITS.killGraceMs < 60_000);
  const door = await testDoor(repo.dir, {}, { searchMs: 1_000, killGraceMs: 300 });
  try {
    const answer = await raw(door.port, { urlPath: door.route, headers: LEGACY_HEADERS, body: toolCall(1, "find", { query: "sleep:20000:stubborn" }) });
    const result = messagesOf(answer.body)[0]?.result;
    assert.equal(result?.isError, true);
    assert.match(textOf(result), /within 1 seconds/);
    const pid = Number(/^start (\d+)/m.exec(childrenIn(door.cliLog).text)?.[1]);
    await waitUntil(() => !alive(pid), 3_000, "the stopped child to exit");
  } finally {
    await door.close();
  }
});

test("1.8 a find's waits for a slot count against its search limit, so a queued find still answers by that limit", async () => {
  const door = await testDoor(repo.dir, {}, { searchMs: 2_000, killGraceMs: 100 });
  try {
    // Two finds hold both slots for 1.5 s; the third waits for one, then needs 1.5 s more: past its 2 s.
    const started = Date.now();
    const timed = await Promise.all([1, 2, 3].map(async (id) => {
      const answer = await raw(door.port, { urlPath: door.route, headers: LEGACY_HEADERS, body: toolCall(id, "find", { query: "sleep:1500" }) });
      return { result: messagesOf(answer.body)[0]?.result, ms: Date.now() - started };
    }));
    const late = timed.find((one) => one.result?.isError === true);
    assert.ok(late, timed.map((one) => textOf(one.result).slice(0, 60)).join(" | "));
    assert.match(textOf(late.result), /within \d seconds/);
    for (const one of timed) assert.ok(one.ms < 2_000 + 2 * 100 + 700, `${one.ms} ms`);
  } finally {
    await door.close();
  }
});

test("1.9 a caller hanging up stops its running child, even one ignoring SIGTERM, takes a waiting call out of the queue, and frees its slot", async () => {
  // No queue: a slot the hung-up call still held would refuse one of the two calls after it as busy.
  const door = await testDoor(repo.dir, {}, { killGraceMs: 500, cliWaiting: 0 });
  try {
    const request = http.request({ host: "127.0.0.1", port: door.port, method: "POST", path: door.route, headers: LEGACY_HEADERS, agent: false });
    request.on("error", () => {});
    request.end(toolCall(1, "find", { query: "sleep:20000:stubborn" }));
    const pid = Number(await waitUntil(() => /^start (\d+)/m.exec(childrenIn(door.cliLog).text)?.[1], 8_000, "the child to start"));
    assert.ok(pid > 0, "the child never started");
    request.destroy();
    await waitUntil(() => !alive(pid), 5_000, "the hung-up caller's child to exit");
    assert.ok(!childrenIn(door.cliLog).text.includes(`end ${pid}`), "the child ran to its end");
    await waitUntil(() => door.lines.some((line) => / 499 /.test(line)), 2_000, "a 499 line");
    // Both slots are free again: two calls at once are both served. The slot is released when the child's pipes close,
    // a moment after its pid is gone (longer on Windows), so the pair is retried until then; a slot never freed fails it.
    let refused: string | undefined;
    await waitUntil(async () => {
      const answers = await Promise.all([1, 2].map((id) => raw(door.port, { urlPath: door.route, headers: LEGACY_HEADERS, body: toolCall(id, "find", { query: "sleep:300" }) })));
      refused = answers.find((answer) => messagesOf(answer.body)[0]?.result?.isError === true)?.body.slice(0, 200);
      return refused === undefined;
    }, 5_000, "two calls at once both served").catch((error: Error) => assert.fail(`${error.message}; the last refusal: ${refused}`));
  } finally {
    await door.close();
  }

  const gate = new Gate("storytree", 1, 1, 10_000, () => {});
  const release = await gate.enter(undefined);
  const hangup = new AbortController();
  const waiting = gate.enter(hangup.signal);
  hangup.abort();
  await assert.rejects(waiting, (error: Error) => error.message === CANCELLED);
  const next = gate.enter(undefined); // the queue's one place is free again, so this waits rather than being refused
  release();
  (await next)();
});

test("1.10 an idle connection stays open for 100 s: the door keeps the socket and tells the caller it will for 100 s", async () => {
  assert.equal(LIMITS.keepAliveMs, 100_000);
  const door = await testDoor(repo.dir);
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  try {
    const first = await raw(door.port, { urlPath: door.route, headers: MCP_HEADERS, body: INITIALIZE, agent });
    // Node advertises the idle timeout it enforces, so the header is the door's own 100 s, not Node's 5 s default.
    assert.match(String(first.headers["keep-alive"] ?? ""), /timeout=100\b/);
    const second = await raw(door.port, { urlPath: door.route, headers: MCP_HEADERS, body: INITIALIZE, agent });
    assert.equal(second.status, 200);
    assert.equal(second.reused, true);
  } finally {
    agent.destroy();
    await door.close();
  }
});

test("1.11 the door refuses to start, with one plain line and exit 1, on a bad secret, an unreadable repository or a range that is not a CIDR", async () => {
  const scratch = mkdtempSync(path.join(os.tmpdir(), "storytree-voice-bin-"));
  const file = path.join(scratch, "a-file");
  writeFileSync(file, "");
  try {
    const good = newToken();
    const cases: Array<[string, Record<string, string>, RegExp]> = [
      ["no secret", { VOICE_TOKEN: "", VOICE_SPIKE_TOKEN: "" }, /VOICE_TOKEN/],
      ["a 31-character secret", { VOICE_TOKEN: "a".repeat(31) }, /32/],
      ["a secret with a slash", { VOICE_TOKEN: `${"a".repeat(40)}/x` }, /letters, digits/],
      ["a missing repository", { VOICE_TOKEN: good, REPO_DIR: path.join(scratch, "gone") }, /REPO_DIR/],
      ["a repository that is a file", { VOICE_TOKEN: good, REPO_DIR: file }, /REPO_DIR/],
      ["a range that is not a CIDR", { VOICE_TOKEN: good, ALLOWED_CIDRS: "160.79.104.0/21,10.0.0.1" }, /ALLOWED_CIDRS/],
    ];
    for (const [label, env, why] of cases) {
      let stderr = "";
      const exits: number[] = [];
      const door = await main({ PORT: "0", REPO_DIR: repo.dir, ...env }, { stderr: (line) => (stderr += line), exit: (code) => exits.push(code) });
      assert.equal(door, undefined, label);
      assert.deepEqual(exits, [1], label);
      assert.equal(stderr.trim().split("\n").length, 1, `${label}: ${stderr}`);
      assert.match(stderr, /^voice door refused to start: /, label);
      assert.match(stderr, why, label);
      if (env.VOICE_TOKEN) assert.ok(!stderr.includes(env.VOICE_TOKEN), `${label}: the secret is in the message`);
    }
    // Good settings start it, and the spike's secret variable is still read.
    const started = await main({ PORT: "0", REPO_DIR: repo.dir, VOICE_SPIKE_TOKEN: newToken() }, { stderr: () => {}, exit: () => assert.fail("it exited") });
    assert.ok(started !== undefined && started.port > 0);
    await started.close();

    // Run as a program, the refusal is the process's exit code.
    const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("bins/voice.ts", import.meta.url))], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { ...process.env, PORT: "0", REPO_DIR: repo.dir, VOICE_TOKEN: "short", VOICE_SPIKE_TOKEN: "" },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const code = await new Promise<number | null>((resolve) => child.on("exit", resolve));
    assert.equal(code, 1, stderr);
    assert.match(stderr, /refused to start: VOICE_TOKEN/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("1.12 a child gets an argument array with no shell, runs in the door's repository and inherits none of its secret or settings", async () => {
  const door = await testDoor(repo.dir, { VOICE_SPIKE_TOKEN: newToken(), ALLOWED_CIDRS: "127.0.0.1/32" });
  try {
    const hostile = "a $(whoami) `id` ; rm -rf x $HOME";
    const answer = await raw(door.port, { urlPath: door.route, headers: { ...LEGACY_HEADERS, "x-forwarded-for": "127.0.0.1" }, body: toolCall(1, "find", { query: hostile }) });
    const child = seen(messagesOf(answer.body)[0]!.result!);
    assert.deepEqual(child.argv, ["library", "search", "--limit", "5", "--", hostile]);
    assert.equal(realpathSync.native(child.cwd).toLowerCase(), realpathSync.native(repo.dir).toLowerCase());
    const leaked = Object.keys(child.env).filter((name) => /^(VOICE_TOKEN|VOICE_SPIKE_TOKEN|PORT|REPO_DIR|ALLOWED_HOSTS|ALLOWED_CIDRS|STORYTREE_CLI)$/i.test(name));
    assert.deepEqual(leaked, []);
  } finally {
    await door.close();
  }
});

test("1.13 every child runs as the day's voice session (voice-YYYY-MM-DD) and no other harness's session", async () => {
  assert.equal(voiceSession(new Date("2026-10-23T23:59:00Z")), "voice-2026-10-23");
  const door = await testDoor(repo.dir, { CLAUDE_CODE_SESSION_ID: "owner-claude-session", CODEX_THREAD_ID: "owner-codex", CURSOR_CONVERSATION_ID: "c", PI_SESSION_ID: "p", STORYTREE_SESSION_ID: "someone-else" });
  try {
    const answer = await raw(door.port, { urlPath: door.route, headers: LEGACY_HEADERS, body: toolCall(1, "find", { query: "the voice session" }) });
    const child = seen(messagesOf(answer.body)[0]!.result!);
    const today = voiceSession(new Date());
    assert.deepEqual(child.env, { STORYTREE_SESSION_ID: today });
  } finally {
    await door.close();
  }
});

test("1.14 the log holds one line per request (method, tool, status, time, caller) and never the secret, the path or a tool's arguments", async () => {
  const door = await testDoor(repo.dir, { ALLOWED_CIDRS: "127.0.0.1/32" });
  try {
    const from = { ...LEGACY_HEADERS, "x-forwarded-for": "127.0.0.1" };
    await raw(door.port, { urlPath: door.route, headers: from, body: toolCall(1, "find", { query: "a-private-phrase-71" }) });
    await raw(door.port, { urlPath: "/somewhere-private-72", headers: MCP_HEADERS, body: INITIALIZE });
    await raw(door.port, { urlPath: door.route, headers: from, body: toolCall(2, "search_code", { text: "a-private-text-73" }) });
    const log = door.lines.join("\n");
    for (const secret of [door.token, "a-private-phrase-71", "somewhere-private-72", "a-private-text-73"]) {
      assert.ok(!log.includes(secret), `the log holds ${secret === door.token ? "the secret" : secret}`);
    }
    // The start line names the route only as the literal "/mcp/<token>".
    assert.deepEqual(log.match(/\/mcp\/\S*/g), ["/mcp/<token>;"]);
    const requests = door.lines.slice(1);
    assert.equal(requests.length, 3);
    assert.match(requests[0]!, /^POST rpc=tools\/call\(find\) 200 \d+ms xff=127\.0\.0\.1$/);
    assert.match(requests[1]!, /^POST route=none 404 \d+ms xff=-$/);
    assert.match(requests[2]!, /^POST rpc=tools\/call\(search_code\) 200 \d+ms xff=127\.0\.0\.1$/);
  } finally {
    await door.close();
  }
});
