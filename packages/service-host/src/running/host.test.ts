/** Capability 1 · Running services, contract 1.1: the host runs a fixture plugin's services as child processes, as this machine's settings turn them on. */
import assert from "node:assert/strict";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { setPartOff, setServiceOn } from "@storytree/project-and-caller";
import { waitUntil } from "@storytree/test-waits";

import { fixtureHome } from "../testing/fixture.js";

import { mountedServices } from "./declared.js";
import { HOST_DIR, startHost } from "./host.js";

test("1.1 · the host runs each declared service of each mounted part that this machine's settings turn on, each as its own child process, and writes each line it prints to the host's log after the service's name; a service not turned on, or of a part not mounted, is not started", async (t) => {
  const { home, plugin } = fixtureHome(t);
  setServiceOn("voice/listen", true, home);
  setServiceOn("voice/commit", true, home);

  const lines: string[] = [];
  const host = startHost({ home, log: (line) => lines.push(line), tickMs: 50 });
  try {
    const listening = await waitUntil(() => lines.find((line) => line.startsWith("voice/listen: listening in ")), 20_000, "the listener's first line in the host's log");
    assert.equal(listening.replace(/ as pid \d+$/, ""), `voice/listen: listening in ${plugin}`, "its line is in the host's log after its name, and it is handed its plugin's folder");
    const pid = Number(/as pid (\d+)$/.exec(listening)![1]);
    assert.notEqual(pid, process.pid, "it runs in a child process");
    await waitUntil(() => lines.includes("voice/commit: committed"), 20_000, "the committer's line in the host's log");
    const listen = host.supervisor.states().find((state) => state.id === "voice/listen")!;
    assert.equal(listen.state, "running");
    assert.equal(listen.pid, pid, "each service is its own child");
    assert.ok(!lines.some((line) => line.startsWith("voice/idle")), "a service not turned on is not started");

    setServiceOn("voice/listen", false, home);
    await waitUntil(() => lines.includes("voice/listen: stopped"), 20_000, "the listener stopped once it is turned off");
  } finally {
    await host.stop();
  }

  setPartOff("voice", false, home);
  assert.deepEqual(mountedServices(HOST_DIR, home).services, [], "a part not mounted runs no service");

  setPartOff("voice", true, home, "no-such-plugin");
  const said: string[] = [];
  const broken = startHost({ home, log: (line) => said.push(line) });
  await broken.stop();
  assert.deepEqual(broken.supervisor.states(), [], "a stand-in whose services cannot be read runs none");
  assert.match(said.join("\n"), /^service host: voice hosts no services: its stand-in no-such-plugin's services could not be read: the factory has no plugin called no-such-plugin/m);
});
