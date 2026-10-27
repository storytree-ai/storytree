/**
 * Capability 2 · Listing and restarting services (ADR-1180 D4). The `services` verbs, declared here (ADR-0969 D2) and
 * named under `verbs` in the package's manifest (ADR-1033), so the command line mounts them as its `services` family:
 * `storytree services` lists every service the parts mounted here declare, on or off, and how each the host runs
 * stands, with the factory commit it last ran; `services restart <part>/<service>` asks the host to start one again;
 * `services run` runs the host in the foreground until it is stopped. Each is callerless: none needs a project. None
 * is a tool: they are this machine's, read and run from its terminal.
 */
import { verb, VerbRefusal, type VerbFamily } from "@storytree/library/verbs";
import type { ServiceRun } from "@storytree/plugin-loader";

import type { Mounted } from "../running/declared.js";
import type { Status } from "./status.js";

const runSaid = (run: ServiceRun): string => (run === "always" ? "always" : `every ${run.every}`);

/**
 * Every service `mounted` declares, as the status `status` the host last wrote says it stands: off, on and running, waiting
 * or failed with its last lines, or on with no host running; and the factory commit the host last ran.
 */
export function servicesSaid(mounted: Mounted, status: Status | undefined, alive: (pid: number) => boolean): string {
  const running = status !== undefined && status.stopped !== true && alive(status.pid) ? status : undefined;
  const head = "Services on this computer (turn one on or off with `storytree settings set service <part>/<service> on|off`):";
  const lines = mounted.services.length === 0
    ? ["  No mounted part declares a service."]
    : [...mounted.services].sort((a, b) => a.id.localeCompare(b.id)).flatMap((service) => {
      const name = `  ${service.id} (${runSaid(service.run)})`;
      if (!service.on) return [`${name}: off`];
      if (running === undefined) return [`${name}: on, but no service host runs here`];
      const stands = running.services.find((one) => one.id === service.id);
      if (stands === undefined) return [`${name}: on; the host starts it within seconds`];
      const exit = stands.lastExit === undefined ? "" : ` (${stands.lastExit.signal === null ? `exit ${stands.lastExit.code}` : `signal ${stands.lastExit.signal}`})`;
      if (stands.state === "running") return [`${name}: running${stands.pid === undefined ? "" : `, process ${stands.pid}`}, since ${stands.since}`];
      if (stands.state === "waiting") return [`${name}: waiting${exit}${stands.nextAt === undefined ? "" : `, next start at ${stands.nextAt}`}`];
      return [
        `${name}: failed${exit} since ${stands.since}; it starts again when its code moves, or with \`storytree services restart ${service.id}\`. Its last lines:`,
        ...stands.lastLines.map((line) => `      ${line}`),
      ];
    });
  const off = mounted.off.filter((part) => part.failed !== undefined).map((part) => `  ${part.part} hosts no services: ${part.failed}`);
  const host = running === undefined
    ? "No service host is running on this computer: start one with `storytree services run`."
    : `The service host (process ${running.pid}, since ${running.startedAt}) last ran the factory ${running.factory.folder}${running.factory.commit === undefined ? ", which is not a git checkout" : ` at commit ${running.factory.commit}`}.`;
  return [head, ...lines, ...off, host].join("\n");
}

const list = verb({
  consumers: ["user"],
  command: { family: "services", name: "services", summary: "list every service the mounted parts declare: off, running, waiting or failed with its last lines, and the factory commit the host last ran" },
  tool: { absent: "a machine's services are read from its terminal" },
  inputs: {},
  callerless: true,
  async act() {
    const { storytreeHome } = await import("@storytree/project-and-caller");
    const { HOST_DIR } = await import("../running/host.js");
    const { mountedServices } = await import("../running/declared.js");
    const { alive, readStatus } = await import("./status.js");
    const home = storytreeHome();
    return { text: servicesSaid(mountedServices(HOST_DIR, home), readStatus(home), alive) };
  },
});

const restart = verb({
  consumers: ["user"],
  command: { family: "services", name: "restart", summary: "have the service host start a service again, a failed one included, its ends and back-off cleared", usage: "services restart <part>/<service>" },
  tool: { absent: "a machine's services are restarted from its terminal" },
  inputs: { service: { kind: "text", word: 0, describe: "the service, as <part>/<service>" } },
  callerless: true,
  async act({ service }) {
    const { readServicesOn, storytreeHome } = await import("@storytree/project-and-caller");
    const { HOST_DIR } = await import("../running/host.js");
    const { mountedServices } = await import("../running/declared.js");
    const { alive, readStatus, requestRestart } = await import("./status.js");
    const home = storytreeHome();
    const declared = mountedServices(HOST_DIR, home).services.map((one) => one.id);
    if (!declared.includes(service)) throw new VerbRefusal(`no mounted part declares a service called ${service}${declared.length === 0 ? "" : `. Services: ${declared.join(", ")}`}.`);
    if (!readServicesOn(home).includes(service)) throw new VerbRefusal(`${service} is off on this computer; turn it on with \`storytree settings set service ${service} on\`.`);
    const status = readStatus(home);
    if (status === undefined || status.stopped === true || !alive(status.pid)) throw new VerbRefusal("no service host is running on this computer: start one with `storytree services run`.");
    requestRestart(home, service);
    return { text: `Asked the service host to start ${service} again; it takes it within seconds.`, next: [{ command: "services", why: "see how it stands" }] };
  },
});

const run = verb({
  consumers: ["user"],
  command: { family: "services", name: "run", summary: "run the service host in the foreground until it is stopped (Ctrl-C, or a stop signal)" },
  tool: { absent: "the service host is a machine's long-running process, started from its terminal" },
  inputs: {},
  callerless: true,
  async act() {
    const { startHost } = await import("../running/host.js");
    const host = startHost();
    await new Promise<void>((stopped) => {
      process.once("SIGTERM", () => stopped());
      process.once("SIGINT", () => stopped());
    });
    await host.stop();
    return { text: "The service host stopped, and every service it ran with it." };
  },
});

/** The command line's `services` family, beside `processes` among `storytree`'s families. */
export const SERVICES_FAMILIES: readonly VerbFamily[] = [
  { name: "services", summary: "the services the mounted parts declare: list them, restart one, or run the host", order: 24.2, bare: list, verbs: [restart, run] },
];
