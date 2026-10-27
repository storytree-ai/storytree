/**
 * Capability 1 · Running services. The service host's tests' fixture: a throwaway storytree home whose factory holds a
 * plugin, my-voice, standing in for the part voice (which has left the base), declaring three services: listen, which
 * runs until its stop signal, commit, every 15 minutes, and idle, which no test turns on.
 */
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";

import { PLUGIN_INTERFACE } from "@storytree/plugin-loader";
import { setFactory, setPartOff } from "@storytree/project-and-caller";
import { removeTemp } from "@storytree/test-waits";

const SERVICES = `
export const listen = { async start(host) {
  host.log("listening in " + host.folder + " as pid " + process.pid);
  await new Promise((stopped) => host.stopping.addEventListener("abort", stopped));
  host.log("stopped");
} };
export const commit = { start(host) { host.log("committed"); } };
export const idle = { start(host) { host.log("idle ran"); } };
`;

/** A storytree home whose factory holds the plugin my-voice, standing in for the part voice, which has left the base. */
export function fixtureHome(t: TestContext): { home: string; plugin: string } {
  const home = realpathSync(mkdtempSync(path.join(tmpdir(), "storytree-service-host-")));
  t.after(() => removeTemp(home));
  const factory = path.join(home, "factory");
  mkdirSync(factory);
  setFactory(factory, home);
  const plugin = path.join(factory, "plugins", "my-voice");
  mkdirSync(plugin, { recursive: true });
  writeFileSync(path.join(plugin, "package.json"), JSON.stringify({
    name: "my-voice",
    type: "module",
    exports: { "./services": "./services.js" },
    storytree: {
      interface: PLUGIN_INTERFACE,
      services: [
        { name: "listen", from: "./services", export: "listen", run: "always" },
        { name: "commit", from: "./services", export: "commit", run: { every: "15m" } },
        { name: "idle", from: "./services", export: "idle", run: "always" },
      ],
    },
  }));
  writeFileSync(path.join(plugin, "services.js"), SERVICES);
  setPartOff("voice", true, home, "my-voice");
  return { home, plugin };
}

