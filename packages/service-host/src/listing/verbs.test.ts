/** Capability 2 · Listing and restarting services, contracts 2.1 and 2.2: `storytree services` and `services restart`, against a host run in a throwaway home. */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import type { DoorWords, Verb, VerbInputs, VerbPlace } from "@storytree/library/verbs";
import { setServiceOn } from "@storytree/project-and-caller";
import { waitUntil } from "@storytree/test-waits";

import { HOST_DIR, startHost } from "../running/host.js";
import { mountedServices } from "../running/declared.js";
import type { Child, Clock, Ended } from "../running/supervise.js";
import { fixtureHome } from "../testing/fixture.js";
import { servicesSaid, SERVICES_FAMILIES } from "./verbs.js";

const words: DoorWords = { door: "command", say: (step) => step.command ?? step.tool! };
const family = SERVICES_FAMILIES[0]!;
const list = family.bare as Verb<VerbInputs, VerbPlace>;
const restart = family.verbs.find((one) => "name" in one.command && one.command.name === "restart") as Verb<VerbInputs, VerbPlace>;

/** A clock running ten thousand times fast past a second, so the back-off's seconds and minutes pass in milliseconds. */
const fast: Clock = {
  now: () => Date.now(),
  after(ms, fire) {
    const timer = setTimeout(fire, ms < 1000 ? ms : ms / 10_000);
    return () => clearTimeout(timer);
  },
};

/** Stand-in children: voice/listen fails at once saying why, every other one runs until it is signalled. */
function children() {
  const starts: string[] = [];
  const start = ({ id }: { id: string }): Child => {
    starts.push(id);
    let finish!: (ended: Ended) => void;
    const ended = new Promise<Ended>((done) => { finish = done; });
    if (id === "voice/listen") setImmediate(() => finish({ code: 1, signal: null }));
    return { pid: 4242, ended, signal: (name) => finish({ code: null, signal: name }), lastLines: () => [`${id}: no microphone`] };
  };
  return { starts, start };
}

/** Run `body` with STORYTREE_HOME set to `home`, as the command line's verbs read it. */
function homeIs(t: TestContext, home: string): void {
  const was = process.env.STORYTREE_HOME;
  process.env.STORYTREE_HOME = home;
  t.after(() => { if (was === undefined) delete process.env.STORYTREE_HOME; else process.env.STORYTREE_HOME = was; });
}

test("2.1 · storytree services lists every declared service on this machine: off, running, failed with its last lines, or waiting, and the factory commit the host last ran; with no host running it says so", async (t) => {
  const { home } = fixtureHome(t);
  homeIs(t, home);
  setServiceOn("voice/listen", true, home);
  setServiceOn("voice/commit", true, home);

  const before = (await list.act({}, { folder: home }, words)).text;
  assert.match(before, /^  voice\/idle \(always\): off$/m);
  assert.match(before, /^  voice\/listen \(always\): on, but no service host runs here$/m);
  assert.match(before, /^No service host is running on this computer: start one with `storytree services run`\.$/m);

  const kids = children();
  const host = startHost({ home, clock: fast, tickMs: 20, log: () => {}, start: (service) => kids.start(service) });
  try {
    const failed = await waitUntil(async () => {
      const text = (await list.act({}, { folder: home }, words)).text;
      return /voice\/listen \(always\): failed/.test(text) ? text : undefined;
    }, 20_000, "the listener listed as failed");
    assert.match(failed, /^  voice\/listen \(always\): failed \(exit 1\) since [^;]+; it starts again when its code moves, or with `storytree services restart voice\/listen`\. Its last lines:\n      voice\/listen: no microphone$/m);
    assert.match(failed, /^  voice\/commit \(every 15m\): running, process 4242, since \S+$/m);
    assert.match(failed, /^  voice\/idle \(always\): off$/m);
    assert.match(failed, new RegExp(`^The service host \\(process ${process.pid}, since \\S+\\) last ran the factory ${home.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&")}/factory, which is not a git checkout\\.$`, "m"));
  } finally {
    await host.stop();
  }
  assert.match((await list.act({}, { folder: home }, words)).text, /^No service host is running on this computer/m, "a stopped host is said so");

  const waiting = servicesSaid(mountedServices(HOST_DIR, home), {
    pid: 7, startedAt: "2026-10-27T00:00:00.000Z", updatedAt: "2026-10-27T00:01:00.000Z", factory: { folder: "/f", commit: "0123abcd" },
    services: [{ id: "voice/listen", run: "always", state: "waiting", since: "2026-10-27T00:00:30.000Z", nextAt: "2026-10-27T00:00:40.000Z", lastExit: { code: 1, signal: null }, lastLines: [] }],
  }, () => true);
  assert.match(waiting, /^  voice\/listen \(always\): waiting \(exit 1\), next start at 2026-10-27T00:00:40\.000Z$/m);
  assert.match(waiting, /^The service host \(process 7, since 2026-10-27T00:00:00\.000Z\) last ran the factory \/f at commit 0123abcd\.$/m);
});

test("2.2 · storytree services restart <part>/<service> has the host start a failed service again, its ends and back-off cleared", async (t) => {
  const { home } = fixtureHome(t);
  homeIs(t, home);
  setServiceOn("voice/listen", true, home);
  await assert.rejects(restart.act({ service: "voice/listen" }, { folder: home }, words), /no service host is running/);

  const kids = children();
  const host = startHost({ home, clock: fast, tickMs: 20, log: () => {}, start: (service) => kids.start(service) });
  try {
    await waitUntil(() => host.supervisor.states()[0]?.state === "failed", 20_000, "the listener failed");
    const listens = () => kids.starts.filter((id) => id === "voice/listen").length;
    assert.equal(listens(), 5, "five ends within 10 minutes, and it is not started again");
    await assert.rejects(restart.act({ service: "voice/nothing" }, { folder: home }, words), /no mounted part declares a service called voice\/nothing/);
    await assert.rejects(restart.act({ service: "voice/idle" }, { folder: home }, words), /voice\/idle is off on this computer/);
    assert.match((await restart.act({ service: "voice/listen" }, { folder: home }, words)).text, /^Asked the service host to start voice\/listen again/);
    await waitUntil(() => listens() === 10 && host.supervisor.states()[0]?.state === "failed", 20_000, "the listener started again, failing five more times before it is failed again");
  } finally {
    await host.stop();
  }
});
