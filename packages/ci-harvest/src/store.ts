// Capability 1 · Harvesting failed CI runs
import type { Storytree } from "@storytree/library";

import type { HarvestLedger } from "./harvest.js";

export const CI_HARVEST_DATABASE = "storytree-ci-harvest";

export const CI_HARVEST_SCHEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS ci_harvested (
    project     text NOT NULL,
    run_id      bigint NOT NULL,
    sorted      text NOT NULL,
    at          timestamptz NOT NULL,
    PRIMARY KEY (project, run_id)
  )`,
];

export interface HarvestDb {
  query<R extends object = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
}

export function harvestPool(server: Pick<Storytree, "ownDatabase">): Promise<HarvestDb> {
  return server.ownDatabase(CI_HARVEST_DATABASE, { tables: CI_HARVEST_SCHEMA, declaredIn: [import.meta.url] });
}

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
