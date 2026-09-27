/**
 * The tool server's connections to storytree: one to the library's server and one to the agent
 * activity log, both at the address project routing gives, and each project's library once opened.
 * They are made on first use and kept, and dropped when storytree moves (a new address) or goes
 * away, so the next call starts afresh.
 */
import { connect, ConnectionError, type Library, type Storytree } from "@storytree/library";

import { openActivityLog, thisMachine, type ActivityLog } from "../activity/index.js";

/** How long a fresh database handshake may take before a call says storytree isn't reachable. */
const CONNECT_TIMEOUT_MS = 3_000;

export interface Reached {
  readonly library: Library;
  readonly log: ActivityLog;
}

export class Connections {
  #url: string | undefined;
  #storytree: Promise<Storytree> | undefined;
  #log: Promise<ActivityLog> | undefined;
  readonly #libraries = new Map<string, Promise<Library>>();

  /** The connection to the storytree at `url`: the library's server, where projects are opened. */
  async server(url: string): Promise<Storytree> {
    if (this.#url !== url) {
      await this.close();
      this.#url = url;
    }
    return (this.#storytree ??= forgetOnFailure(connect({ url, connectTimeoutMs: CONNECT_TIMEOUT_MS }), () => (this.#storytree = undefined)));
  }

  /** The library of `project` and the activity log, on the storytree at `url`. */
  async reach(url: string, project: string): Promise<Reached> {
    const storytree = await this.server(url);
    const machine = thisMachine();
    const opened = () => openActivityLog(url, { connectTimeoutMs: CONNECT_TIMEOUT_MS, ...(machine === undefined ? {} : { machine }) });
    const log = (this.#log ??= forgetOnFailure(opened(), () => (this.#log = undefined)));
    let library = this.#libraries.get(project);
    if (library === undefined) {
      library = forgetOnFailure(storytree.openProject(project), () => this.#libraries.delete(project));
      this.#libraries.set(project, library);
    }
    try {
      const [openedLibrary, openedLog] = await Promise.all([library, log]);
      return { library: openedLibrary, log: openedLog };
    } catch (error) {
      // Both openings started together. Let both discard their timed-out sockets before
      // answering, so an immediate retry cannot pick up the other failed opening.
      await Promise.allSettled([library, log]);
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
    this.#url = undefined;
    await Promise.allSettled([storytree?.then((server) => server.close()), log?.then((opened) => opened.close())]);
  }
}

/** `promise`, calling `forget` if it fails, so a failed connection is not kept. */
function forgetOnFailure<T>(promise: Promise<T>, forget: () => void): Promise<T> {
  promise.catch(forget);
  return promise;
}
