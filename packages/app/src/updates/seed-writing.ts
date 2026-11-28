// Capability 4 · Updates
import { SEED_CONNECTION } from "@storytree/library";
import pg from "pg";

export async function seedWriting(url: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: url });
  let lost: Error | undefined;
  client.on("error", (error) => {
    lost ??= error;
  });
  await client.connect();
  try {
    const { rows } = await client.query<{ n: number }>("select count(*)::int as n from pg_stat_activity where application_name = $1 and datname = current_database()", [SEED_CONNECTION]);
    return (rows[0]?.n ?? 0) > 0;
  } catch (error) {
    throw lost ?? error;
  } finally {
    await client.end();
  }
}
