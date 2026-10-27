/** Capability 4 · Keeping the factory current, contracts 4.1, 4.3 and 4.4: the host pulling a throwaway factory repository on its cadence, with real children. */
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { PLUGIN_INTERFACE } from "@storytree/plugin-loader";
import { setFactory, setPartOff, setServiceOn } from "@storytree/project-and-caller";
import { removeTemp, waitUntil } from "@storytree/test-waits";

import { PULL_MS, RESTART, startHost } from "../running/host.js";
import { handClock } from "../testing/clock.js";
import { fixtureHome } from "../testing/fixture.js";
import { factoryRepo } from "../testing/factory-repo.js";

/** A plugin standing in for a part, declaring one always service, `listen`, at the export `exported` of services.js. */
const plugin = (name: string, exported: string, body: string): Record<string, string> => ({
  [`plugins/${name}/package.json`]: JSON.stringify({
    name, type: "module", exports: { "./services": "./services.js" },
    storytree: { interface: PLUGIN_INTERFACE, services: [{ name: "listen", from: "./services", export: exported, run: "always" }] },
  }),
  [`plugins/${name}/services.js`]: `export const ${exported} = { async start(host) { ${body} } };\n`,
});

const listening = (said: string) => `host.log("${said} as pid " + process.pid); await new Promise((stopped) => host.stopping.addEventListener("abort", stopped));`;

test("4.3 · after the factory moves, the host restarts only the services whose plugin the move changed, on their declarations read fresh from the new code, a failed one's ends cleared; a failed install restarts nothing and keeps every service on its code (4.1)", async (t) => {
  const home = realpathSync(mkdtempSync(path.join(tmpdir(), "storytree-service-host-keep-")));
  t.after(() => removeTemp(home));
  const repo = factoryRepo(t, { ...plugin("my-voice", "listen", "throw new Error('not built yet');"), ...plugin("my-echo", "listen", listening("echo listening")) }, home);
  setFactory(repo.clone, home);
  setPartOff("voice", true, home, "my-voice");
  setPartOff("echo", true, home, "my-echo");
  setServiceOn("voice/listen", true, home);
  setServiceOn("echo/listen", true, home);

  const clock = handClock();
  const lines: string[] = [];
  const installs: string[] = [];
  let installFails = false;
  const host = startHost({ home, clock, log: (line) => lines.push(line), install: async (folder) => { installs.push(folder); if (installFails) throw new Error("no such package"); } });
  const state = (id: string) => host.supervisor.states().find((one) => one.id === id)!;
  try {
    await waitUntil(() => lines.some((line) => line.startsWith("echo/listen: echo listening")), 20_000, "the echo listener's first line");
    const echo = state("echo/listen").pid;
    // voice/listen throws as it starts: five ends within 10 minutes mark it failed.
    for (;;) {
      const now = await waitUntil(() => { const one = state("voice/listen"); return one.state === "running" ? undefined : one; }, 20_000, "voice/listen to end");
      if (now.state === "failed") break;
      await clock.move(now.nextAt! - clock.now());
    }

    // The fix renames its export, so a declaration read from the cached module would find no service there.
    repo.push(plugin("my-voice", "listen2", listening("voice listening")), "voice is built");
    await clock.move(PULL_MS);
    const first = await waitUntil(() => lines.find((line) => line.startsWith("voice/listen: voice listening")), 20_000, "voice/listen on its new code");
    assert.match(lines.join("\n"), /^service host: the factory moved from [0-9a-f]{12} to [0-9a-f]{12}; its plugins moved: my-voice$/m);
    assert.ok(lines.includes("voice/listen: its code moved; starting it on the new code"), "the failed service is started again, its ends cleared");
    assert.equal(state("echo/listen").pid, echo, "a service whose plugin did not move keeps running");
    assert.deepEqual(installs, [], "no install without a lockfile change");

    repo.push({ ...plugin("my-voice", "listen2", listening("voice listening again")), "pnpm-lock.yaml": "lockfileVersion: '9.0'\n# voice\n" }, "voice again");
    await clock.move(PULL_MS);
    const again = await waitUntil(() => lines.find((line) => line.startsWith("voice/listen: voice listening again")), 20_000, "voice/listen restarted on its newer code");
    assert.notEqual(again.replace(/^.* as pid /, ""), first.replace(/^.* as pid /, ""), "a running service that moved runs in a new child");
    assert.equal(state("echo/listen").pid, echo, "and the one that did not move is left alone");
    assert.deepEqual(installs, [repo.clone], "a lockfile change reinstalls the clone");

    installFails = true;
    const voice = state("voice/listen").pid;
    repo.push({ ...plugin("my-echo", "listen", listening("echo moved")), "pnpm-lock.yaml": "lockfileVersion: '9.0'\n# broken\n" }, "echo moves, its install breaks");
    await clock.move(PULL_MS);
    await waitUntil(() => lines.find((line) => /^service host: the factory was not updated: the install for [0-9a-f]{12} failed, so the factory is back at [0-9a-f]{12}: no such package$/.test(line)), 20_000, "the failed install said");
    assert.equal(state("echo/listen").pid, echo, "a failed install restarts nothing");
    assert.equal(state("voice/listen").pid, voice);
    assert.ok(!lines.some((line) => line.startsWith("echo/listen: echo moved")));
  } finally {
    await host.stop();
  }
});

test("4.4 · once the host's own code moves, the host stops every service, then exits with code 3", async (t) => {
  const { home } = fixtureHome(t);
  setServiceOn("voice/listen", true, home);
  let version = "before";
  const exits: number[] = [];
  const clock = handClock();
  const lines: string[] = [];
  const host = startHost({ home, clock, log: (line) => lines.push(line), ownCode: () => version, exit: (code) => { exits.push(code); } });
  try {
    await waitUntil(() => lines.some((line) => line.startsWith("voice/listen: listening in ")), 20_000, "the listener's first line");
    await clock.move(PULL_MS);
    await waitUntil(() => lines.some((line) => line.startsWith("service host: the factory was not updated")), 20_000, "a pull turn");
    assert.deepEqual(exits, [], "the host keeps running while its code has not moved");

    version = "after";
    await clock.move(PULL_MS);
    await waitUntil(() => exits.length > 0, 20_000, "the host to exit");
    assert.deepEqual(exits, [RESTART]);
    assert.equal(RESTART, 3);
    assert.ok(lines.includes("voice/listen: stopped"), "every service was stopped before it exited");
    assert.ok(lines.includes("service host: its own code moved (before to after); stopping every service and exiting 3, to start again on the new code"));
  } finally {
    await host.stop();
  }
});
