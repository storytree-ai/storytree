import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { CLAIM_GRACE_MS, cloudOverflow, cloudSecrets, FIRE_BACKOFF_MS, fireCloud, judgeLanes, whyNotCloud } from "./cloud.mjs";
import { main, runPool } from "./launch.mjs";

const T0 = Date.parse("2026-11-06T04:00:00Z");
const SATURATED = { hold: "pause", windows: ["cpu"], reason: "box saturated: CPU load 19.5 on 12 cores" };

function work(ids, extra = {}) {
  return {
    increments: ids.map((id, at) => ({ id, arc: `arc_${id}`, arcState: "active", title: id, body: extra.bodies?.[id] ?? "", status: extra.status?.[id] ?? "proposal",
      parked: `2026-10-0${at + 1}T00:00:00Z`, ...(extra.machine?.[id] ? { machine: extra.machine[id] } : {}), ...(extra.disposition?.[id] ? { disposition: extra.disposition[id] } : {}) })),
    holds: { waits: {}, heldOn: {}, waitsFor: extra.waitsFor ?? {} }, claims: extra.claims ?? [],
  };
}

/** A cloud overflow over an in-memory ledger: every fire is recorded, and answered by `answer` (a session, or a thrown error). */
function overflowOf({ config = { enabled: true, cap: 2, trigger: "trig_01abc" }, token = "sk-ant-oat01-x", answer, clock = () => T0, lines = [], ledger = {} } = {}) {
  const fires = [];
  const cloud = cloudOverflow({
    config, secrets: async () => ({ token }), file: "/lanes/pool-cloud.json", now: clock, say: (line) => lines.push(line),
    read: async () => { if (!ledger.text) throw Object.assign(new Error("none"), { code: "ENOENT" }); return ledger.text; },
    write: async (_, text) => { ledger.text = text; },
    fire: async (request) => { fires.push(request); return answer ? answer(request) : { session: `session_${request.text}`, url: `https://claude.ai/code/session_${request.text}` }; },
  });
  return { cloud, fires, lines, ledger };
}

/** runPool on a box held back for `looks` looks, every lane the box starts recorded, stopped after the last look. */
async function poolRun({ found, cloud, looks = 3, paces, engines = 0, cap = 2, clock = () => T0 }) {
  const started = [], lines = [];
  let looked = 0, stop = false;
  await runPool({
    survey: async () => (typeof found === "function" ? found() : found), maxLanes: async () => cap, count: async () => engines, cloud, idleMs: 0,
    pace: async () => (paces ? paces.shift() : SATURATED), stopFile: "/lanes/pool-stop", exists: async () => stop, now: clock, say: (line) => lines.push(line),
    launch: async (one, { engineUp }) => { started.push(one.id); engineUp(); return 0; },
    sleep: async () => { looked += 1; await new Promise((go) => setImmediate(go)); if (looked >= looks) stop = true; },
  });
  return { started, lines };
}

test("3.40 · while the box reads saturated and the overflow is switched on, the dispatcher fires the cloud task for ready increments up to the cloud cap, naming each by id, and claims nothing; switched off, or with the box clear, it fires nothing", async () => {
  const on = overflowOf();
  const { started } = await poolRun({ found: work(["a", "b", "c"]), cloud: on.cloud });
  assert.deepEqual(on.fires.map((fire) => fire.text), ["a", "b"], "two fired, the cap: the third waits");
  assert.deepEqual(on.fires.map((fire) => fire.trigger), ["trig_01abc", "trig_01abc"]);
  assert.deepEqual(started, [], "saturated: the box itself starts nothing");
  assert.ok(on.lines.some((line) => /cloud lane fired for a \(box saturated\): session session_a/.test(line)), on.lines.join("\n"));
  assert.deepEqual(JSON.parse(on.ledger.text).lanes.map((lane) => [lane.increment, lane.state]), [["a", "live"], ["b", "live"]], "each fire is kept, live");

  const off = overflowOf({ config: { enabled: false, cap: 2, trigger: "trig_01abc" } });
  await poolRun({ found: work(["a"]), cloud: off.cloud });
  assert.deepEqual(off.fires, [], "switched off: no fire");

  const clear = overflowOf();
  const box = await poolRun({ found: work(["a"]), cloud: clear.cloud, paces: [undefined, undefined, undefined], looks: 2 });
  assert.deepEqual(clear.fires, [], "a clear box starts its own lanes and fires nothing");
  assert.deepEqual(box.started, ["a"]);

  const tokenless = overflowOf({ token: "" });
  await poolRun({ found: work(["a"]), cloud: tokenless.cloud });
  assert.deepEqual(tokenless.fires, [], "no token: no fire");
  assert.equal(tokenless.lines.filter((line) => /no trigger or token/.test(line)).length, 1, "said once");
});

