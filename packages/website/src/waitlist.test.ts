import assert from "node:assert/strict";
import { test } from "node:test";
import { submitWaitlist } from "./waitlist.js";

test("5.1 · joining posts only the chosen answers and waits for here.now to accept a record", async () => {
  let finish!: (response: Response) => void;
  let completed = false;
  const joined = submitWaitlist({ email: "  visitor@example.test  ", computer: "linux", agent: "codex" }, "attempt-1", async (url, init) => {
    assert.equal(url, "./.herenow/data/waitlist");
    assert.equal(init?.method, "POST");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), null);
    assert.equal(headers.get("idempotency-key"), "attempt-1");
    assert.ok(init?.signal);
    assert.deepEqual(JSON.parse(String(init?.body)), { email: "visitor@example.test", computer: "linux", agent: "codex" });
    return new Promise<Response>(resolve => { finish = resolve; });
  }).then(result => { completed = true; return result; });
  await Promise.resolve();
  assert.equal(completed, false);
  finish(Response.json({ record: { id: "row-1" } }, { status: 201 }));
  assert.equal(await joined, "joined");
  assert.equal(await submitWaitlist({ email: "visitor@example.test" }, "attempt-2", async (_url, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)), { email: "visitor@example.test" });
    return Response.json({ record: { id: "row-2" } }, { status: 201 });
  }), "joined");
});

test("5.2 · missing, malformed, oversized email and unoffered choices cannot send", async () => {
  let requests = 0;
  const fetch = async () => { requests++; return Response.json({ record: { id: "bad" } }); };
  for (const email of ["", "  ", "not-an-email", "a@", "a b@example.test", "a".repeat(250) + "@example.test"]) {
    assert.equal(await submitWaitlist({ email }, "attempt", fetch), "invalid");
  }
  for (const answers of [{ computer: "unsupported" }, { agent: "unsupported" }]) {
    assert.equal(await submitWaitlist({ email: "visitor@example.test", ...answers }, "attempt", fetch), "invalid");
  }
  assert.equal(requests, 0);
});

test("5.2 · refusals, rate limits, transport and malformed replies never claim an invitation was saved", async () => {
  const input = { email: "visitor@example.test", computer: "windows", agent: "claude-code" };
  for (const [status, expected] of [[400, "refused"], [403, "refused"], [429, "rate-limited"], [503, "failed"]] as const) {
    assert.equal(await submitWaitlist(input, "attempt", async () => new Response("untrusted text", { status })), expected);
  }
  for (const reply of [() => new Response("not JSON"), () => Response.json({}), () => Response.json({ record: {} }), () => { throw new Error("offline"); }]) {
    assert.equal(await submitWaitlist(input, "attempt", async () => reply()), "failed");
  }
  assert.deepEqual(input, { email: "visitor@example.test", computer: "windows", agent: "claude-code" });
});
