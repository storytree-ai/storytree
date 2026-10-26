/**
 * Capability 4 · Updates: the restart into a new build waits while a seed is writing the app's
 * library. A library script that writes (`pnpm check:own-health`, `pnpm library:restore`) writes into
 * the running app's database, holding its writing lock on
 * a connection it names SEED_CONNECTION; restarting stops that database, so the updater asks first.
 */
import { SEED_CONNECTION } from "@storytree/library";
import pg from "pg";

/** Whether a seed is connected to the database at `url`. */
export async function seedWriting(url: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ n: number }>("select count(*)::int as n from pg_stat_activity where application_name = $1", [SEED_CONNECTION]);
    return (rows[0]?.n ?? 0) > 0;
  } finally {
    await client.end();
  }
}