test("3.40 · a fire is one POST to the cloud task's trigger, its token as the bearer and the increment as the text; it answers the new session and its link", async () => {
  const sent = [];
  const fetch = async (url, init) => { sent.push({ url, init }); return { ok: true, json: async () => ({ type: "routine_fire", claude_code_session_id: "session_01X", claude_code_session_url: "https://claude.ai/code/session_01X" }) }; };
  assert.deepEqual(await fireCloud({ trigger: "trig_01abc", token: "sk-ant-oat01-x", text: "increment_123", fetch }), { session: "session_01X", url: "https://claude.ai/code/session_01X" });
  assert.equal(sent[0].url, "https://api.anthropic.com/v1/claude_code/routines/trig_01abc/fire");
  assert.equal(sent[0].init.method, "POST");
  assert.equal(sent[0].init.headers.authorization, "Bearer sk-ant-oat01-x");
  assert.ok(sent[0].init.headers["anthropic-version"]);
  assert.deepEqual(JSON.parse(sent[0].init.body), { text: "increment_123" });

  const refused = async () => ({ ok: false, status: 429, headers: new Map([["retry-after", "120"]]) });
  await assert.rejects(fireCloud({ trigger: "trig_01abc", token: "t", text: "a", fetch: refused }), (error) => error.status === 429 && error.retryAfter === 120);
});

test("3.41 · an ineligible increment is never fired: a machine named, read-only or blind work, another project's, or wording naming a box-only need or agent roles", async () => {
  const bodies = {
    gpu: "Measure the lag run on the GPU.", box: "Restart the systemd unit on the Mint box.", roles: "Edit the agent roles in the library, then pnpm build:guidance.",
    looks: "needs: read-only. Count the tests.", fine: "Make the CLI's arc list sort by priority.",
  };
  const found = work(["laptop", "gpu", "box", "roles", "looks", "fine"], { bodies, machine: { laptop: "laptop" } });
  const { cloud, fires } = overflowOf({ config: { enabled: true, cap: 6, trigger: "trig_01abc" } });
  await poolRun({ found, cloud });
  assert.deepEqual(fires.map((fire) => fire.text), ["fine"], "only the plain build went to the cloud");

  assert.match(whyNotCloud({ id: "x", body: "", machine: "laptop" }), /needs laptop/);
  assert.match(whyNotCloud({ id: "x", body: "Watch the watcher's red." }), /box-only/);
  assert.match(whyNotCloud({ id: "x", body: "Change .claude/agents/explorer.md" }), /agent roles/);
  assert.match(whyNotCloud({ id: "x", body: "", project: "storytree-website" }), /storytree-website/);
  assert.match(whyNotCloud({ id: "x", body: "", plan: true }), /planning/);
  assert.equal(whyNotCloud({ id: "x", title: "Sort arcs", body: bodies.fine }), undefined);
});

test("3.42 · an increment fired to the cloud is not started on the box while its cloud lane is live, its claim not yet made or made; once its lane fails the box takes it, and it is never fired again", async () => {
  let clock = T0;
  const { cloud, fires } = overflowOf({ clock: () => clock });
  await poolRun({ found: work(["a"]), cloud, clock: () => clock });
  assert.deepEqual(fires.map((fire) => fire.text), ["a"]);

  // The box clears before the cloud lane has claimed: the box leaves a alone.
  const early = await poolRun({ found: work(["a", "b"]), cloud, paces: [undefined, undefined, undefined], clock: () => clock });
  assert.deepEqual(early.started, ["b"], "a is running in the cloud: only b starts on the box");

  // The lane claims a, then its claim is released with no hand-over: it failed, and a is the box's again.
  clock = T0 + 5 * 60_000;
  const claimed = work(["a"], { claims: [{ increment: "a", session: "session_a", holder: "live", since: new Date(clock).toISOString() }] });
  assert.deepEqual(await cloud.live(claimed), ["a"], "claimed and live");
  clock = T0 + 10 * 60_000;
  assert.deepEqual(await cloud.live(work(["a"])), [], "released with no hand-over: no longer live");
  const after = await poolRun({ found: work(["a"]), cloud, paces: [SATURATED, undefined, undefined], looks: 3, clock: () => clock });
  assert.deepEqual(fires.map((fire) => fire.text), ["a"], "never fired a second time");
  assert.deepEqual(after.started, ["a"], "the box takes it once clear");

  // A fired lane that never claims fails after the grace.
  const quiet = overflowOf({ clock: () => clock });
  await quiet.cloud.overflow(work(["c"]), {});
  clock += CLAIM_GRACE_MS + 1;
  assert.deepEqual(await quiet.cloud.live(work(["c"])), [], "no claim within the grace: failed");
});

