// Capability 1 · Project libraries
import type { Pool } from "pg";

import type { HealthRecord } from "../../health/index.js";
import type { Knowledge } from "../../knowledge/decisions/index.js";
import type { WorkModel } from "../../plan/index.js";
import type { Transactions } from "../../storage/store/index.js";
import type { WorkInFlight } from "../../work/arcs/index.js";
import type { Reached } from "./circle.js";
import type { ProjectLineage } from "./lineage.js";
import type { ProjectRecords } from "./records.js";

export interface Project {
  readonly name: string;
  readonly identity: string;
  readonly pool: Pool;
  readonly transactions: Transactions;
  readonly records: ProjectRecords;
  readonly knowledge: Knowledge;
  readonly work: WorkModel;
  readonly flight: WorkInFlight;
  readonly health: HealthRecord;
  readonly lineage: ProjectLineage;
  reach(name: string): Promise<Project>;
  reachAll(): Promise<Reached<Project>[]>;
  close(): Promise<void>;
}
