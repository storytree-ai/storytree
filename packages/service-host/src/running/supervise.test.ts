/** Capability 1 · Running services, contracts 1.2 to 1.4: the supervisor's timing rules, on a hand-turned clock with stand-in children. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { Supervisor, type Child, type Clock, type Ended } from "./supervise.js";

/** A clock the test turns by hand: timers fire only when it is moved past them. */
function handClock(): Clock & { move(ms: number): Promise<void> } {
  let now = 0;
  let timers: { at: number; fire: () => void }[] = [];
  return {
    now: () => now,
    after(ms, fire) {
      const timer = { at: now + ms, fire };
      timers.push(timer);
      return () => { timers = timers.filter((one) => one !== timer); };
    },
    async move(ms) {
      const to = now + ms;
      for (;;) {
        await settle();
        const next = timers.filter((one) => one.at <= to).sort((a, b) => a.at - b.at)[0];
        if (next === undefined) break;
        timers = timers.filter((one) => one !== next);
        now = next.at;
        next.fire();
      }
      now = to;
      await settle();
    },
  };
}

const settle = () => new Promise<void>((done) => setImmediate(done));

/** Stand-in children: each start is recorded, and the test ends one with an exit code, or it ends when signalled if told to. */
function children() {
  const started: { id: string; at: number; signals: string[]; end(code: number | null, signal?: string): void; child: Child }[] = [];
  let endOnTerm = true;
  return {
    started,
    hold() { endOnTerm = false; },
    start(clock: Clock) {
      return ({ id }: { id: string }): Child => {
        let finish!: (ended: Ended) => void;
        const ended = new Promise<Ended>((done) => { finish = done; });
        const one = {
          id, at: clock.now(), signals: [] as string[],
          end: (code: number | null, signal?: string) => finish({ code, signal: signal ?? null }),
          child: { ended, signal(name: "SIGTERM" | "SIGKILL") { one.signals.push(name); if (name === "SIGKILL" || endOnTerm) finish({ code: null, signal: name }); }, lastLines: () => [`${id} said goodbye`] },
        };
        started.push(one);
        return one.child;
      };
    },
  };
}

test("1.2 · an always service that ends is started again after 10 seconds, the wait doubling with each end up to 5 minutes; five ends within 10 minutes mark it failed, and it is not started again", async () => {
  const clock = handClock();
  const kids = children();
  const lines: string[] = [];
  const host = new Supervisor({ clock, start: kids.start(clock), log: (line) => lines.push(line) });
  host.set([{ id: "voice/listen", run: "always" }]);
  assert.equal(kids.started.length, 1, "an always service starts at once");

  const waits: number[] = [];
  for (let end = 1; end <= 4; end += 1) {
    kids.started.at(-1)!.end(1);
    await clock.move(0);
    const ended = clock.now();
    assert.equal(host.states()[0]!.state, "waiting");
    await clock.move(10_000 * 2 ** (end - 1) - 1);
    assert.equal(kids.started.length, end, "not started again before its wait is up");
    await clock.move(1);
    assert.equal(kids.started.length, end + 1);
    waits.push(kids.started.at(-1)!.at - ended);
  }
  assert.deepEqual(waits, [10_000, 20_000, 40_000, 80_000]);
  kids.started.at(-1)!.end(1);
  await clock.move(0);
  const failed = host.states()[0]!;
  assert.equal(failed.state, "failed", "five ends within 10 minutes mark it failed");
  assert.deepEqual(failed.lastLines, ["voice/listen said goodbye"]);
  assert.ok(lines.some((line) => /voice\/listen failed: it ended 5 times within 10 minutes/.test(line)), lines.join("\n"));
  await clock.move(3_600_000);
  assert.equal(kids.started.length, 5, "a failed service is not started again");

  // Spread out, its ends never reach five in 10 minutes, and the wait stops doubling at 5 minutes.
  const slow = handClock();
  const slowKids = children();
  const steady = new Supervisor({ clock: slow, start: slowKids.start(slow), log: () => {} });
  steady.set([{ id: "voice/listen", run: "always" }]);
  const slowWaits: number[] = [];
  for (let end = 1; end <= 8; end += 1) {
    await slow.move(170_000);
    slowKids.started.at(-1)!.end(1);
    await slow.move(0);
    const ended = slow.now();
    await slow.move(300_000);
    assert.equal(steady.states()[0]!.state, "running", `end ${end} did not mark it failed`);
    slowWaits.push(slowKids.started.at(-1)!.at - ended);
  }
  assert.deepEqual(slowWaits, [10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000, 300_000]);
});

test("1.3 · an every service is started on its cadence, and never while its last run still goes", async () => {
  const clock = handClock();
  const kids = children();
  const host = new Supervisor({ clock, start: kids.start(clock), log: () => {} });
  host.set([{ id: "voice/commit", run: { every: "15m" } }]);
  assert.equal(kids.started.length, 1);
  kids.started[0]!.end(0);
  await clock.move(0);
  assert.equal(host.states()[0]!.state, "waiting");
  assert.equal(host.states()[0]!.nextAt, 900_000);
  await clock.move(900_000 - 1);
  assert.equal(kids.started.length, 1, "not before its cadence");
  await clock.move(1);
  assert.equal(kids.started.length, 2, "started on its cadence");
  await clock.move(900_000 * 3);
  assert.equal(kids.started.length, 2, "never while its last run still goes");
  kids.started[1]!.end(1);
  await clock.move(0);
  assert.equal(kids.started.length, 2, "an ended run waits for its next turn");
  await clock.move(900_000);
  assert.equal(kids.started.length, 3);
  assert.notEqual(host.states()[0]!.state, "failed");
});

test("1.4 · stopping the host sends each running service the stop signal, and kills one still running 30 seconds later", async () => {
  const clock = handClock();
  const kids = children();
  kids.hold();
  const host = new Supervisor({ clock, start: kids.start(clock), log: () => {} });
  host.set([{ id: "voice/listen", run: "always" }, { id: "voice/commit", run: { every: "15m" } }]);
  let stopped = false;
  const stopping = host.stop().then(() => { stopped = true; });
  await clock.move(0);
  assert.deepEqual(kids.started.map((one) => one.signals), [["SIGTERM"], ["SIGTERM"]]);
  kids.started[1]!.end(0);
  await clock.move(30_000 - 1);
  assert.equal(stopped, false);
  assert.deepEqual(kids.started.map((one) => one.signals), [["SIGTERM"], ["SIGTERM"]], "no kill before 30 seconds");
  await clock.move(1);
  assert.deepEqual(kids.started.map((one) => one.signals), [["SIGTERM", "SIGKILL"], ["SIGTERM"]], "the one still running is killed; the one that ended is left");
  await stopping;
  await clock.move(3_600_000);
  assert.equal(kids.started.length, 2, "a stopped host starts nothing again");
});