test("3.43 · a fire error leaves the increment ready, is said once in pool status, and holds every fire until its Retry-After or the back-off passes", async () => {
  let clock = T0;
  let refuse = true;
  const { cloud, fires, lines, ledger } = overflowOf({ clock: () => clock,
    answer: (request) => { if (refuse) throw Object.assign(new Error("HTTP 429"), { status: 429, retryAfter: 600 }); return { session: `session_${request.text}` }; } });
  for (let look = 0; look < 5; look += 1) { await cloud.overflow(work(["a", "b"]), {}); clock += 60_000; }
  assert.equal(fires.length, 1, "one refused fire, then none while its Retry-After runs: no retry storm");
  assert.equal(lines.filter((line) => /cloud fire failed \(HTTP 429\): a stays ready/.test(line)).length, 1, lines.join("\n"));
  assert.deepEqual(await cloud.live(work(["a", "b"])), [], "nothing counted as running: a stays ready for the box");
  assert.equal(JSON.parse(ledger.text).fireErrors, 1);

  clock = T0 + 601_000; refuse = true;
  await cloud.overflow(work(["a"]), {});
  assert.equal(lines.filter((line) => /cloud fire failed/.test(line)).length, 1, "the same failure again is not said again");
  clock += FIRE_BACKOFF_MS + 1; refuse = false;
  await cloud.overflow(work(["a"]), {});
  assert.equal(fires.at(-1).text, "a", "past the hold it fires again");
  assert.deepEqual(await cloud.live(work(["a"])), ["a"]);

  // Through runPool, an overflow that throws leaves the dispatcher running.
  const throwing = { live: async () => [], wants: async () => true, overflow: async () => { throw new Error("library unread"); } };
  const { lines: said } = await poolRun({ found: work(["a"]), cloud: throwing });
  assert.ok(said.some((line) => /cloud overflow skipped \(library unread\)/.test(line)), said.join("\n"));
});

test("3.44 · the trial's lanes are counted fired, landed, failed, live and with the watcher, said in pool status as they change, and `launch.mjs cloud` reads them back", async (t) => {
  const lanes = ["a", "b", "c", "d", "e"].map((increment) => ({ increment, session: `session_${increment}`, at: new Date(T0).toISOString(), state: "live" }));
  const found = work(["a", "b", "c", "d", "e"], {
    status: { a: "closed", b: "closed" }, disposition: { a: "landed", b: "withdrawn" },
    waitsFor: { c: [{ releaser: "event", holds: true, note: "PR #9 is open and green and handed to the pool's watcher through the library by session session_c, and closes this on its merge" }] },
    claims: [{ increment: "d", session: "session_d", holder: "idle", since: new Date(T0 + 1000).toISOString() }, { increment: "e", session: "session_e", holder: "live", since: new Date(T0 + 1000).toISOString() }],
  });
  assert.deepEqual(judgeLanes(lanes, found, T0 + 60_000).map((lane) => lane.state), ["landed", "failed", "handed", "failed", "live"]);

  const ledger = { text: JSON.stringify({ lanes, fireErrors: 1 }) };
  const { cloud, lines } = overflowOf({ ledger, clock: () => T0 + 60_000 });
  assert.deepEqual(await cloud.live(found), ["e"]);
  assert.ok(lines.includes("cloud lanes: 5 fired, 1 landed, 2 failed, 1 live, 1 with the watcher; 1 fire error"), lines.join("\n"));
  assert.ok(lines.some((line) => /cloud lane for d failed: its holder session_d reads idle/.test(line)));
  const before = lines.length;
  await cloud.live(found);
  assert.equal(lines.length, before, "nothing changed: nothing said");

  const lanesDir = await mkdtemp(join(tmpdir(), "cloud-readout-"));
  t.after(() => removeTemp(lanesDir));
  await writeFile(join(lanesDir, "pool-cloud.json"), ledger.text);
  const out = [];
  assert.equal(await main(["cloud"], { lanesDir, cloudConfig: { enabled: true, cap: 2 }, out: (line) => out.push(line) }), 0);
  assert.equal(out[0], "cloud overflow on, cap 2");
  assert.equal(out[1], "cloud lanes: 5 fired, 1 landed, 2 failed, 1 live, 1 with the watcher; 1 fire error");
  assert.ok(out.some((line) => /^ {2}a {2}landed/.test(line)));
  assert.equal(JSON.parse(await readFile(join(lanesDir, "pool-cloud.json"), "utf8")).lanes.length, 5, "reading back changes nothing");

  // The token and, when the switch names none, the trigger come from secrets.json.
  await writeFile(join(lanesDir, "secrets.json"), JSON.stringify({ CLOUD_TRIGGER_TOKEN: "sk-ant-oat01-y", CLOUD_TRIGGER_ID: "trig_02" }));
  assert.deepEqual(await cloudSecrets(join(lanesDir, "secrets.json")), { token: "sk-ant-oat01-y", trigger: "trig_02" });
  assert.deepEqual(await cloudSecrets(join(lanesDir, "missing.json")), {});
});
