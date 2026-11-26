// Capability 1 · Project libraries
import type { Pool } from "pg";

import type { Knowledge } from "../../knowledge/decisions/index.js";
import type { FieldsOf, SchemaRecord, WriteOptions } from "../../storage/rules/index.js";
import type { Transactions } from "../../storage/store/index.js";
import type { Reached } from "./circle.js";
import type { ProjectLineage } from "./lineage.js";
import type { ProjectRecords } from "./records.js";

export interface ProjectWork {
  addStory(story: FieldsOf<"story">, options?: WriteOptions): Promise<SchemaRecord<"story">>;
}

export interface Project {
  readonly name: string;
  readonly identity: string;
  readonly pool: Pool;
  readonly transactions: Transactions;
  readonly records: ProjectRecords;
  readonly knowledge: Knowledge;
  readonly work: ProjectWork;
  readonly lineage: ProjectLineage;
  reach(name: string): Promise<Project>;
  reachAll(): Promise<Reached<Project>[]>;
  close(): Promise<void>;
}

export function workOf(records: ProjectRecords): ProjectWork {
  return { addStory: (story, options) => records.create("story", story, options) };
}
