/** Capability 2 · Listing and restarting services, contracts 2.1 to 2.3: `storytree services`, `services restart` and `services run`, against a host run in a throwaway home. */
import assert from "node:assert/strict";
import path from "node:path";
import { test, type TestContext } from "node:test";

import type { DoorWords, Verb, VerbInputs, VerbPlace } from "@storytree/library/verbs";
import { setPartOff, setServiceOn } from "@storytree/project-and-caller";
import { waitUntil } from "@storytree/test-waits";

import { HOST_DIR, startHost } from "../running/host.js";
import { mountedServices } from "../running/declared.js";
import type { Child, Ended } from "../running/supervise.js";
import { handClock } from "../testing/clock.js";
import { fixtureHome } from "../testing/fixture.js";
import { readStatus, requestStop } from "./status.js";
import { servicesSaid, SERVICES_FAMILIES } from "./verbs.js";

const words: DoorWords = { door: "command", say: (step) => step.command ?? step.tool! };
const family = SERVICES_FAMILIES[0]!;
const list = family.bare as Verb<VerbInputs, VerbPlace>;
const named = (name: string) => family.verbs.find((one) => "name" in one.command && one.command.name === name) as Verb<VerbInputs, VerbPlace>;

/** Stand-in children: voice/listen fails at once saying why, every other one runs until it is signalled. */
function children() {
  const starts: string[] = [];
  const start = ({ id }: { id: string }): Child => {
    starts.push(id);
    let finish!: (ended: Ended) => void;
    const ended = new Promise<Ended>((done) => { finish = done; });
    if (id === "voice/listen") finish({ code: 1, signal: null });
    return { pid: 4242, ended, signal: (name) => finish({ code: null, signal: name }), lastLines: () => [`${id}: no microphone`] };
  };
  return { starts, start };
}

/** STORYTREE_HOME set to `home` for the test, as the command line's verbs read it. */
function homeIs(t: TestContext, home: string): void {
  const was = process.env.STORYTREE_HOME;
  process.env.STORYTREE_HOME = home;
  t.after(() => { if (was === undefined) delete process.env.STORYTREE_HOME; else process.env.STORYTREE_HOME = was; });
}

const escaped = (text: string) => text.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");

test("2.1 · storytree services lists every declared service on this machine: off, running, failed with its last lines, or waiting, and the factory commit the host last ran; with no host running it says so", async (t) => {
  const { home } = fixtureHome(t);
  homeIs(t, home);
  setServiceOn("voice/listen", true, home);
  setServiceOn("voice/commit", true, home);

  const before = (await list.act({}, { folder: home }, words)).text;
  assert.match(before, /^  voice\/idle \(always\): off$/m);
  assert.match(before, /^  voice\/listen \(always\): on, but no service host runs here$/m);
  assert.match(before, /^No service host is running on this computer: start one with `storytree services run`\.$/m);

  const clock = handClock();
  const kids = children();
  const host = startHost({ home, clock, log: () => {}, start: (service) => kids.start(service) });
  try {
    await clock.move(15_000);
    assert.match((await list.act({}, { folder: home }, words)).text, /^  voice\/listen \(always\): waiting \(exit 1\), next start at \S+$/m);
    await clock.move(10 * 60_000);
    const listed = (await list.act({}, { folder: home }, words)).text;
    assert.match(listed, /^  voice\/listen \(always\): failed \(exit 1\) since [^;]+; it stays failed until `storytree services restart voice\/listen`\. Its last lines:\n      voice\/listen: no microphone$/m);
    assert.match(listed, /^  voice\/commit \(every 15m\): running, process 4242, since \S+$/m);
    assert.match(listed, /^  voice\/idle \(always\): off$/m);
    assert.match(listed, new RegExp(`^The service host \\(process ${process.pid}, since \\S+\\) last ran the factory ${escaped(path.join(home, "factory"))}, which is not a git checkout\\.$`, "m"));
  } finally {
    await host.stop();
  }
  assert.match((await list.act({}, { folder: home }, words)).text, /^No service host is running on this computer/m, "a stopped host is said so");

  const committed = servicesSaid(mountedServices(HOST_DIR, home), {
    pid: 7, startedAt: "2026-10-27T00:00:00.000Z", updatedAt: "2026-10-27T00:01:00.000Z", factory: { folder: "/f", commit: "0123abcd" }, services: [],
  }, () => true);
  assert.match(committed, /^  voice\/listen \(always\): on; the host starts it within seconds$/m);
  assert.match(committed, /^The service host \(process 7, since 2026-10-27T00:00:00\.000Z\) last ran the factory \/f at commit 0123abcd\.$/m);
});

