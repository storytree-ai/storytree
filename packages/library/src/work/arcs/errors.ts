// Capability 10 · Work in flight
export type IncrementStatus = "proposal" | "active" | "closed";

export class WaitLoopError extends Error {
  override name = "WaitLoopError";
  readonly path: readonly string[];

  constructor(path: readonly string[]) {
    super(`a wait that closes a loop is refused: ${path.join(" → ")}`);
    this.path = path;
  }
}

export class LifecycleError extends Error {
  override name = "LifecycleError";
  readonly id: string;
  readonly from: IncrementStatus;
  readonly to: IncrementStatus;

  constructor(id: string, from: IncrementStatus, to: IncrementStatus) {
    super(`${id} cannot move from ${from} to ${to}: an increment moves forward, proposal then active then closed, and only active work nobody holds returns to proposal`);
    this.id = id;
    this.from = from;
    this.to = to;
  }
}
