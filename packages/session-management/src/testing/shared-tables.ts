// Capability 2 · Agent activity log
import type pg from "pg";

import { withTestClient } from "@storytree/library/testing/pg";

const LOST_A_LOCK = new Set(["40P01", "55P03"]);
const LOCK_WAIT_MS = 100;

export async function changeSharedTables<T>(database: string | undefined, change: (client: pg.Client) => Promise<T>, tries = 40): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await withTestClient(async (client) => {
        await client.query(`SET lock_timeout = ${LOCK_WAIT_MS}`);
        return change(client);
      }, database);
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (attempt >= tries || typeof code !== "string" || !LOST_A_LOCK.has(code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(50 * attempt, 500)));
    }
  }
}