test("2.2 · storytree services restart <part>/<service> has the host start a failed service again, its ends and back-off cleared", async (t) => {
  const { home } = fixtureHome(t);
  homeIs(t, home);
  setServiceOn("voice/listen", true, home);
  const restart = named("restart");
  await assert.rejects(restart.act({ service: "voice/listen" }, { folder: home }, words), /no service host is running/);

  const clock = handClock();
  const kids = children();
  const lines: string[] = [];
  const host = startHost({ home, clock, log: (line) => lines.push(line), start: (service) => kids.start(service) });
  try {
    const listens = () => kids.starts.filter((id) => id === "voice/listen").length;
    await clock.move(10 * 60_000);
    assert.equal(host.supervisor.states()[0]!.state, "failed");
    assert.equal(listens(), 5, "five ends within 10 minutes, and it is not started again");
    await assert.rejects(restart.act({ service: "voice/nothing" }, { folder: home }, words), /no mounted part declares a service called voice\/nothing/);
    await assert.rejects(restart.act({ service: "voice/idle" }, { folder: home }, words), /voice\/idle is off on this computer/);
    assert.match((await restart.act({ service: "voice/listen" }, { folder: home }, words)).text, /^Asked the service host to start voice\/listen again/);
    await clock.move(2_000);
    assert.equal(listens(), 6, "the host takes the restart on its next tick, and starts it at once");
    await clock.move(10_000 - 1);
    assert.equal(listens(), 6, "its back-off starts again at 10 seconds");
    await clock.move(1);
    assert.equal(listens(), 7);
    await clock.move(10 * 60_000);
    assert.equal(listens(), 10, "its ends were cleared: five more before it is failed again");
    assert.equal(host.supervisor.states()[0]!.state, "failed");
    assert.equal(readStatus(home)!.services.find((one) => one.id === "voice/listen")!.state, "failed");

    assert.equal(host.supervisor.restart("voice/nothing"), false, "the host restarts only a service it runs");
  } finally {
    await host.stop();
  }
});

test("2.3 · storytree services run runs the service host in the foreground until a stop signal (Ctrl-C or SIGTERM) or a stop request (on Windows, where no signal is heard), then stops every service it ran and says so", async (t) => {
  const { home } = fixtureHome(t);
  homeIs(t, home);
  setServiceOn("voice/listen", true, home);
  requestStop(home);
  for (const signal of ["SIGINT", "SIGTERM", "request"] as const) {
    const running = named("run").act({}, { folder: home }, words);
    const pid = await waitUntil(() => readStatus(home)?.services.find((one) => one.id === "voice/listen" && one.state === "running" && one.lastLines.some((line) => line.startsWith("listening in ")))?.pid, 20_000, `the listener listening under services run, to stop with ${signal}`);
    if (signal === "request") requestStop(home);
    else process.emit(signal, signal);
    assert.match((await running).text, /^The service host stopped, and every service it ran with it\.$/);
    const stopped = readStatus(home)!;
    assert.equal(stopped.stopped, true);
    assert.deepEqual(stopped.services.map(({ id, state, lastExit }) => ({ id, state, lastExit })), [{ id: "voice/listen", state: "waiting", lastExit: { code: 0, signal: null } }], `the listener ended at its stop signal (process ${pid})`);
  }
});

test("2.4 · storytree services says when a part switch has not taken in the running host: a service turned on that the host did not mount at its start, or one it still runs whose part is now off, takes at the host's next start, and it names the restart", async (t) => {
  const { home } = fixtureHome(t);
  homeIs(t, home);
  setServiceOn("voice/listen", true, home);
  setPartOff("voice", false, home);
  const restart = /restart the service host: `systemctl --user restart storytree-host` where `storytree services install` keeps it, or stop `storytree services run` and run it again/;

  const clock = handClock();
  const kids = children();
  const first = startHost({ home, clock, log: () => {}, start: (service) => kids.start(service) });
  try {
    await clock.move(2_000);
    setPartOff("voice", true, home, "my-voice");
    await clock.move(2_000);
    const listed = (await list.act({}, { folder: home }, words)).text;
    assert.match(listed, /^  voice\/listen \(always\): on, but its part was switched after the service host started, so it starts at the host's next start; /m);
    assert.match(listed, restart);
    assert.doesNotMatch(listed, /within seconds/);
    assert.equal(kids.starts.length, 0, "the running host does not take the part switch");
  } finally {
    await first.stop();
  }

  setServiceOn("voice/commit", true, home);
  const second = startHost({ home, clock, log: () => {}, start: (service) => kids.start(service) });
  try {
    await clock.move(2_000);
    assert.ok(kids.starts.includes("voice/commit"), "a host started after the switch mounts the switched services");
    setPartOff("voice", false, home);
    await clock.move(2_000);
    const listed = (await list.act({}, { folder: home }, words)).text;
    assert.match(listed, /^  voice\/commit: still run by the service host, though its part was switched off after the host started; it stops at the host's next start; /m);
    assert.match(listed, restart);
  } finally {
    await second.stop();
  }
});
