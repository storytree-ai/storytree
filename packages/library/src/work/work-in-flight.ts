/**
 * Capability 10 · Work in flight (stories/library.md): a stub for the red run. Every verb throws.
 */
import type { SchemaRecords } from "../schema/index.js";

/** An increment asked to move backward, in place, or on from closed. */
export class LifecycleError extends Error {}

export class WorkInFlight {
  constructor(_records: SchemaRecords) {}

  addIncrement(..._args: unknown[]): Promise<never> {
    return notBuilt();
  }

  advanceIncrement(..._args: unknown[]): Promise<never> {
    return notBuilt();
  }

  closeIncrement(..._args: unknown[]): Promise<never> {
    return notBuilt();
  }

  parkArc(..._args: unknown[]): Promise<never> {
    return notBuilt();
  }

  unparkArc(..._args: unknown[]): Promise<never> {
    return notBuilt();
  }

  arcView(..._args: unknown[]): Promise<never> {
    return notBuilt();
  }
}

async function notBuilt(): Promise<never> {
  throw new Error("capability 10 is not built yet");
}
