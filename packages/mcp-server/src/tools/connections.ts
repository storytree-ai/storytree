/**
 * Capability 6 · Agent tools (the MCP server). The tool server's connections to storytree: one to the library's server and one to the agent
 * activity log, both where project routing says the library is (the app's local database or a Cloud
 * SQL instance), and each project's library once opened. They are made on first use and kept, and
 * dropped when storytree moves (a new address or location) or goes away, so the next call starts
 * afresh. The log keeps its lines in the library connection's own database (ADR-0735 D3).
 */
import { connect, ConnectionError, type ConnectOptions, type Library, type Storytree } from "@storytree/library";

import { openNamedProject, requireApproval, withConnectTimeout } from "@storytree/agent-link";

import { currentBranch, openActivityLog, thisMachine, type ActivityLog } from "@storytree/agent-link";

/** How long a fresh database handshake may take before a call says storytree isn't reachable. */
const CONNECT_TIMEOUT_MS = 3_000;

export interface Reached {
  readonly library: Library;
  readonly log: ActivityLog;
  /** The connection both were opened on, which hands out a story's own database (ADR-0973). */
  readonly storytree: Storytree;
}

export class Connections {
  #where: string | undefined;
  #storytree: Promise<Storytree> | undefined;
  #log: Promise<ActivityLog> | undefined;
  readonly #libraries = new Map<string, Promise<Library>>();
  /** Each checkout found approved for its project (ADR-0942), so each is asked once while connected. */
  readonly #approved = new Set<string>();

  /** The connection to the library where `library` says: its server, where projects are opened. */
  async server(library: ConnectOptions): Promise<Storytree> {
    const where = JSON.stringify(library);
    if (this.#where !== where) {
      await this.close();
      this.#where = where;
    }
    return (this.#storytree ??= forgetOnFailure(connect(withConnectTimeout(library, CONNECT_TIMEOUT_MS)), () => (this.#storytree = undefined)));
  }

  /**
   * The library of `project` and the activity log, where `library` says, for the checkout `folder`
   * on the machine kept in `home`: refused (a ProjectFolderError) before either is opened unless the
   * checkout's trunk is approved for `project` (ADR-0942 D1).
   */
  async reach(library: ConnectOptions, project: string, identity: string | undefined, checkout: { folder: string; home: string }): Promise<Reached> {
    const storytree = await this.server(library);
    const asked = JSON.stringify([project, checkout.folder, checkout.home]);
    if (!this.#approved.has(asked)) {
      await requireApproval(storytree, project, checkout.folder, checkout.home);
      this.#approved.add(asked);
    }
    const machine = thisMachine();
    const opened = () => openActivityLog(storytree, { connectTimeoutMs: CONNECT_TIMEOUT_MS, branchOf: currentBranch, ...(machine === undefined ? {} : { machine }) });
    const log = (this.#log ??= forgetOnFailure(opened(), () => (this.#log = undefined)));
    let opening = this.#libraries.get(project);
    if (opening === undefined) {
      opening = forgetOnFailure(openNamedProject(storytree, project, identity), () => this.#libraries.delete(project));
      this.#libraries.set(project, opening);
    }
    try {
      const [openedLibrary, openedLog] = await Promise.all([opening, log]);
      return { library: openedLibrary, log: openedLog, storytree };
    } catch (error) {
      // Both openings started together. Let both discard their timed-out sockets before
      // answering, so an immediate retry cannot pick up the other failed opening.
      await Promise.allSettled([opening, log]);
      // Either handshake can expire first. Give the same actionable answer for the log as
      // the library gives for its pools.
      if (error instanceof Error && /timeout expired|timeout exceeded when trying to connect|Connection terminated due to connection timeout/i.test(error.message)) {
        throw new ConnectionError("timeout", "storytree isn't reachable: its database did not answer within 3 seconds. Check that the storytree app is responding, then try again.", error);
      }
      throw error;
    }
  }

  /** Drop every connection. The next call reaches storytree afresh. */
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

/** `promise`, calling `forget` if it fails, so a failed connection is not kept. */
function forgetOnFailure<T>(promise: Promise<T>, forget: () => void): Promise<T> {
  promise.catch(forget);
  return promise;
}
