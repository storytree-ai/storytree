/**
 * Capability 2 · Agent activity log. For the cloud account's tests (2.14, and the machines' trunks test), which grant,
 * fence and ungrant tables every other test on the server is reading and writing at once: a statement that changes a
 * table's rules waits for every lock on it, so it can meet another test's transaction in a deadlock, which Postgres
 * ends by failing whichever side waited first, often the other test (arc_2294482ae3f6). So the change waits for a lock
 * no longer than LOCK_WAIT, well short of the server's deadlock_timeout (1 s by default), and gives it up before
 * Postgres looks for a deadlock: the change is always the side that loses, and it is tried again on a fresh connection.
 */
import type pg from "pg";

import { withTestClient } from "@storytree/library/testing/pg";

const LOST_A_LOCK = new Set(["40P01", "55P03"]);
const LOCK_WAIT_MS = 100;

/** Run `change` on its own connection to `database` (the server's own when undefined), again whenever it loses a lock. */
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
