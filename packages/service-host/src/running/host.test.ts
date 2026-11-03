/** Capability 1 · Running services, contract 1.1: the host runs a fixture plugin's services as child processes, as this machine's settings turn them on. */
import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { PLUGIN_INTERFACE, partsGraph, switchedOff } from "@storytree/plugin-loader";
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
  assert.deepEqual(mountedServices(HOST_DIR, home).services.filter((service) => service.part === "voice"), [], "a part not mounted runs no service");

  setPartOff("voice", true, home, "no-such-plugin");
  const said: string[] = [];
  const broken = startHost({ home, log: (line) => said.push(line) });
  await broken.stop();
  assert.deepEqual(broken.supervisor.states(), [], "a stand-in whose services cannot be read runs none");
  assert.match(said.join("\n"), /^service host: voice hosts no services: its stand-in no-such-plugin's services could not be read: the factory has no plugin called no-such-plugin/m);
});

test("plugin-loader 5.19 · a factory plugin named as the part it stands in for mounts its services alone in that part's place while the part is off, and the part's own alone once it is on", (t) => {
  const { home } = fixtureHome(t);
  const services = [{ name: "listen", from: "./services", export: "listen", run: "always" }];
  const hostDir = path.join(home, "host");
  const part = path.join(hostDir, "node_modules", "@s", "voice");
  mkdirSync(part, { recursive: true });
  writeFileSync(path.join(hostDir, "package.json"), JSON.stringify({ name: "host", dependencies: { "@s/voice": "*" } }));
  writeFileSync(path.join(part, "package.json"), JSON.stringify({ name: "@s/voice", type: "module", exports: { "./services": "./services.js" }, storytree: { services } }));
  writeFileSync(path.join(part, "services.js"), "export const listen = { start() {} };\n");
  const plugin = path.join(home, "factory", "plugins", "voice");
  mkdirSync(plugin, { recursive: true });
  writeFileSync(path.join(plugin, "package.json"), JSON.stringify({ name: "voice", type: "module", exports: { "./services": "./services.js" }, storytree: { interface: PLUGIN_INTERFACE, services } }));
  writeFileSync(path.join(plugin, "services.js"), "export const listen = { start() {} };\n");

  setPartOff("voice", true, home, "voice");
  assert.deepEqual(mountedServices(hostDir, home).services.map((service) => service.from), [{ plugin: "voice", factory: path.join(home, "factory") }]);
  setPartOff("voice", false, home);
  assert.deepEqual(mountedServices(hostDir, home).services.map((service) => "module" in service.from && service.from.module), ["@s/voice/services"]);
});

test("1.5 · the host runs the agent runner's dispatcher and watcher, each run always, and switching the agent runner off takes them off without taking off the service host a host stands on", (t) => {
  const { home } = fixtureHome(t);
  const ours = (mounted: ReturnType<typeof mountedServices>) => mounted.services.filter((service) => service.part === "agent-pool").map(({ id, run, from }) => ({ id, run, from: "module" in from ? from.module : from.plugin }));
  assert.deepEqual(ours(mountedServices(HOST_DIR, home)), [
    { id: "agent-pool/dispatcher", run: "always", from: "@storytree/agent-pool/services" },
    { id: "agent-pool/watcher", run: "always", from: "@storytree/agent-pool/services" },
  ]);
  setPartOff("agent-pool", true, home);
  assert.deepEqual(ours(mountedServices(HOST_DIR, home)), []);

  // A host standing on the service host (the command line does) keeps it while the agent runner is off.
  const standing = path.join(home, "standing");
  mkdirSync(path.join(standing, "node_modules", "@storytree"), { recursive: true });
  symlinkSync(HOST_DIR, path.join(standing, "node_modules", "@storytree", "service-host"), "junction");
  writeFileSync(path.join(standing, "package.json"), JSON.stringify({ name: "standing", dependencies: { "@storytree/service-host": "*" } }));
  const graph = partsGraph(standing);
  assert.ok(Object.hasOwn(graph, "service-host"));
  assert.equal(switchedOff(graph, ["agent-pool"]).has("service-host"), false);
});
