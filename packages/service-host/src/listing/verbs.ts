/**
 * Capability 2 · Listing and restarting services (ADR-1180 D4). The `services` verbs, declared here (ADR-0969 D2) and
 * named under `verbs` in the package's manifest (ADR-1033), so the command line mounts them as its `services` family:
 * `storytree services` lists every service the parts mounted here declare, on or off, and how each the host runs
 * stands, with the factory commit it last ran, and says when a part switch has not taken in the running host; `services restart <part>/<service>` asks the host to start one again;
 * `services run` runs the host in the foreground until it is stopped; `services install` and `services uninstall` write and
 * remove the entry point that keeps it running: a systemd user unit on Linux, a scheduled task on Windows (capability 3, ADR-1180 D5). Each is callerless: none needs a project. None
 * is a tool: they are this machine's, read and run from its terminal.
 */
import { verb, VerbRefusal, type VerbFamily } from "@storytree/library/verbs";
import type { Service } from "../running/supervise.js";

import type { Mounted } from "../running/declared.js";
import type { Status } from "./status.js";

const runSaid = (run: Service["run"]): string => (run === "always" ? "always" : `every ${run.every}`);

/** How a part switch the running host has not taken is taken: it mounts the parts' services only as it starts (contract 1.1). */
const RESTART_HOST = "restart the service host: `systemctl --user restart storytree-host` where `storytree services install` keeps it, or stop `storytree services run` and run it again";

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
      if (stands === undefined) {
        if (running.declared !== undefined && !running.declared.includes(service.id)) return [`${name}: on, but its part was switched after the service host started, so it starts at the host's next start; ${RESTART_HOST}`];
        return [`${name}: on; the host starts it within seconds`];
      }
      const exit = stands.lastExit === undefined ? "" : ` (${stands.lastExit.signal === null ? `exit ${stands.lastExit.code}` : `signal ${stands.lastExit.signal}`})`;
      if (stands.state === "running") return [`${name}: running${stands.pid === undefined ? "" : `, process ${stands.pid}`}, since ${stands.since}`];
      if (stands.state === "waiting") return [`${name}: waiting${exit}${stands.nextAt === undefined ? "" : `, next start at ${stands.nextAt}`}`];
      return [
        `${name}: failed${exit} since ${stands.since}; it stays failed until \`storytree services restart ${service.id}\`. Its last lines:`,
        ...stands.lastLines.map((line) => `      ${line}`),
      ];
    });
  const ids = new Set(mounted.services.map((service) => service.id));
  const unmounted = running === undefined ? [] : running.services.filter((one) => !ids.has(one.id)).map((one) => one.id).sort()
    .map((id) => `  ${id}: still run by the service host, though its part was switched off after the host started; it stops at the host's next start; ${RESTART_HOST}`);
  const off = mounted.off.filter((part) => part.failed !== undefined).map((part) => `  ${part.part} hosts no services: ${part.failed}`);
  const host = running === undefined
    ? "No service host is running on this computer: start one with `storytree services run`."
    : `The service host (process ${running.pid}, since ${running.startedAt}) last ran the factory ${running.factory.folder}${running.factory.commit === undefined ? ", which is not a git checkout" : ` at commit ${running.factory.commit}`}.`;
  return [head, ...lines, ...unmounted, ...off, host].join("\n");
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
    const { storytreeHome } = await import("@storytree/project-and-caller");
    const { startHost } = await import("../running/host.js");
    const { takeStop } = await import("./status.js");
    const home = storytreeHome();
    takeStop(home);
    const host = startHost({ home });
    let asked: NodeJS.Timeout | undefined;
    await new Promise<void>((stopped) => {
      process.once("SIGTERM", () => stopped());
      process.once("SIGINT", () => stopped());
      // On Windows no stop signal reaches the host heard: `services uninstall` and `services install` ask by file (contract 3.4).
      asked = setInterval(() => { if (takeStop(home)) stopped(); }, 1_000);
    });
    clearInterval(asked);
    await host.stop();
    return { text: "The service host stopped, and every service it ran with it." };
  },
});

/** What keeps the host running here: the systemd user unit on Linux (contracts 3.1, 3.2), the scheduled task on Windows (3.3, 3.4). */
async function entryPoint(): Promise<{ install: (checkout: string) => Promise<string>; uninstall: () => Promise<string> }> {
  if (process.platform === "linux") {
    const { installHost, uninstallHost, userSystemd } = await import("../installing/systemd.js");
    return { install: async (checkout) => installHost(checkout, userSystemd()), uninstall: async () => uninstallHost(userSystemd()) };
  }
  if (process.platform === "win32") {
    const path = await import("node:path");
    const { setTimeout } = await import("node:timers/promises");
    const { storytreeHome } = await import("@storytree/project-and-caller");
    const { alive, readStatus, requestStop } = await import("./status.js");
    const { endTree, installTask, uninstallTask, userTaskScheduler } = await import("../installing/scheduled-task.js");
    const home = storytreeHome();
    const scheduler = userTaskScheduler(path.join(home, "service-host"), {
      pid: () => { const status = readStatus(home); return status === undefined || status.stopped === true ? undefined : status.pid; },
      alive,
      requestStop: () => requestStop(home),
      wait: async (ms) => { await setTimeout(ms); },
      end: endTree,
    });
    return { install: (checkout) => installTask(checkout, scheduler), uninstall: () => uninstallTask(scheduler) };
  }
  throw new VerbRefusal(`storytree services install keeps the host running on Linux, as a systemd user unit, and on Windows, as a scheduled task; on ${process.platform}, run \`storytree services run\` yourself.`);
}

const install = verb({
  consumers: ["user"],
  command: { family: "services", name: "install", summary: "keep the service host running on this computer: a systemd user unit, storytree-host.service, on Linux; a scheduled task at logon, storytree-host, on Windows; running it again is safe" },
  tool: { absent: "a machine's entry point is installed from its terminal" },
  inputs: {},
  callerless: true,
  async act() {
    const { HOST_DIR } = await import("../running/host.js");
    const { checkoutOf } = await import("../installing/systemd.js");
    const entry = await entryPoint();
    let checkout: string;
    try {
      checkout = checkoutOf(HOST_DIR);
    } catch (error) {
      throw new VerbRefusal((error as Error).message);
    }
    return { text: await entry.install(checkout), next: [{ command: "services", why: "see the services and the host" }] };
  },
});

const uninstall = verb({
  consumers: ["user"],
  command: { family: "services", name: "uninstall", summary: "stop the service host and remove what keeps it running: its systemd user unit on Linux, its scheduled task on Windows" },
  tool: { absent: "a machine's entry point is removed from its terminal" },
  inputs: {},
  callerless: true,
  async act() {
    return { text: await (await entryPoint()).uninstall() };
  },
});

/** The command line's `services` family, beside `processes` among `storytree`'s families. */
export const SERVICES_FAMILIES: readonly VerbFamily[] = [
  { name: "services", summary: "the services the mounted parts declare: list them, restart one, run the host, or install what keeps it running", order: 24.2, bare: list, verbs: [restart, run, install, uninstall] },
];
