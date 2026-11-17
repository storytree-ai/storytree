/**
 * Capability 1 · Harvesting failed CI runs. Where the harvested runs are kept: a database of their own on the library's
 * server (`storytree-ci-harvest`), beside the projects, keyed by project, as CI health keeps its CI times: one row per
 * failed run sorted, so a run harvested once is never sorted again (1.1).
 */
import type { Storytree } from "@storytree/library";

import type { HarvestLedger } from "./harvest.js";

/** The database the harvested runs are kept in. */
export const CI_HARVEST_DATABASE = "storytree-ci-harvest";

/** Its tables, in order, each idempotent; only ever appended to. */
export const CI_HARVEST_SCHEMA: readonly string[] = [
  // One row per failed run the harvest sorted: what it was sorted as, and when.
  `CREATE TABLE IF NOT EXISTS ci_harvested (
    project     text NOT NULL,
    run_id      bigint NOT NULL,
    sorted      text NOT NULL,
    at          timestamptz NOT NULL,
    PRIMARY KEY (project, run_id)
  )`,
];

/** What the harvested runs are read and written through: the database's pool. */
export interface HarvestDb {
  query<R extends object = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
}

/** The harvested runs' database on `server`, its tables set up; a shared library takes them only once this file is merged (1.29). */
export function harvestPool(server: Pick<Storytree, "ownDatabase">): Promise<HarvestDb> {
  return server.ownDatabase(CI_HARVEST_DATABASE, { tables: CI_HARVEST_SCHEMA, declaredIn: [import.meta.url] });
}

/** The failed runs of `project` already harvested, by run id, in `db` (1.1). */
export function harvestLedger(db: HarvestDb, project: string, now: () => Date = () => new Date()): HarvestLedger {
  return {
    async harvested(ids) {
      if (ids.length === 0) return new Set();
      const { rows } = await db.query<{ run_id: string }>("SELECT run_id FROM ci_harvested WHERE project = $1 AND run_id = ANY($2::bigint[])", [project, ids]);
      return new Set(rows.map(({ run_id }) => Number(run_id)));
    },
    async mark(rows) {
      for (const { id, sorted } of rows) {
        await db.query("INSERT INTO ci_harvested (project, run_id, sorted, at) VALUES ($1, $2, $3, $4) ON CONFLICT (project, run_id) DO NOTHING", [project, id, sorted, now()]);
      }
    },
  };
}
