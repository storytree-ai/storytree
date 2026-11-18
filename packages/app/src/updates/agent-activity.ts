// Capability 4 · Updates
import { ACTIVITY_DATABASE } from "@storytree/session-management";
import type { Storytree } from "@storytree/library";

export async function agentActiveAt(storytree: Pick<Storytree, "ownDatabase">): Promise<number | undefined> {
  const pool = await storytree.ownDatabase(ACTIVITY_DATABASE);
  try {
    const { rows } = await pool.query<{ at: Date | null }>(
      `SELECT max(at) AS at FROM (
         SELECT DISTINCT ON (session) kind, at FROM activity WHERE at > now() - interval '1 hour' ORDER BY session, seq DESC
       ) latest WHERE kind <> 'session-ended'`,
    );
    return rows[0]?.at?.getTime() ?? undefined;
  } catch (error) {
    if ((error as { code?: unknown }).code === "42P01") return undefined;
    throw error;
  }
}
