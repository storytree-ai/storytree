// Capability 6 · Tool server (the MCP server)
import { CONNECT_TIMEOUT_MS, connect, explainConnectTimeout, type ConnectOptions, type Library, type PluginRecordKind, type Storytree } from "@storytree/library";

import { openNamedProject, readSystemSwitches, requireApproval } from "@storytree/project-and-caller";

import { currentBranch, openActivityLog, thisMachine, type ActivityLog } from "@storytree/session-management";

export interface Reached {
  readonly library: Library;
  readonly log: ActivityLog;
  readonly storytree: Storytree;
}

export class Connections {
  #where: string | undefined;
  #storytree: Promise<Storytree> | undefined;
  #log: Promise<ActivityLog> | undefined;
  readonly #libraries = new Map<string, Promise<Library>>();
  readonly #approved = new Set<string>();
  readonly #kinds: readonly PluginRecordKind[];

  constructor(kinds: readonly PluginRecordKind[] = []) {
    this.#kinds = kinds;
  }

  async server(library: ConnectOptions): Promise<Storytree> {
    const where = JSON.stringify(library);
    if (this.#where !== where) {
      await this.close();
      this.#where = where;
    }
    return (this.#storytree ??= forgetOnFailure(connect(library), () => (this.#storytree = undefined)));
  }

  async reach(library: ConnectOptions, project: string, identity: string | undefined, checkout: { folder: string; home: string }): Promise<Reached> {
    const storytree = await this.server(library);
    const asked = JSON.stringify([project, checkout.folder, checkout.home]);
    if (!this.#approved.has(asked)) {
      await requireApproval(storytree, project, checkout.folder, checkout.home);
      this.#approved.add(asked);
    }
    const machine = thisMachine();
    const opened = () => openActivityLog(storytree, { connectTimeoutMs: CONNECT_TIMEOUT_MS, branchOf: currentBranch, home: checkout.home, ...(machine === undefined ? {} : { machine }) });
    const log = (this.#log ??= forgetOnFailure(opened(), () => (this.#log = undefined)));
    let opening = this.#libraries.get(project);
    if (opening === undefined) {
      opening = forgetOnFailure(openNamedProject(storytree, project, identity, { system: readSystemSwitches(checkout.home), kinds: this.#kinds }), () => this.#libraries.delete(project));
      this.#libraries.set(project, opening);
    }
    try {
      const [openedLibrary, openedLog] = await Promise.all([opening, log]);
      return { library: openedLibrary, log: openedLog, storytree };
    } catch (error) {
      await Promise.allSettled([opening, log]);
      throw explainConnectTimeout(error, CONNECT_TIMEOUT_MS);
    }
  }

  async close(): Promise<void> {
    const storytree = this.#storytree;
    const log = this.#log;
    this.#storytree = undefined;
    this.#log = undefined;
    this.#libraries.clear();
    this.#approved.clear();
    this.#where = undefined;
    await Promise.allSettled([log?.then((opened) => opened.close())]);
    await Promise.allSettled([storytree?.then((server) => server.close())]);
  }
}

function forgetOnFailure<T>(promise: Promise<T>, forget: () => void): Promise<T> {
  promise.catch(forget);
  return promise;
}
