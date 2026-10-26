/**
 * Capability 4 · Updates, contract 4.4: when an agent last worked in the app's library, so a
 * downloaded release does not stop the database under a live session (whenToInstall's agentActiveAt).
 */
import { ACTIVITY_DATABASE } from "@storytree/session-management";
import type { Storytree } from "@storytree/library";

/**
 * The newest line of the last hour from a session whose own latest line is not its end, in epoch
 * milliseconds; undefined when there is none, or no agent has written a line yet.
 */
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
    if ((error as { code?: unknown }).code === "42P01") return undefined; // no activity table: no agent has connected
    throw error;
  }
}
