/**
 * A project's snapshot (capability 1, contracts 1.6 to 1.8; ADR-0641 D2 step 4, choice B1): its
 * tables as plain data, the backup of a library that is the only copy of its plan.
 */

/** A record as it is now: a row of the project's `record` table. */
export interface SnapshotRecord {
  id: string;
  type: string;
  version: number;
  fields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** One entry of the project's append-only history: a row of its `record_event` table. */
export interface SnapshotEvent {
  seq: number;
  recordId: string;
  type: string;
  action: "created" | "updated" | "retired";
  record: unknown;
  reason?: string;
  actor?: string;
  at: string;
}

/** Every record of a project and its whole history, as they stood at one moment. Plain data. */
export interface ProjectSnapshot {
  format: "storytree-project-snapshot";
  version: 1;
  project: string;
  takenAt: string;
  records: SnapshotRecord[];
  history: SnapshotEvent[];
}

/** A restore into a project that already holds records or history, refused so that no live edit is overwritten. */
export class RestoreRefusedError extends Error {
  readonly project: string;

  constructor(project: string) {
    super(
      `The project "${project}" already holds records or history, so a snapshot is not restored into it: ` +
        "a restore goes only into an empty project, so that it never overwrites live edits.",
    );
    this.name = "RestoreRefusedError";
    this.project = project;
  }
}
